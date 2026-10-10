#!/usr/bin/env bash
# Thin entrypoint; the logic is in approval-gate-guard.mjs. Reads the hook JSON from stdin.
exec node "$(dirname "$0")/approval-gate-guard.mjs"
