#!/usr/bin/env bash
# Runs every time the codespace starts: launch the game server in the
# background on port 8080 and make that port public, so anyone with the
# link can play.
set -uo pipefail
cd "$(dirname "$0")/.."
mkdir -p data

# Secrets are generated once per codespace and kept in data/ (git-ignored).
if [ ! -f data/secrets.env ]; then
  {
    echo "API_KEY=$(openssl rand -hex 16)"
    echo "ADMIN_BOT_API_KEY=$(openssl rand -hex 16)"
    echo "SOCIAL_ADMIN_KEY=$(openssl rand -hex 16)"
  } > data/secrets.env
fi
set -a
. data/secrets.env
set +a

export GAME_ENV=prod
export EXTERNAL_API=false
export PROXY_WORKERS=true
export PORT=8080
export NUM_WORKERS=2
export INSTANCE_LETTER=a
export DOMAIN=localhost
export TURNSTILE_SITE_KEY=1x00000000000000000000AA
export GIT_COMMIT=codespace
export SOURCE_URL=https://github.com/zhx8/openfront-custom
export SOCIAL_DATA_FILE="$PWD/data/social.json"

pkill -f "src/server/Server.ts" 2>/dev/null || true

# setsid: fully detached, so the server outlives this startup script
# (Codespaces ends the script's process group when it returns).
setsid nohup npm run start:server > data/server.log 2>&1 < /dev/null &

# Wait for the server, then open the port to everyone.
for _ in $(seq 1 90); do
  curl -sf http://localhost:8080/api/health > /dev/null && break
  sleep 2
done
gh codespace ports visibility 8080:public -c "$CODESPACE_NAME" || true

URL="https://${CODESPACE_NAME}-8080.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}"
echo "$URL" > data/url.txt
echo
echo "============================================================"
echo " Game is live: $URL"
echo " (share this link; it stays up while the codespace runs)"
echo "============================================================"
