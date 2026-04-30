import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const migrationsDir = path.join(root, "apps/api/db/migrations");
const databaseUrl =
  process.env.DATABASE_URL ??
  "postgres://server_codex:server_codex@localhost:5432/server_codex";

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
await client.query(`
  create table if not exists schema_migrations (
    id text primary key,
    applied_at timestamptz not null default now()
  )
`);

const files = (await fs.readdir(migrationsDir))
  .filter((file) => file.endsWith(".sql"))
  .sort();

for (const file of files) {
  const existing = await client.query("select id from schema_migrations where id = $1", [file]);
  if (existing.rowCount) continue;

  const sql = await fs.readFile(path.join(migrationsDir, file), "utf8");
  await client.query("begin");
  try {
    await client.query(sql);
    await client.query("insert into schema_migrations (id) values ($1)", [file]);
    await client.query("commit");
    console.log(`applied ${file}`);
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

await client.end();
