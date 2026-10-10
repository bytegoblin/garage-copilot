#!/usr/bin/env bash
# Thin entrypoint; the logic is in no-leak-guard.mjs. Reads the hook JSON from stdin.
exec node "$(dirname "$0")/no-leak-guard.mjs"
