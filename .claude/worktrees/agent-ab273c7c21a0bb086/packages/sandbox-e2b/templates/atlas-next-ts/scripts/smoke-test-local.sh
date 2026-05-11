#!/usr/bin/env bash
# Build the template image locally (no push to E2B) and curl it.
# Catches Dockerfile bugs without burning E2B build credits.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR/.."

IMAGE_TAG="atlas-next-ts:smoke"
CONTAINER_NAME="atlas-next-ts-smoke"

echo "Building local image $IMAGE_TAG..."
docker build -t "$IMAGE_TAG" .

# Stop any prior smoke-test container.
docker rm -f "$CONTAINER_NAME" 2>/dev/null || true

echo "Starting container on port 3000..."
docker run -d --name "$CONTAINER_NAME" -p 3000:3000 "$IMAGE_TAG"

# Wait up to 30s for dev server to come up.
echo "Waiting for dev server..."
for i in {1..30}; do
  if curl -fsS http://localhost:3000 > /dev/null; then
    echo "✓ http://localhost:3000 returns 200"
    echo "Open http://localhost:3000 in a browser to visually verify the smoke-test page."
    echo ""
    echo "Cleanup: docker rm -f $CONTAINER_NAME"
    exit 0
  fi
  sleep 1
done

echo "✗ Dev server did not come up within 30s. Check logs:"
docker logs "$CONTAINER_NAME"
exit 1
