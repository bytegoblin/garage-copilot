#!/usr/bin/env bash
# Garage Copilot setup: installs MCP server dependencies (workshop memory, pdf reader) and creates the databases.
# Safe to re-run: existing databases are never overwritten.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MCP_DIR="$ROOT/mcp/workshop-memory"
PDF_DIR="$ROOT/mcp/pdf-reader"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required (>= 22.13). Install it, e.g. 'nvm install' in the repo root." >&2
  exit 1
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
NODE_MINOR="$(node -p 'process.versions.node.split(".")[1]')"
if [ "$NODE_MAJOR" -lt 22 ] || { [ "$NODE_MAJOR" -eq 22 ] && [ "$NODE_MINOR" -lt 13 ]; }; then
  echo "Node.js >= 22.13 is required (found $(node -v)). Run 'nvm install' in the repo root." >&2
  exit 1
fi

echo "Installing MCP server dependencies..."
(cd "$MCP_DIR" && npm ci --no-audit --no-fund)
(cd "$PDF_DIR" && npm ci --no-audit --no-fund)

mkdir -p "$ROOT/data"

# Personal database: empty schema, filled during onboarding in /garage.
node "$MCP_DIR/init-db.mjs" "$ROOT/data/garage.db"

# Demo database with a fictional master, used for the committed demo runs.
if [ ! -f "$ROOT/data/demo.db" ]; then
  node "$MCP_DIR/init-db.mjs" "$ROOT/data/demo.db" --seed "$MCP_DIR/seed.demo.sql"
else
  echo "Exists: $ROOT/data/demo.db"
fi

echo "Running MCP smoke tests..."
(cd "$MCP_DIR" && npm test --silent 2>&1 | grep -v -e ExperimentalWarning -e trace-warnings)
(cd "$PDF_DIR" && npm test --silent 2>&1 | grep -v -e ExperimentalWarning -e trace-warnings)

echo "Setup complete."
