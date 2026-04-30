import path from "node:path";

export const config = {
  port: Number(process.env.API_PORT ?? 4000),
  databaseUrl:
    process.env.DATABASE_URL ??
    "postgres://server_codex:server_codex@localhost:5432/server_codex",
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  codexDataDir: process.env.CODEX_DATA_DIR ?? path.resolve(process.cwd(), "data/codex")
};

export const paths = {
  workspaces: path.join(config.codexDataDir, "workspaces"),
  codexHome: path.join(config.codexDataDir, "codex-home"),
  secrets: path.join(config.codexDataDir, "secrets")
};
