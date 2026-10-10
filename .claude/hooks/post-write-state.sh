#!/usr/bin/env bash
# Thin entrypoint; the logic is in post-write-state.mjs. Reads the hook JSON from stdin.
exec node "$(dirname "$0")/post-write-state.mjs"
