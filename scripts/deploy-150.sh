#!/usr/bin/env bash
set -euo pipefail

SERVER_ALIAS="${SERVER_ALIAS:-ecs-150}"
REMOTE_DIR="${REMOTE_DIR:-/srv/server-codex}"
CODEX_DATA_DIR="${CODEX_DATA_DIR:-/srv/codex}"
REPO_URL="${REPO_URL:-https://github.com/t86/server_codex.git}"
BRANCH="${BRANCH:-main}"

ssh "$SERVER_ALIAS" bash -s <<EOF
set -euo pipefail

sudo mkdir -p "$REMOTE_DIR" "$CODEX_DATA_DIR"/{workspaces,codex-home,plugins,logs,artifacts,secrets/ssh,secrets/accounts}
sudo chown -R ubuntu:ubuntu "$REMOTE_DIR" "$CODEX_DATA_DIR"
chmod 700 "$CODEX_DATA_DIR/secrets"

if [ ! -d "$REMOTE_DIR/.git" ]; then
  git clone "$REPO_URL" "$REMOTE_DIR"
fi

cd "$REMOTE_DIR"
git fetch origin "$BRANCH"
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"

if [ ! -f .env ]; then
  PASSWORD="\$(openssl rand -base64 24 | tr -d '\n')"
  {
    echo "WEB_BASIC_AUTH_USER=admin"
    echo "WEB_BASIC_AUTH_PASSWORD=\$PASSWORD"
  } > .env
  chmod 600 .env
  echo "Generated Web Basic Auth credentials:"
  echo "  user: admin"
  echo "  password: \$PASSWORD"
fi

docker compose up -d --build
docker compose ps
EOF
