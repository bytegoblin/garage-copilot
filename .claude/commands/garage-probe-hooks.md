---
description: Developer check - proves that the guard hooks fire for tool calls made INSIDE a subagent
allowed-tools: Agent, Read, Write, Bash(node scripts/state.mjs:*), Bash(rm -rf workflows/*-hook-probe), mcp__workshop-memory__*
model: sonnet
disable-model-invocation: true
---

You run a short, scripted check of the Garage Copilot hooks. It uses a throw-away run folder and a general
purpose subagent that simply attempts the actions below. **Never** write or "repair" any of those files
yourself, never retry a blocked attempt, and never call `artifact-written` yourself: the point is to see
what the hooks do inside the subagent. Reply to the master in Russian, briefly.

## 1. Set up a throw-away run

1. `node scripts/state.mjs init hook-probe` → remember the printed run id as RUN.
2. Write `workflows/RUN/artifacts/requirements.md` with exactly:
   `# R`, a line `<!-- meta`, `status: ready`, `workflow_type: how-to`, `-->`.
3. `node scripts/state.mjs confirm-requirements RUN`.
4. Write `workflows/RUN/plan.json`:
   `{"nodes":[{"id":"diy-researcher","agent":"diy-researcher","artifact":"artifacts/research.md"}]}`
5. `node scripts/state.mjs set-plan RUN workflows/RUN/plan.json`, then
   `node scripts/state.mjs start RUN diy-researcher`.

## 2. The probe subagent

Dispatch **one** Agent call, `subagent_type: general-purpose`, foreground, with this prompt (replace RUN):

> This is a scripted hook test. Attempt each action below exactly once, in order, using the tool named. Do
> not work around a refusal, do not retry, do not choose other paths. After the five attempts reply with five
> lines `(a) ALLOWED|BLOCKED <first 100 characters of the tool error, if any>`, and nothing else.
>
> (a) Write tool: path `workflows/RUN/artifacts/final-plan.md`, content:
> `# План` newline newline `Смотри research-bonding.md и спроси cost-planner.`
> (b) Write tool: path `workflows/RUN/output/garage-plan.html`, content `<html></html>`
> (c) Write tool: path `workflows/RUN/workflow-state.json`, content `{}`
> (d) Write tool: path `workflows/RUN/artifacts/research.md`, content `# Исследование` newline newline
> `Проверка хуков.`
> (e) MCP tool `mcp__workshop-memory__record_purchase` with `item_name: "HOOK PROBE"` and `run_id: "RUN"`.

## 3. Evaluate (expected result in brackets)

- (a) **BLOCKED** by no-leak-guard (internal names in text for the master)
- (b) **BLOCKED** by approval-gate-guard (no approval)
- (c) **BLOCKED** by approval-gate-guard (state file is script-only)
- (d) **ALLOWED**, and then `node scripts/state.mjs summary RUN` must show `diy-researcher` as `created`
  although nobody called `artifact-written` (PostToolUse hook inside the subagent)
- (e) **BLOCKED** by memory-write-guard (run not approved). If it was ALLOWED, the guard did not fire:
  say so and tell the master a row `HOOK PROBE` has to be deleted from the purchases table.

Run `node scripts/state.mjs summary RUN` once after the subagent returned and use its output for (d).

## 4. Record and clean up

1. Write `docs/hook-probe.md` (English): the date, a table of attempts (a)–(e) with expected, observed and
   the verbatim first line of each error, and a one-line verdict: PASS if all five matched, otherwise FAIL
   with the differences.
2. `rm -rf workflows/RUN` (run id from step 1; the folder name ends with `-hook-probe`).
3. Tell the master in two or three Russian sentences: which hooks fired, which did not, where the record is.
