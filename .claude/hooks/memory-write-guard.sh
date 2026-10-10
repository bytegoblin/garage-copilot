#!/usr/bin/env bash
# Thin entrypoint; the logic is in memory-write-guard.mjs. Reads the hook JSON from stdin.
exec node "$(dirname "$0")/memory-write-guard.mjs"
