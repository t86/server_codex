import { setTimeout as sleep } from "node:timers/promises";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { customAlphabet } from "nanoid";
import pg from "pg";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgres://server_codex:server_codex@localhost:5432/server_codex";
const codexDataDir = process.env.CODEX_DATA_DIR ?? path.resolve(process.cwd(), "data/codex");
const codexBin = process.env.CODEX_BIN ?? "/app/node_modules/.bin/codex";
const codexTimeoutMs = Number(process.env.CODEX_RUN_TIMEOUT_MS ?? 10 * 60 * 1000);

const id = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 18);
const db = new pg.Pool({ connectionString: databaseUrl });

async function claimRun() {
  const result = await db.query(
    `update runs
     set status = 'running', started_at = now()
     where id = (
       select id from runs
       where status = 'queued'
       order by created_at asc
       for update skip locked
       limit 1
     )
     returning *`
  );
  return result.rows[0] ?? null;
}

async function getRunContext(run: { thread_id: string }) {
  const thread = await db.query<{
    id: string;
    workspace_path: string;
    pinned_account_id: string | null;
    model: string;
    codex_session_id: string | null;
    codex_session_account_id: string | null;
  }>(
    `select id, workspace_path, pinned_account_id, model, codex_session_id, codex_session_account_id
     from threads
     where id = $1`,
    [run.thread_id]
  );
  const message = await db.query(
    `select content, metadata_json from messages where thread_id = $1 and role = 'user' order by created_at desc limit 1`,
    [run.thread_id]
  );
  const seedMessages = await db.query<{ role: string; content: string }>(
    `select role, content
     from (
       select role, content, created_at
       from messages
       where thread_id = $1 and role in ('user', 'assistant')
       order by created_at desc
       limit 8
     ) recent_messages
     order by created_at asc`,
    [run.thread_id]
  );
  const accounts = await db.query(
    `select id, label from codex_accounts
     where status = 'active'
     order by case when id = $1 then 0 else 1 end,
              priority asc,
              last_used_at asc nulls first,
              updated_at desc`,
    [thread.rows[0]?.codex_session_account_id ?? null]
  );

  return {
    thread: thread.rows[0],
    prompt: message.rows[0]?.content as string | undefined,
    attachments: getMessageAttachments(message.rows[0]?.metadata_json),
    seedMessages: seedMessages.rows,
    accounts: accounts.rows as { id: string; label: string }[]
  };
}

async function runCodexExec(context: {
  workspacePath: string;
  accountId: string;
  prompt: string;
  model?: string;
  imagePaths: string[];
  resumeSessionId?: string | null;
  onProgress: (chunk: string) => void;
}) {
  await fs.mkdir(context.workspacePath, { recursive: true, mode: 0o700 });
  const outputFile = path.join(os.tmpdir(), `server-codex-${id()}.txt`);
  const accountHome = path.join(codexDataDir, "codex-home", "accounts", context.accountId);
  const sshConfig = path.join(codexDataDir, "secrets", "ssh", "config");
  await ensureAccountHome(accountHome);

  const args = context.resumeSessionId
    ? [
        "exec",
        "resume",
        "--skip-git-repo-check",
        "--dangerously-bypass-approvals-and-sandbox",
        "--json",
        "--output-last-message",
        outputFile
      ]
    : [
        "exec",
        "--cd",
        context.workspacePath,
        "--skip-git-repo-check",
        "--sandbox",
        "danger-full-access",
        "--json",
        "--output-last-message",
        outputFile
      ];
  if (context.model) {
    args.push("--model", context.model);
  }
  for (const imagePath of context.imagePaths) {
    args.push("--image", imagePath);
  }
  if (context.resumeSessionId) {
    args.push(context.resumeSessionId);
  }
  args.push(context.prompt);

  const child = spawn(codexBin, args, {
    env: {
      ...process.env,
      CODEX_HOME: accountHome,
      GIT_SSH_COMMAND: `ssh -F ${sshConfig}`
    },
    cwd: context.workspacePath,
    stdio: ["ignore", "pipe", "pipe"]
  });

  let stdout = "";
  let stderr = "";
  const timer = setTimeout(() => child.kill("SIGTERM"), codexTimeoutMs);

  child.stdout.on("data", (chunk) => {
    const value = chunk.toString();
    stdout += value;
    context.onProgress(value);
  });
  child.stderr.on("data", (chunk) => {
    const value = chunk.toString();
    stderr += value;
    context.onProgress(value);
  });

  const code = await new Promise<number | null>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  }).finally(() => clearTimeout(timer));

  if (code !== 0) {
    throw new Error(stderr.trim() || stdout.trim() || `codex exited with code ${code}`);
  }

  const finalMessage = await fs.readFile(outputFile, "utf8").catch(() => stdout);
  await fs.rm(outputFile, { force: true });
  return {
    finalMessage: finalMessage.trim() || stdout.trim() || "Codex run completed.",
    sessionId: parseCodexSessionId(stdout) ?? context.resumeSessionId ?? null,
    resumed: Boolean(context.resumeSessionId)
  };
}

