#!/usr/bin/env bash
# Build the template image locally (no push to E2B) and curl it.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR/.."

IMAGE_TAG="atlas-graphql-yoga:smoke"
CONTAINER_NAME="atlas-graphql-yoga-smoke"

echo "Building local image $IMAGE_TAG..."
docker build -t "$IMAGE_TAG" .

docker rm -f "$CONTAINER_NAME" 2>/dev/null || true

echo "Starting container on port 3001..."
docker run -d --name "$CONTAINER_NAME" -p 3001:3001 "$IMAGE_TAG"

echo "Waiting for Bun + Yoga to come up..."
for i in {1..30}; do
  if curl -fsS http://localhost:3001/health > /dev/null; then
    echo "OK http://localhost:3001/health returns 200"
    curl -s http://localhost:3001/health
    echo ""
    echo ""
    echo "Smoke-checking GraphQL { hello } ..."
    curl -s -X POST http://localhost:3001/graphql \
      -H "content-type: application/json" \
      -d '{"query":"{ hello }"}'
    echo ""
    echo ""
    echo "Cleanup: docker rm -f $CONTAINER_NAME"
    exit 0
  fi
  sleep 1
done

echo "FAIL Bun.serve did not come up within 30s. Logs:"
docker logs "$CONTAINER_NAME"
exit 1
