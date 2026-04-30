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
  const thread = await db.query(
    `select id, workspace_path, pinned_account_id from threads where id = $1`,
    [run.thread_id]
  );
  const message = await db.query(
    `select content from messages where thread_id = $1 and role = 'user' order by created_at desc limit 1`,
    [run.thread_id]
  );
  const accounts = await db.query(
    `select id, label from codex_accounts
     where status = 'active'
     order by priority asc, last_used_at asc nulls first, updated_at desc`
  );

  return {
    thread: thread.rows[0],
    prompt: message.rows[0]?.content as string | undefined,
    accounts: accounts.rows as { id: string; label: string }[]
  };
}

async function runCodexExec(context: {
  workspacePath: string;
  accountId: string;
  prompt: string;
  onProgress: (chunk: string) => void;
}) {
  await fs.mkdir(context.workspacePath, { recursive: true, mode: 0o700 });
  const outputFile = path.join(os.tmpdir(), `server-codex-${id()}.txt`);
  const accountHome = path.join(codexDataDir, "codex-home", "accounts", context.accountId);
  const sshConfig = path.join(codexDataDir, "secrets", "ssh", "config");

  const args = [
    "exec",
    "--cd",
    context.workspacePath,
    "--skip-git-repo-check",
    "--sandbox",
    "danger-full-access",
    "--output-last-message",
    outputFile,
    context.prompt
  ];

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
  return finalMessage.trim() || stdout.trim() || "Codex run completed.";
}

async function completeRun(run: { id: string; thread_id: string }) {
  const context = await getRunContext(run);
  if (!context.thread) throw new Error("thread not found");
  if (!context.prompt) throw new Error("no user message found");
  if (context.accounts.length === 0) throw new Error("no active Codex account imported");

  let assistantMessage = "";
  let selectedAccount: { id: string; label: string } | undefined;
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
      assistantMessage = await runCodexExec({
        workspacePath: context.thread.workspace_path,
        accountId: account.id,
        prompt: context.prompt,
        onProgress: (chunk) => {
          progressContent += chunk;
          void flushProgress();
        }
      });
      selectedAccount = account;
      break;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${account.label}: ${message.slice(0, 220)}`);

      if (isCapacityError(message)) {
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
        { runner: "codex-cli", accountId: selectedAccount.id }
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
      `update threads set status = 'idle', updated_at = now() where id = $1`,
      [run.thread_id]
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
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
