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

pkill -f "src/server/Server.ts" 2>/dev/null || true

GAME_ENV=prod EXTERNAL_API=false PROXY_WORKERS=true PORT=8080 \
NUM_WORKERS=2 INSTANCE_LETTER=a DOMAIN=localhost \
TURNSTILE_SITE_KEY=1x00000000000000000000AA GIT_COMMIT=codespace \
SOURCE_URL=https://github.com/zhx8/openfront-custom \
SOCIAL_DATA_FILE="$PWD/data/social.json" \
# setsid: fully detached, so it outlives this startup script (Codespaces
# ends the script's process group when it returns).
setsid nohup npm run start:server > data/server.log 2>&1 < /dev/null &

# Wait for the server, then open the port to everyone.
for _ in $(seq 1 60); do
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
