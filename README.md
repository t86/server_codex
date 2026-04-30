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

## Planned MVP

1. Build the web console foundation.
2. Add thread workspace allocation and streaming runs.
3. Configure `150` as the operations node for `111` and `114`.
4. Add account pool import and failover.
5. Add skills, plugins, and scheduled tasks.
