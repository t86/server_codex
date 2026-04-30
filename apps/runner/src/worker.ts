import { setTimeout as sleep } from "node:timers/promises";
import { customAlphabet } from "nanoid";
import pg from "pg";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgres://server_codex:server_codex@localhost:5432/server_codex";

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

async function completeRun(run: { id: string; thread_id: string }) {
  const client = await db.connect();
  try {
    await client.query("begin");
    await client.query(
      `insert into messages (id, thread_id, role, content, metadata_json)
       values ($1, $2, 'assistant', $3, $4)`,
      [
        `msg_${id()}`,
        run.thread_id,
        "Runner 已接收到任务。下一步会在这里接入 Codex CLI 的真实流式执行。",
        { runner: "placeholder" }
      ]
    );
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
