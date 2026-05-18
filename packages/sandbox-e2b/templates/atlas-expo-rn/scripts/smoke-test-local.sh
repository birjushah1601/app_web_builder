#!/usr/bin/env bash
# Build the template image locally (no push to E2B) and curl the Expo web
# bundle. Confirms Metro comes up + serves the index HTML.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR/.."

IMAGE_TAG="atlas-expo-rn:smoke"
CONTAINER_NAME="atlas-expo-rn-smoke"

echo "Building local image $IMAGE_TAG..."
docker build -t "$IMAGE_TAG" .

docker rm -f "$CONTAINER_NAME" 2>/dev/null || true

echo "Starting container on port 3000..."
docker run -d --name "$CONTAINER_NAME" -p 3000:3000 "$IMAGE_TAG"

echo "Waiting for Expo web bundle to come up (Metro can take 60-120s on first boot)..."
for i in {1..120}; do
  if curl -fsS http://localhost:3000 > /dev/null 2>&1; then
    echo "OK http://localhost:3000 returns 200"
    echo "  (response headers - first 5 lines:)"
    curl -sI http://localhost:3000 | head -5
    echo ""
    echo "Cleanup: docker rm -f $CONTAINER_NAME"
    exit 0
  fi
  sleep 1
done

echo "FAIL Expo web bundle did not come up within 120s. Logs:"
docker logs "$CONTAINER_NAME"
exit 1
