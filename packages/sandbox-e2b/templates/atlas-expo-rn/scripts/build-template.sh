#!/usr/bin/env bash
# Build + push the atlas-expo-rn E2B template image.
# Usage: ./scripts/build-template.sh
# Requires: E2B_API_KEY env var set; npx + node 22+ available.

set -euo pipefail

if [[ -z "${E2B_API_KEY:-}" ]]; then
  echo "ERROR: E2B_API_KEY env var not set."
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR/.."

echo "Building atlas-expo-rn E2B template (this takes ~10-12 min - Metro bundle on first start)..."
# IMPORTANT: pass --cmd / --ready-cmd / --memory-mb explicitly. The E2B CLI
# does NOT auto-read these from e2b.toml — earlier debugging surprise. The
# e2b.toml file documents the canonical values; this script is the single
# source of truth for what actually gets registered server-side.
npx --yes @e2b/cli template create atlas-expo-rn \
  --cmd "cd /code && pnpm install --no-frozen-lockfile && exec ./node_modules/.bin/expo start --web --port 3000" \
  --ready-cmd "curl -fsS http://localhost:3000 > /dev/null" \
  --memory-mb 4096

echo ""
echo "Build complete. Capture the printed Template ID and add it to e2b.toml's template_id field, then commit."
