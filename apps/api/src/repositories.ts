import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { paths } from "./config.js";
import { db } from "./db.js";
import { messageId, runId, threadId } from "./ids.js";

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

export const renameThreadInput = z.object({
  displayName: z.string().trim().min(1).max(120)
});

export async function renameThread(id: string, input: z.infer<typeof renameThreadInput>) {
  const result = await db.query<ThreadRow>(
    `update threads
     set display_name = $2, updated_at = now()
     where id = $1 and user_id = $3
     returning *`,
    [id, input.displayName, OWNER_USER_ID]
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
  content: z.string().trim().min(1).max(20000)
});

export async function createUserMessage(threadIdValue: string, content: string) {
  const client = await db.connect();
  try {
    await client.query("begin");
    const msg = await client.query<MessageRow>(
      `insert into messages (id, thread_id, role, content)
       values ($1, $2, 'user', $3)
       returning *`,
      [messageId(), threadIdValue, content]
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
