#!/usr/bin/env bash
# Builds the dpp-ai image from this folder and (re)starts the service on the server.
# Safe to run again: settings in /etc/dpp-ai/env and the spend record in /var/lib/dpp-ai are kept.
#
#   bash deploy.sh          build and restart
#   bash deploy.sh restart  restart only (after editing /etc/dpp-ai/env or setting the passcode)
set -euo pipefail
cd "$(dirname "$0")"

ENV_DIR=/etc/dpp-ai
ENV_FILE=$ENV_DIR/env
STATE_DIR=/var/lib/dpp-ai
IMAGE=dpp-ai:local
NAME=dpp-ai
PORT=5024

# The service runs as uid 1000 inside the container (the "ubuntu" user on this server).
sudo mkdir -p "$ENV_DIR" "$STATE_DIR"
if ! sudo test -f "$ENV_FILE"; then
  sudo cp env.example "$ENV_FILE"
  echo "Created $ENV_FILE from env.example"
fi
sudo chown -R 1000:1000 "$ENV_DIR" "$STATE_DIR"
sudo chmod 700 "$ENV_DIR" "$STATE_DIR"
sudo chmod 600 "$ENV_FILE"

if [ "$#" -eq 0 ] || [ "$1" != "restart" ]; then
  docker build -t "$IMAGE" .
fi

docker rm -f "$NAME" >/dev/null 2>&1 || true
# Published on the server's own loopback only: nginx is the one way in from outside.
docker run -d --name "$NAME" --restart unless-stopped \
  -p 127.0.0.1:$PORT:$PORT \
  --env-file "$ENV_FILE" \
  -v "$STATE_DIR":/data \
  --memory 192m --memory-swap 384m \
  --log-opt max-size=5m --log-opt max-file=3 \
  "$IMAGE" >/dev/null

for i in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS "http://127.0.0.1:$PORT/healthz" >/dev/null 2>&1; then
    echo "dpp-ai is up:"
    curl -fsS "http://127.0.0.1:$PORT/api/ai/status"
    echo
    exit 0
  fi
  sleep 1
done
echo "dpp-ai did not come up. Last log lines:" >&2
docker logs --tail 20 "$NAME" >&2
exit 1
