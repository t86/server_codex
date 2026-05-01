import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { paths } from "./config.js";
import { db } from "./db.js";
import { accountId, messageId, runId, threadId } from "./ids.js";

export const OWNER_USER_ID = "usr_owner";

export type ThreadRow = {
  id: string;
  user_id: string;
  display_name: string;
  workspace_path: string;
  account_mode: string;
  pinned_account_id: string | null;
  model: string;
  status: string;
  created_at: string;
  updated_at: string;
};

export type MessageRow = {
  id: string;
  thread_id: string;
  role: string;
  content: string;
  metadata_json: Record<string, unknown>;
  created_at: string;
};

export type MessageAttachment = {
  id: string;
  name: string;
  mimeType: string;
  path: string;
  size: number;
  url?: string;
};

export const createThreadInput = z.object({
  displayName: z.string().trim().min(1).max(120).optional()
});

export async function listThreads() {
  const result = await db.query<ThreadRow>(
    `select * from threads where user_id = $1 and status <> 'archived' order by updated_at desc`,
    [OWNER_USER_ID]
  );
  return result.rows;
}

export async function createThread(input: z.infer<typeof createThreadInput>) {
  const id = threadId();
  const displayName = input.displayName?.trim() || "新线程";
  const workspacePath = path.join(paths.workspaces, id);

  await fs.mkdir(workspacePath, { recursive: true, mode: 0o700 });

  const result = await db.query<ThreadRow>(
    `insert into threads (id, user_id, display_name, workspace_path)
     values ($1, $2, $3, $4)
     returning *`,
    [id, OWNER_USER_ID, displayName, workspacePath]
  );

  return result.rows[0];
}

const modelSchema = z.string().trim().min(1).max(80);

export const updateThreadInput = z
  .object({
    displayName: z.string().trim().min(1).max(120).optional(),
    model: modelSchema.optional()
  })
  .refine((input) => input.displayName !== undefined || input.model !== undefined, {
    message: "displayName or model is required"
  });

export async function updateThread(id: string, input: z.infer<typeof updateThreadInput>) {
  const result = await db.query<ThreadRow>(
    `update threads
     set display_name = coalesce($2, display_name),
         model = coalesce($3, model),
         updated_at = now()
     where id = $1 and user_id = $4
     returning *`,
    [id, input.displayName, input.model, OWNER_USER_ID]
  );
  return result.rows[0] ?? null;
}

export async function archiveThread(id: string) {
  const result = await db.query<ThreadRow>(
    `update threads
     set status = 'archived', updated_at = now()
     where id = $1 and user_id = $2
     returning *`,
    [id, OWNER_USER_ID]
  );
  return result.rows[0] ?? null;
}

export async function deleteThreadPermanently(id: string) {
  const client = await db.connect();
  let thread: ThreadRow | null = null;
  try {
    await client.query("begin");
    const existing = await client.query<ThreadRow>(
      `select * from threads where id = $1 and user_id = $2 for update`,
      [id, OWNER_USER_ID]
    );
    thread = existing.rows[0] ?? null;
    if (!thread) {
      await client.query("rollback");
      return null;
    }

    await client.query(`delete from threads where id = $1 and user_id = $2`, [
      id,
      OWNER_USER_ID
    ]);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }

  await fs.rm(thread.workspace_path, { recursive: true, force: true });
  return thread;
}

export async function getThread(id: string) {
  const result = await db.query<ThreadRow>(
    `select * from threads where id = $1 and user_id = $2`,
    [id, OWNER_USER_ID]
  );
  return result.rows[0] ?? null;
}

export async function listMessages(threadId: string) {
  const result = await db.query<MessageRow>(
    `select * from messages where thread_id = $1 order by created_at asc`,
    [threadId]
  );
  return result.rows;
}

export const createMessageInput = z.object({
  content: z.string().trim().max(20000).optional().default(""),
  attachments: z
    .array(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1).max(240),
        mimeType: z.string().min(1).max(120),
        path: z.string().min(1),
        size: z.number().int().nonnegative(),
        url: z.string().min(1).optional()
      })
    )
    .max(8)
    .optional()
    .default([])
}).refine((input) => input.content.length > 0 || input.attachments.length > 0, {
  message: "content or attachments is required"
});

