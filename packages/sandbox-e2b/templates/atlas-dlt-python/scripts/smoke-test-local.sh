#!/usr/bin/env bash
# Build the template image locally (no push to E2B) and curl /health + /runs + /pipelines.
# Verifies (a) the build succeeds, (b) the FastAPI status app boots, (c) the
# /runs and /pipelines endpoints respond.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR/.."

IMAGE_TAG="atlas-dlt-python:smoke"
CONTAINER_NAME="atlas-dlt-python-smoke"

echo "Building local image $IMAGE_TAG..."
docker build -t "$IMAGE_TAG" .

docker rm -f "$CONTAINER_NAME" 2>/dev/null || true

echo "Starting container on port 3000..."
docker run -d --name "$CONTAINER_NAME" -p 3000:3000 "$IMAGE_TAG"

echo "Waiting for FastAPI status app to come up..."
for i in {1..30}; do
  if curl -fsS http://localhost:3000/health > /dev/null; then
    echo "✓ http://localhost:3000/health returns 200"
    curl -s http://localhost:3000/health
    echo ""
    echo "Checking /runs..."
    curl -s http://localhost:3000/runs
    echo ""
    echo "Checking /pipelines..."
    curl -s http://localhost:3000/pipelines
    echo ""
    echo "Cleanup: docker rm -f $CONTAINER_NAME"
    exit 0
  fi
  sleep 1
done

echo "✗ FastAPI did not come up within 30s. Logs:"
docker logs "$CONTAINER_NAME"
exit 1
