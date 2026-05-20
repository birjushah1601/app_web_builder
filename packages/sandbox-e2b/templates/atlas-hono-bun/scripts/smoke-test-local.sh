#!/usr/bin/env bash
# Build the template image locally (no push to E2B) and curl it.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR/.."

IMAGE_TAG="atlas-hono-bun:smoke"
CONTAINER_NAME="atlas-hono-bun-smoke"

echo "Building local image $IMAGE_TAG..."
docker build -t "$IMAGE_TAG" .

docker rm -f "$CONTAINER_NAME" 2>/dev/null || true

echo "Starting container on port 3001..."
docker run -d --name "$CONTAINER_NAME" -p 3001:3001 "$IMAGE_TAG"

echo "Waiting for Hono to come up..."
for i in {1..30}; do
  if curl -fsS http://localhost:3001/health > /dev/null; then
    echo "OK http://localhost:3001/health returns 200"
    curl -s http://localhost:3001/health
    echo ""
    echo "Cleanup: docker rm -f $CONTAINER_NAME"
    exit 0
  fi
  sleep 1
done

echo "FAIL: Hono did not come up within 30s. Logs:"
docker logs "$CONTAINER_NAME"
exit 1
