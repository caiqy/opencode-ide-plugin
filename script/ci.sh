#!/bin/sh

set -eu

# Run this from anywhere; normalize to repo root (parent of this script dir)
SCRIPT_DIR="$(dirname "$0")"
cd "${SCRIPT_DIR}/.."

# Ensure Bun is available
if ! command -v bun >/dev/null 2>&1; then
  echo "bun is not installed or not in PATH" >&2
  exit 1
fi

# Install dependencies (similar to what setup-bun/action does)
if [ -f "bun.lock" ] || [ -f "package.json" ]; then
  echo "Running bun install..."
  bun install
fi

# Mirror the main GitHub CI steps (excluding format job for local runs)
# 1) From .github/workflows/test.yml
echo "Running bun turbo typecheck..."
bun turbo typecheck

echo "Running bun turbo test..."
bun turbo test

# 2) From .github/workflows/typecheck.yml
#    (PRs to dev): bun typecheck
#    Running it here ensures it also passes locally
echo "Running bun typecheck..."
bun typecheck

echo "✅ Local CI checks finished"
