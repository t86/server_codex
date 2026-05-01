#!/usr/bin/env bash
set -euo pipefail

CONTROL_ALIAS="${CONTROL_ALIAS:-ecs-150}"
TARGET_ALIASES=(${TARGET_ALIASES:-ecs-111 ecs-114 ecs-150})
REMOTE_KEY_DIR="${REMOTE_KEY_DIR:-/srv/codex/secrets/ssh}"
REMOTE_KEY_PATH="$REMOTE_KEY_DIR/codex_ops_ed25519"

ssh "$CONTROL_ALIAS" bash -s <<EOF
set -euo pipefail
sudo mkdir -p "$REMOTE_KEY_DIR"
sudo chown -R ubuntu:ubuntu "$REMOTE_KEY_DIR"
chmod 700 "$REMOTE_KEY_DIR"

if [ ! -f "$REMOTE_KEY_PATH" ]; then
  ssh-keygen -t ed25519 -N '' -C 'server-codex-ops-150' -f "$REMOTE_KEY_PATH"
fi

chmod 600 "$REMOTE_KEY_PATH"
chmod 644 "$REMOTE_KEY_PATH.pub"
ssh-keyscan -H 43.155.136.111 43.155.163.114 43.131.232.150 >> "$REMOTE_KEY_DIR/known_hosts" 2>/dev/null || true
sort -u "$REMOTE_KEY_DIR/known_hosts" -o "$REMOTE_KEY_DIR/known_hosts"
chmod 600 "$REMOTE_KEY_DIR/known_hosts"
cat > "$REMOTE_KEY_DIR/config" <<'CONFIG'
Host ecs-111
  HostName 43.155.136.111
  User ubuntu
  IdentityFile /srv/codex/secrets/ssh/codex_ops_ed25519
  IdentitiesOnly yes
  UserKnownHostsFile /srv/codex/secrets/ssh/known_hosts
  StrictHostKeyChecking yes

Host ecs-114
  HostName 43.155.163.114
  User ubuntu
  IdentityFile /srv/codex/secrets/ssh/codex_ops_ed25519
  IdentitiesOnly yes
  UserKnownHostsFile /srv/codex/secrets/ssh/known_hosts
  StrictHostKeyChecking yes

Host srv-43-155-163-114
  HostName 43.155.163.114
  User ubuntu
  IdentityFile /srv/codex/secrets/ssh/codex_ops_ed25519
  IdentitiesOnly yes
  UserKnownHostsFile /srv/codex/secrets/ssh/known_hosts
  StrictHostKeyChecking yes

Host ecs-150 local-150 srv-43-131-232-150
  HostName 43.131.232.150
  User ubuntu
  IdentityFile /srv/codex/secrets/ssh/codex_ops_ed25519
  IdentitiesOnly yes
  UserKnownHostsFile /srv/codex/secrets/ssh/known_hosts
  StrictHostKeyChecking yes
CONFIG
chmod 600 "$REMOTE_KEY_DIR/config"
EOF

PUBLIC_KEY="$(ssh "$CONTROL_ALIAS" "cat '$REMOTE_KEY_PATH.pub'")"

for target in "${TARGET_ALIASES[@]}"; do
  printf 'Installing 150 ops public key on %s\n' "$target"
  ssh "$target" "mkdir -p ~/.ssh && chmod 700 ~/.ssh && touch ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys && grep -qxF '$PUBLIC_KEY' ~/.ssh/authorized_keys || printf '%s\n' '$PUBLIC_KEY' >> ~/.ssh/authorized_keys"
done

ssh "$CONTROL_ALIAS" "ssh -F '$REMOTE_KEY_DIR/config' -o BatchMode=yes ecs-111 'echo ecs-111-ok' && ssh -F '$REMOTE_KEY_DIR/config' -o BatchMode=yes ecs-114 'echo ecs-114-ok' && ssh -F '$REMOTE_KEY_DIR/config' -o BatchMode=yes srv-43-131-232-150 'echo srv-43-131-232-150-ok'"