export async function createUserMessage(
  threadIdValue: string,
  content: string,
  attachments: MessageAttachment[] = []
) {
  const client = await db.connect();
  try {
    await client.query("begin");
    const msg = await client.query<MessageRow>(
      `insert into messages (id, thread_id, role, content, metadata_json)
       values ($1, $2, 'user', $3, $4)
       returning *`,
      [messageId(), threadIdValue, content, { attachments }]
    );

    const run = await client.query(
      `insert into runs (id, thread_id, user_id, status)
       values ($1, $2, $3, 'queued')
       returning *`,
      [runId(), threadIdValue, OWNER_USER_ID]
    );

    await client.query(
      `update threads set status = 'running', updated_at = now() where id = $1`,
      [threadIdValue]
    );

    await client.query("commit");
    return { message: msg.rows[0], run: run.rows[0] };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function listServerProfiles() {
  const result = await db.query(
    `select * from server_profiles order by name asc`
  );
  return result.rows;
}

const codexToolsAccountSchema = z.object({
  id: z.string().optional(),
  label: z.string().optional(),
  email: z.string().nullable().optional(),
  accountId: z.string(),
  planType: z.string().nullable().optional(),
  authJson: z.record(z.unknown())
});

export const importAccountsInput = z.object({
  accounts: z.array(codexToolsAccountSchema).min(1)
});

export async function listAccounts() {
  const result = await db.query(
    `select id, label, email_masked, plan_type, status, priority,
            current_5h_usage, current_week_usage, reset_5h_at, reset_week_at,
            last_used_at, created_at, updated_at
     from codex_accounts
     order by priority asc, updated_at desc`
  );
  return result.rows;
}

function maskEmail(email?: string | null) {
  if (!email) return null;
  const [name, domain] = email.split("@");
  if (!domain) return email;
  const left = name.length <= 2 ? `${name[0] ?? ""}*` : `${name.slice(0, 2)}***`;
  return `${left}@${domain}`;
}

export async function importAccounts(input: z.infer<typeof importAccountsInput>) {
  await fs.mkdir(path.join(paths.secrets, "accounts"), { recursive: true, mode: 0o700 });
  await fs.mkdir(path.join(paths.codexHome, "accounts"), { recursive: true, mode: 0o700 });

  let imported = 0;
  let updated = 0;

  for (const account of input.accounts) {
    const existing = await db.query<{ id: string }>(
      `select id from codex_accounts where secret_ref = $1`,
      [`codex-tools:${account.accountId}`]
    );
    const id = existing.rows[0]?.id ?? accountId();
    const accountSecretDir = path.join(paths.secrets, "accounts", id);
    const accountHomeDir = path.join(paths.codexHome, "accounts", id);
    await fs.mkdir(accountSecretDir, { recursive: true, mode: 0o700 });
    await fs.mkdir(accountHomeDir, { recursive: true, mode: 0o700 });

    const authJson = JSON.stringify(account.authJson, null, 2);
    await fs.writeFile(path.join(accountSecretDir, "auth.json"), authJson, { mode: 0o600 });
    await fs.writeFile(path.join(accountHomeDir, "auth.json"), authJson, { mode: 0o600 });

    const values = [
      id,
      account.label || account.email || account.accountId,
      maskEmail(account.email),
      account.planType || "unknown",
      `codex-tools:${account.accountId}`
    ];

    const result = await db.query(
      `insert into codex_accounts (id, label, email_masked, plan_type, secret_ref)
       values ($1, $2, $3, $4, $5)
       on conflict (id) do update
       set label = excluded.label,
           email_masked = excluded.email_masked,
           plan_type = excluded.plan_type,
           status = 'active',
           secret_ref = excluded.secret_ref,
           updated_at = now()
       returning xmax = 0 as inserted`,
      values
    );

    if (result.rows[0]?.inserted) imported += 1;
    else updated += 1;
  }

  return { imported, updated };
}
