#!/usr/bin/env bash
set -euo pipefail

SERVER_ALIAS="${SERVER_ALIAS:-ecs-150}"
LOCAL_CODEX_HOME="${LOCAL_CODEX_HOME:-$HOME/.codex}"
REMOTE_DATA_DIR="${REMOTE_DATA_DIR:-/srv/codex}"
REMOTE_GLOBAL_DIR="$REMOTE_DATA_DIR/global-codex"

if [ ! -d "$LOCAL_CODEX_HOME/skills" ]; then
  echo "local skills directory not found: $LOCAL_CODEX_HOME/skills" >&2
  exit 1
fi

ssh "$SERVER_ALIAS" "mkdir -p '$REMOTE_GLOBAL_DIR/skills' '$REMOTE_GLOBAL_DIR/plugins' '$REMOTE_DATA_DIR/codex-home/accounts'"

rsync -az --delete \
  --exclude '.DS_Store' \
  "$LOCAL_CODEX_HOME/skills/" \
  "$SERVER_ALIAS:$REMOTE_GLOBAL_DIR/skills/"

if [ -d "$LOCAL_CODEX_HOME/plugins" ]; then
  rsync -az --delete \
    --exclude '.DS_Store' \
    "$LOCAL_CODEX_HOME/plugins/" \
    "$SERVER_ALIAS:$REMOTE_GLOBAL_DIR/plugins/"
fi

ssh "$SERVER_ALIAS" bash -s <<EOF
set -euo pipefail
REMOTE_DATA_DIR="$REMOTE_DATA_DIR"
REMOTE_GLOBAL_DIR="$REMOTE_GLOBAL_DIR"

find "\$REMOTE_DATA_DIR/codex-home/accounts" -mindepth 1 -maxdepth 1 -type d | while read -r account_home; do
  sudo rm -rf "\$account_home/skills" "\$account_home/plugins"
  sudo ln -s "\$REMOTE_GLOBAL_DIR/skills" "\$account_home/skills"
  sudo ln -s "\$REMOTE_GLOBAL_DIR/plugins" "\$account_home/plugins"
done

sudo chown -R ubuntu:ubuntu "\$REMOTE_GLOBAL_DIR"

find "\$REMOTE_GLOBAL_DIR/skills" -maxdepth 2 -name SKILL.md | sort
find "\$REMOTE_GLOBAL_DIR/plugins" -maxdepth 6 -path '*/.codex-plugin/plugin.json' | sort
EOF
