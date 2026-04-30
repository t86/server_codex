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

## 部署到 150

先在 150 上生成专用运维 key，并把公钥安装到 111/114：

```bash
./scripts/setup-ops-ssh-keys.sh
```

部署 Web/API/Runner 到 150：

```bash
./scripts/deploy-150.sh
```

部署完成后，手机可先通过下面地址访问：

```text
http://43.131.232.150:3000
```

公网只暴露 Web 的 `3000` 端口。Web 默认启用 Basic Auth，部署脚本会在 150 的 `.env` 中生成密码。

导入本机 `codex-account` 账号池到 150：

```bash
./scripts/import-local-accounts-150.sh
```

同步本机 Codex skills/plugins 到 150，并挂到每个账号的 `CODEX_HOME`：

```bash
./scripts/sync-local-codex-assets-150.sh
```
