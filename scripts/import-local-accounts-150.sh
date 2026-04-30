#!/usr/bin/env bash
set -euo pipefail

SERVER_ALIAS="${SERVER_ALIAS:-ecs-150}"
LOCAL_ACCOUNTS_FILE="${LOCAL_ACCOUNTS_FILE:-$HOME/Library/Application Support/com.carry.codex-tools/accounts.json}"
REMOTE_IMPORT_DIR="${REMOTE_IMPORT_DIR:-/srv/codex/secrets/imports}"
REMOTE_IMPORT_FILE="$REMOTE_IMPORT_DIR/codex-tools-accounts.json"
REMOTE_APP_DIR="${REMOTE_APP_DIR:-/srv/server-codex}"

if [ ! -f "$LOCAL_ACCOUNTS_FILE" ]; then
  echo "accounts file not found: $LOCAL_ACCOUNTS_FILE" >&2
  exit 1
fi

ssh "$SERVER_ALIAS" "mkdir -p '$REMOTE_IMPORT_DIR' && chmod 700 '$REMOTE_IMPORT_DIR'"
scp "$LOCAL_ACCOUNTS_FILE" "$SERVER_ALIAS:$REMOTE_IMPORT_FILE" >/dev/null
ssh "$SERVER_ALIAS" "chmod 600 '$REMOTE_IMPORT_FILE'"

ssh "$SERVER_ALIAS" bash -s <<EOF
set -euo pipefail
cd "$REMOTE_APP_DIR"
set -a
. ./.env
set +a
curl -fsS \
  -u "\${WEB_BASIC_AUTH_USER}:\${WEB_BASIC_AUTH_PASSWORD}" \
  -H 'content-type: application/json' \
  --data-binary "@$REMOTE_IMPORT_FILE" \
  http://localhost:3000/api/accounts/import
echo
EOF
