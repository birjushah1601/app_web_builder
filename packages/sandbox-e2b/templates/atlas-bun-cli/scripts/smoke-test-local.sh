#!/usr/bin/env bash
# Build the template image locally (no push to E2B), curl the status page,
# and exec the example CLI subcommand to prove Bun + Commander + ink wire up.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR/.."

IMAGE_TAG="atlas-bun-cli:smoke"
CONTAINER_NAME="atlas-bun-cli-smoke"

echo "Building local image $IMAGE_TAG..."
docker build -t "$IMAGE_TAG" .

docker rm -f "$CONTAINER_NAME" 2>/dev/null || true

echo "Starting container on port 3001..."
docker run -d --name "$CONTAINER_NAME" -p 3001:3001 "$IMAGE_TAG"

echo "Waiting for status page to come up..."
for i in {1..30}; do
  if curl -fsS http://localhost:3001 > /dev/null; then
    echo "OK http://localhost:3001 returns 200"
    echo "First 80 bytes:"
    curl -s http://localhost:3001/ | head -c 80
    echo ""

    echo "Exec'ing the example CLI subcommand inside the container..."
    docker exec "$CONTAINER_NAME" bun run src/cli.ts hello --name smoke || {
      echo "FAIL: CLI exec failed."
      docker logs "$CONTAINER_NAME"
      exit 1
    }

    echo ""
    echo "Cleanup: docker rm -f $CONTAINER_NAME"
    exit 0
  fi
  sleep 1
done

echo "FAIL: Status page did not come up within 30s. Logs:"
docker logs "$CONTAINER_NAME"
exit 1
