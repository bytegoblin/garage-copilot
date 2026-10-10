# Hook probe

Date: 2026-10-11
Run: `20261011-0034-hook-probe` (throw-away, removed after the check)
Method: a `general-purpose` subagent attempted five actions once each, without retries or workarounds.
Error text is the first ~100 characters as reported by the subagent (not the full hook message).

| # | Action | Expected | Observed | First line of the error |
|---|---|---|---|---|
| a | Write `artifacts/final-plan.md` with internal names in the text | BLOCKED by no-leak-guard | BLOCKED | `Blocked: user-facing text contains internal names (research-bonding.md, cost-planner). Rewrite it so that the master` |
| b | Write `output/garage-plan.html` without approval | BLOCKED by approval-gate-guard | BLOCKED | `Blocked: final output cannot be written - the plan has not been approved yet. The master must approve the current pl` |
| c | Write `workflow-state.json` directly | BLOCKED by approval-gate-guard | BLOCKED | `Blocked: workflow-state.json is written only by the workflow scripts, never edited directly.` |
| d | Write `artifacts/research.md` | ALLOWED, then `diy-researcher` is `created` without a manual `artifact-written` | ALLOWED; `state.mjs summary` shows `diy-researcher  created  attempts=1  artifacts/research.md` | (none) |
| e | MCP `record_purchase` with `run_id` of the unapproved run | BLOCKED by memory-write-guard | BLOCKED | `Blocked: memory is updated from a run only after its plan is approved - the plan has not been approved yet.` |

Verdict: **PASS** — all five attempts matched the expected result. No `HOOK PROBE` row was written to the purchases table.

## Independent confirmation

The table above is the subagent's own report. It was cross-checked against the subagent's transcript
(session `95d4e4b5`, `subagents/agent-ac61406e….jsonl`): every blocked call carries a tool result
`PreToolUse:<tool> hook error: [bash "$CLAUDE_PROJECT_DIR/.claude/hooks/<guard>.sh"]: Blocked: …` with the guard
named, the clean `research.md` write returned `File created successfully`, and the `purchases` table of
`data/demo.db` and `data/garage.db` contains no `HOOK PROBE` row. The hooks therefore run for tool calls made
inside subagents, and an MCP tool call is covered by the same PreToolUse mechanism.
