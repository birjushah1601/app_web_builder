#!/usr/bin/env bash
# Build + push the atlas-next-ts E2B template image.
# Usage: ./scripts/build-template.sh
# Requires: E2B_API_KEY env var set; npx + node 22+ available.

set -euo pipefail

if [[ -z "${E2B_API_KEY:-}" ]]; then
  echo "ERROR: E2B_API_KEY env var not set."
  echo "Get one from https://e2b.dev → Dashboard → API Keys"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR/.."

echo "Building atlas-next-ts E2B template (this takes ~3-5 min)..."
npx --yes @e2b/cli template build

echo ""
echo "Build complete. Capture the printed Template ID and update:"
echo "  apps/atlas-web/.env.local  →  ATLAS_DEFAULT_SANDBOX_TEMPLATE=atlas-next-ts"
echo ""
echo "Then restart atlas-web (pnpm -F atlas-web dev) and provision a new sandbox to test."
