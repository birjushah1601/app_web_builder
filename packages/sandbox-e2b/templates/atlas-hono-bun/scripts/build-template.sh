#!/usr/bin/env bash
# Build + push the atlas-hono-bun E2B template image.
# Usage: ./scripts/build-template.sh
# Requires: E2B_API_KEY env var set; npx + node 22+ available.

set -euo pipefail

if [[ -z "${E2B_API_KEY:-}" ]]; then
  echo "ERROR: E2B_API_KEY env var not set."
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR/.."

echo "Building atlas-hono-bun E2B template (this takes ~2-4 min)..."
npx --yes @e2b/cli template create atlas-hono-bun

echo ""
echo "Build complete. Capture the printed Template ID and add it to e2b.toml's template_id field, then commit."
