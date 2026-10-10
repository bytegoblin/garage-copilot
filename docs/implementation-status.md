# Implementation status

Single source of truth for progress. Read this first when resuming work in a new session.
Update it in the same change as the work it describes. Status values:

- **done** — implemented and verified as described in the "Verified by" column
- **built, unverified** — implemented but not yet exercised end to end
- **todo** — not started

Plan and design: `docs/garage-copilot-design.md` (sections 18 and 19). Deadline: 2026-10-15.

## Current position

- **Last completed step:** 13 (Day 3). The run `20261010-1232-garage-tiles` is COMPLETE up to validation
  (all 7 gates PASS, ~19 min for the resumed leg).
- **Next step:** Day 4 — step 14 `synthesizer` + `final-plan.md` template, then step 15 approval commands,
  step 16 HTML builder, step 17 memory write-back.
- **Open question for the master:** none

## Steps

| # | Step | Day | Status | Verified by |
|---|------|-----|--------|-------------|
| 1 | git repo, `.gitignore`, `.nvmrc`, `config/workflow.json`, background docs moved | 1 | done | `git check-ignore` confirms DBs and `node_modules` ignored |
| 2 | `workshop-memory` MCP server: schema, seed, 9 tools, `scripts/setup.sh` | 1 | done | `npm test` smoke test over real stdio passes; `setup.sh` run from scratch |
| 3 | `.mcp.json`; Claude Code lists the server and its tools | 1 | done | Live session 2026-10-10: server connected, profile read via MCP |
| 4 | `CLAUDE.md` draft | 1 | done | Reviewed |
| 5 | `/garage` skeleton: onboarding, intake, `requirements-formalizer`, Q&A loop, confirmation | 1 | done | Live run `20261010-1232-garage-tiles`: Q&A, a correction round, confirmation, state written |
| 6 | `scripts/state.mjs` full (set-plan, ready, start, artifact-written, stage-gate, fail, invalidate --cascade, unblock, verify, summary) | 2 | done | `node --test scripts/test/state.test.mjs`: 13 tests (sequential, parallel, retry, limit, cascade, hash checks, approval gate) |
| 7 | `artifact-validator` skill, templates (5 types), `scripts/check-artifact.mjs` | 2 | done | `node --test scripts/test/check-artifact.test.mjs`: 6 tests; also caught a real defect (missing `Источники`) in the live requirements artifact |
| 8 | `research-evidence` skill (budget, locality, no PDF), playbooks `trade-tiling`, `trade-carpentry` | 2 | done | Run `20261010-1232-garage-tiles` (session 788e8d87): every researcher used exactly 6 searches / 8 fetches; sources mostly `.pl`, 1 tagged foreign source |
| 9 | `diy-researcher`, `product-researcher`, `project-planner`, `cost-planner` | 2 | done | Same run: all 4 agent types produced artifacts that passed G0 on the first attempt, within size caps |
| 10 | Coordinator: DAG building, parallel dispatch, stage gate after each node, `resume` entry point | 2 | done | Same run: plan reset, 3 parallel research nodes, 2 parallel product nodes, no duplicate dispatch, all 8 nodes validated, ~12.5 min |
| 11 | `evidence-validator`, G1–G7, domain gates, targeted retry, cascade, retry limit | 3 | done | Live run `20261010-1232-garage-tiles` (session a3eb908f): validator FAIL (G2/G4/G6) → only the owner nodes re-ran, dependents regenerated, unrelated artifacts untouched → PASS at domain-gate attempt 3; 7 unit tests |
| 12 | Hooks: `post-write-state`, `approval-gate-guard`, `no-leak-guard`, `memory-write-guard`; `.claude/settings.json` | 3 | built, partly verified | 12 hook tests. Live: PostToolUse registers artifacts written by subagents (coordinator's own `artifact-written` call was a silent no-op); `approval-gate-guard` fired in the main session. **Not yet exercised live:** PreToolUse inside subagents, `no-leak-guard`, `memory-write-guard` (need Day 4 stages) |
| 13 | Resume flow (`/garage resume`) | 3 | done | Live: session interrupted mid-`cost-planner`; `resume` → `verify` detected the node, re-ran only it and the validator, nothing validated was repeated, no duplicate dispatch |
| 14 | `synthesizer`, fixed final structures | 4 | todo | |
| 15 | `scripts/approve.mjs`, `/garage-approve`, `/garage-reject`, revision loop | 4 | todo | |
| 16 | `garage-html-theme` skill, `final-output-builder` | 4 | todo | |
| 17 | Memory write-back after approval | 4 | todo | |
| 18 | Demo runs 1–3 committed under `workflows/` | 5 | todo | |
| 19 | Final `CLAUDE.md`, `README.md` complete | 5 | todo | |
| 20 | Clean-checkout test | 5 | todo | |
| 21 | Secret scan, traceability table updated | 5 | todo | |

## Decisions made during implementation

- Node 22.23.1 on the master's machine; `node:sqlite` used without a native dependency (requires >= 22.13).
- `data/*.db` is git-ignored because the repository is public; `data/demo.db` holds a fictional master.
- `task_description.md` stays in the repo root; brainstorm files are in `docs/background/`.
- Git repository initialised, **no commits yet** (commit only when the master asks).
- `state.mjs` is a CLI only (no exports); tests drive it through the CLI with `GARAGE_WORKFLOWS_DIR`.
- Structural gate G0 requires the exact `##` heading list of each template; headings are the contract.
- The live requirements artifact of run `20261010-1232-garage-tiles` lacked the closing `## Источники` section;
  it was appended by hand (`Не применимо.`) and requirements were re-confirmed with `state.mjs`. The formalizer
  prompt now states the section is mandatory and the coordinator runs G0 on `requirements.md`.
- Day 2 plans end at `cost-planner`; `evidence-validator`, `synthesizer`, `final-output-builder` are not in
  plans until implemented.
- Research control (after first live run of `diy-researcher`): hard depth budgets (`quick` 6/8, `standard`
  12/15 searches/fetches) in `config/workflow.json`, enforced by prompt only (no hook counter yet);
  national sources first, at most 2 tagged foreign sources, checked by `check-artifact.mjs`; research
  split into parallel topic nodes per trade playbook; playbooks are question checklists without facts.
- Findings from the second live run (22 min; `3f3252de-...`): duplicate dispatch of a still-running node
  (fixed: foreground dispatch; `verify` resolves `running` only at resume start), agents lacked `Edit` and
  rewrote whole files (fixed: `Edit` added, "write once, edit on retry" rule), artifacts were 20–48 KB
  (fixed: per-type character caps in `config/workflow.json` `artifact_max_chars`, enforced by G0).
- PDF documents are not fetched (decision of the master: token cost for the MVP); research uses HTML pages
  only and records PDF-only facts as unknown. No poppler dependency.
- Third live run (session 788e8d87): 12.5 min vs 22 min before. Known remaining inefficiencies: agents
  size their text blindly, so 3 of 5 writers rewrote the whole file once to get under the cap and one tried
  `Bash` (not in its tools); they should aim for ~80 % of the cap. Product research at `quick` depth left
  R17 (turnkey price comparison) and a few prices unfound: a gap for G6/G7 and a targeted retry to handle.
- Agent prompts now say: aim for ~80 % of the size cap, no polishing micro-edits, no shell (round 3 finding).
- Hooks: heuristic Bash inspection strips heredoc bodies and ignores `=>`; it cannot see writes made by an
  interpreter in ways it does not parse. Write/Edit checks and the approval hash check are exact.
- `state.mjs` gained `domain-gates` (applies validation.md: FAIL rows → owner node retry + cascade; a row
  owned by the requirements node becomes ASK_MASTER) and `add-nodes` (append nodes to a running plan).
- Bug found on the first interrupted run with the validator: `verify` took an artifact from an earlier attempt
  (older than the node's restart) for the result of the interrupted attempt. Fixed: `start` records
  `started_at`, `verify` accepts the file only if its mtime is not older; otherwise the node is `stale`.
- Fourth live run findings: a retry round used 41 and 27 single-cell `Edit` calls (5.7 and 2.9 min); when
  more than a handful of places change, one full `Write` is cheaper. Carry-over for the synthesizer: the
  budget is a range (about 1174 PLN without adhesive, up to ~1811 PLN with it) because the adhesive class
  is unconfirmed; the validator noted that some tool entries must be dropped from the final plan.
- Expected full-cycle duration is ~35 min per run; reduction deferred until after the MVP is complete.
- Resume (`/garage resume`) works through `state.mjs verify` + the normal execution loop; hooks (step 12) will
  call `artifact-written` automatically. Until then the coordinator calls it after each subagent.

## Known gaps and risks

- Hooks inside subagents untested (planned for step 12).
- `ExperimentalWarning` from `node:sqlite` is expected and harmless; mention it in the README.
