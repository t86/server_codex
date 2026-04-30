# Server Codex

Private Codex web console designed to run on server `150`.

It will provide:

- Web-based Codex-style threaded conversations.
- Server-assigned workspaces with user-editable thread names.
- Skills and plugins support.
- Scheduled tasks.
- SSH operations from `150` to managed servers `111` and `114`.
- Authorized account pool with safe failover.

See [docs/design.md](docs/design.md) for the current architecture and implementation plan.

中文规格说明见 [docs/spec.zh.md](docs/spec.zh.md)。

## Planned MVP

1. Build the web console foundation.
2. Add thread workspace allocation and streaming runs.
3. Configure `150` as the operations node for `111` and `114`.
4. Add account pool import and failover.
5. Add skills, plugins, and scheduled tasks.

## 本地开发

```bash
npm install
docker compose up -d postgres redis
npm run db:migrate
npm run dev:api
npm run dev:runner
npm run dev:web
```

默认地址：

- Web: <http://localhost:3000>
- API: <http://localhost:4000>

## Docker 启动

```bash
docker compose up -d --build
```

这会启动：

- `web`
- `api`
- `runner`
- `postgres`
- `redis`

第一版 Runner 目前是占位实现：它会消费 queued run 并写回一条 assistant 消息，后续接入真实 Codex CLI。