async function completeRun(run: { id: string; thread_id: string }) {
  const context = await getRunContext(run);
  if (!context.thread) throw new Error("thread not found");
  if (!context.prompt && context.attachments.length === 0) throw new Error("no user message found");
  if (context.accounts.length === 0) throw new Error("no active Codex account imported");

  let assistantMessage = "";
  let selectedAccount: { id: string; label: string } | undefined;
  let selectedSessionId: string | null = null;
  let usedResume = false;
  const failures: string[] = [];
  const progressMessageId = `msg_${id()}`;
  let progressContent = "Codex Runner 已启动...\n";
  let lastProgressFlush = 0;

  await db.query(
    `insert into messages (id, thread_id, role, content, metadata_json)
     values ($1, $2, 'tool', $3, $4)`,
    [progressMessageId, run.thread_id, progressContent, { runner: "codex-cli", progress: true }]
  );

  const flushProgress = async (force = false) => {
    const now = Date.now();
    if (!force && now - lastProgressFlush < 900) return;
    lastProgressFlush = now;
    await db.query(`update messages set content = $2 where id = $1`, [
      progressMessageId,
      progressContent.slice(-6000)
    ]);
  };

  for (const account of context.accounts) {
    try {
      progressContent += `\n尝试账号：${account.label}\n`;
      await flushProgress(true);
      const resumeSessionId =
        context.thread.codex_session_account_id === account.id ? context.thread.codex_session_id : null;
      const result = await runCodexExec({
        workspacePath: context.thread.workspace_path,
        accountId: account.id,
        prompt: buildPromptForAccount({
          prompt: context.prompt,
          seedMessages: context.seedMessages,
          useResume: Boolean(resumeSessionId)
        }),
        model: context.thread.model,
        imagePaths: context.attachments.map((attachment) => attachment.path),
        resumeSessionId,
        onProgress: (chunk) => {
          progressContent += chunk;
          void flushProgress();
        }
      });
      assistantMessage = result.finalMessage;
      selectedSessionId = result.sessionId;
      usedResume = result.resumed;
      selectedAccount = account;
      break;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${account.label}: ${message.slice(0, 220)}`);

      const accountError = classifyAccountError(message);
      if (accountError === "exhausted") {
        progressContent += `\n账号额度不足，切换下一个账号：${account.label}\n`;
        await flushProgress(true);
        await db.query(
          `update codex_accounts
           set status = 'exhausted', updated_at = now()
           where id = $1`,
          [account.id]
        );
        continue;
      }

      if (accountError === "invalid") {
        progressContent += `\n账号不可用，已跳过：${account.label}\n`;
        await flushProgress(true);
        await db.query(
          `update codex_accounts
           set status = 'invalid', updated_at = now()
           where id = $1`,
          [account.id]
        );
        continue;
      }

      throw error;
    }
  }

  if (!selectedAccount) {
    throw new Error(`all Codex accounts failed: ${failures.join(" | ")}`);
  }
  progressContent += "\nCodex Runner 已完成。";
  await flushProgress(true);

  const client = await db.connect();
  try {
    await client.query("begin");
    await client.query(
      `insert into messages (id, thread_id, role, content, metadata_json)
       values ($1, $2, 'assistant', $3, $4)`,
      [
        `msg_${id()}`,
        run.thread_id,
        assistantMessage,
        {
          runner: "codex-cli",
          accountId: selectedAccount.id,
          codexSessionId: selectedSessionId,
          resumed: usedResume
        }
      ]
    );
    await client.query(`update codex_accounts set last_used_at = now() where id = $1`, [
      selectedAccount.id
    ]);
    await client.query(
      `update runs set status = 'succeeded', finished_at = now() where id = $1`,
      [run.id]
    );
    await client.query(
      `update threads
       set status = 'idle',
           codex_session_id = coalesce($2, codex_session_id),
           codex_session_account_id = coalesce($3, codex_session_account_id),
           updated_at = now()
       where id = $1`,
      [run.thread_id, selectedSessionId, selectedAccount.id]
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

function getMessageAttachments(metadata: unknown) {
  if (!metadata || typeof metadata !== "object") return [];
  const attachments = (metadata as { attachments?: unknown }).attachments;
  if (!Array.isArray(attachments)) return [];
  return attachments
    .map((attachment) => {
      if (!attachment || typeof attachment !== "object") return null;
      const item = attachment as { path?: unknown };
      return typeof item.path === "string" ? { path: item.path } : null;
    })
    .filter((attachment): attachment is { path: string } => attachment !== null);
}

function buildPromptForAccount(context: {
  prompt?: string;
  seedMessages: { role: string; content: string }[];
  useResume: boolean;
}) {
  const prompt = context.prompt?.trim() || "请根据附件继续处理。";
  if (context.useResume) return prompt;

  const priorMessages = context.seedMessages
    .slice(0, -1)
    .map((message) => ({
      role: message.role === "assistant" ? "assistant" : "user",
      content: message.content.trim().slice(0, 2000)
    }))
    .filter((message) => message.content.length > 0);

  if (priorMessages.length === 0) return prompt;

  const seed = priorMessages
    .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
    .join("\n\n")
    .slice(-12000);

  return [
    "这是从另一个 Codex 账号切换过来的同一 Web 线程。下面是极简上下文种子，仅用于恢复必要上下文；请主要回答最后一条 USER 消息。",
    "",
    seed,
    "",
    `USER: ${prompt}`
  ].join("\n");
}

function parseCodexSessionId(stdout: string) {
  for (const line of stdout.split(/\r?\n/)) {
    try {
      const event = JSON.parse(line) as { type?: string; thread_id?: unknown };
      if (event.type === "thread.started" && typeof event.thread_id === "string") {
        return event.thread_id;
      }
    } catch {
      // Ignore plain progress lines.
    }
  }
  return null;
}

async function ensureAccountHome(accountHome: string) {
  try {
    await fs.access(accountHome);
    await fs.access(path.join(accountHome, "auth.json"));
  } catch {
    throw new Error(`account home is missing or incomplete: ${accountHome}`);
  }
}

function isCapacityError(message: string) {
  const lower = message.toLowerCase();
  return (
    lower.includes("usage limit") ||
    lower.includes("rate limit") ||
    lower.includes("quota") ||
    lower.includes("more credits") ||
    lower.includes("try again at")
  );
}

function isInvalidAccountError(message: string) {
  const lower = message.toLowerCase();
  return (
    lower.includes("account home is missing") ||
    lower.includes("codex_home points") ||
    lower.includes("path does not exist") ||
    lower.includes("not logged in") ||
    lower.includes("auth.json") ||
    lower.includes("invalid token") ||
    lower.includes("token_expired") ||
    lower.includes("refresh_token_reused") ||
    lower.includes("refresh token was already used") ||
    lower.includes("access token could not be refreshed") ||
    lower.includes("unauthorized") ||
    lower.includes("401") ||
    lower.includes("account has been deactivated") ||
    lower.includes("workspace has been deactivated") ||
    lower.includes("账号已被踢出") ||
    lower.includes("账号被封禁") ||
    lower.includes("授权过期")
  );
}

function classifyAccountError(message: string): "exhausted" | "invalid" | null {
  if (isCapacityError(message)) return "exhausted";
  if (isInvalidAccountError(message)) return "invalid";
  return null;
}

async function failRun(run: { id: string; thread_id: string }, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  await db.query(
    `update runs
     set status = 'failed', error_code = 'runner_error', error_message = $2, finished_at = now()
     where id = $1`,
    [run.id, message]
  );
  await db.query(`update threads set status = 'failed', updated_at = now() where id = $1`, [
    run.thread_id
  ]);
  await db.query(
    `insert into messages (id, thread_id, role, content, metadata_json)
     values ($1, $2, 'assistant', $3, $4)`,
    [`msg_${id()}`, run.thread_id, `Runner 执行失败：${message}`, { runner: "codex-cli" }]
  );
}

console.log("server-codex runner started");

while (true) {
  const run = await claimRun();
  if (!run) {
    await sleep(1500);
    continue;
  }

  try {
    await completeRun(run);
  } catch (error) {
    await failRun(run, error);
  }
}
