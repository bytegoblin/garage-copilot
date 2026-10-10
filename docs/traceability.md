# Requirements traceability

Maps every statement of [`task_description.md`](../task_description.md) to the implementation and to the
evidence that it works. This file is the authoritative status; `docs/implementation-status.md` tracks the
work steps and `docs/garage-copilot-design.md` is the original design (with an implementation-notes block).

Verified after the third demo run (commit `48e8727` plus the documentation and Run 3 commits).

Legend: ✅ verified in a live run · 🧪 verified by automated tests only · ⚠️ partially verified or deviating ·
❌ missing.

Evidence abbreviations: **Run 1** = `workflows/20261010-1232-garage-tiles` (regular graph, 11 nodes),
**Run 2** = `workflows/20261010-1806-hanging-cabinet-beech` (small graph, 8 nodes),
**Run 3** = `workflows/20261010-2340-bosch-gas15ps-dust-extraction` (`purchase-decision`, parallel research and
product nodes, 7 nodes). Tests: `node --test
scripts/test/*.test.mjs` (79) and `cd mcp/workshop-memory && npm test`.

## A. Architecture and requirements

| # | Statement in the task | Implementation | Evidence | |
|---|---|---|---|---|
| 1 | Invoked by a custom slash command that instantiates the coordinator | `.claude/commands/garage.md` (+ `garage-approve.md`, `garage-reject.md`) | Both runs started with `/garage` | ✅ |
| 2 | Model-driven hub-and-spoke, dynamic subagent selection | Coordinator selection rules (regular / small / purchase / how-to graphs), playbook by request | Run 1: 11 nodes with 3 parallel research nodes; Run 2: small path, 7 nodes; Run 3: `purchase-decision`, research ∥ products | ✅ |
| 3 | Single responsibility and explicit artifact ownership | 8 agents; `meta.owner` per artifact; `check-artifact.mjs` verifies owner | G0 PASS on all 16 artifacts of both runs | ✅ |
| 4 | Consistent output structure, passed to a dedicated synthesis subagent | Artifact templates; `synthesizer` → `final-plan.md` | Both runs | ✅ |
| 5 | Dependent run sequentially, independent in parallel | DAG in `state.mjs` (`ready`, `start-ready`), parallel Agent calls | Run 1: parallel research ×3, products ×2 | ✅ |
| 6 | Explicit quality gates; targeted re-run of only affected agents | G0 (structure, per artifact) and G1–G7 (`evidence-validator`) → `domain-gates` maps findings to owner nodes | Run 1 and Run 2: validator FAIL → only owner nodes and dependents re-ran | ✅ |
| 7 | Retry limit; downstream regenerated; unresolved failure stops dependents and is reported | `max_retries` = 3, cascade invalidation, `blocked` / `skipped`, `# BLOCKED` | Cascade and retry live (Run 1/2). **Blocked state only by tests** (`state.test.mjs`, `composite.test.mjs`) | ⚠️ |
| 8 | Final output only after explicit, deterministically verified approval | `/garage-approve` → `approve.mjs`; approval bound to SHA-256 of the presented plan; hook checks the transcript for the human-typed command; renderer re-checks | Run 1 and Run 2: reject → revision → approve; 14 approval/hook tests | ✅ |
| 9 | Rejected work revised and re-submitted | Coordinator Phase 5b, `invalidate --cascade`, round counter | Run 1 and Run 2: round 1 rejected, round 2 approved | ✅ |
| 10 | State persisted; resume without repeating completed work | `workflow-state.json` (single writer `state.mjs`), `verify`, `/garage resume` | Run 2: interrupted, 3.5 h pause, resumed; Run 1: interrupted mid-node | ✅ |
| 11 | Gather, capture and confirm missing information | `requirements-formalizer`, `qa-log.md`, explicit confirmation via `AskUserQuestion`, playbook question lists | Run 2: 3 requirement rounds incl. master overrides | ✅ |
| 12 | Plan adapts to confirmed requirements and context | Selection by workflow type, size, playbook; profile and inventory via MCP | Run 1 vs Run 2 graphs; owned tools excluded (G3) | ✅ |
| 13 | External sources incl. web search; at least one MCP; not model knowledge alone | `WebSearch`/`WebFetch` in researchers; custom MCP `workshop-memory`; G1 requires sources | Source lists with URLs and dates in all research and product artifacts; MCP calls in transcripts | ✅ |
| 14 | Common capabilities as reusable skills | 6 skills (see C) | Skill content visible in agent transcripts | ✅ |
| 15 | Artifacts pass gates before dependents proceed | `depUsable` in `state.mjs`: dependents are not released until validated (and domain gates passed for the validator) | Tests + both runs | ✅ |
| 16 | Final result: addresses requirements, predictable structure across repeated runs, Markdown/HTML/PDF | Fixed section lists per workflow type, deterministic renderer (same plan → same bytes) | Renderer determinism by test; **no repeated live run with the same input** | ⚠️ |

## B. Definition of Done

| Item | Status | Detail |
|---|---|---|
| CLAUDE.md documents workflow and execution rules | ✅ | `CLAUDE.md` |
| ≥ 5 subagents and 1 coordinator | ✅ | 8 subagents + coordinator |
| ≥ 2 reusable skills, used by the workflow | ✅ | 6 |
| PreToolUse and PostToolUse hooks implemented and used | ⚠️ | 4 hooks registered; live evidence only for part of them, see D |
| ≥ 1 community or custom MCP integrated and used | ✅ | `workshop-memory` (Node, SQLite) |
| Components, skills, hooks, MCP config version-controlled | ✅ | `git ls-files` = 101+ files; `.mcp.json`, `.claude/**` committed |
| ≥ 3 runs with inputs, artifacts and state stored | ✅ | 3 runs of 3 different shapes: regular `project-plan`, small `project-plan`, `purchase-decision`; each with `request.md`, `qa-log.md`, artifacts, `workflow-state.json`, `approval.json`, HTML |
| README: setup, run, resume, prerequisites, env | ✅ | `README.md` |
| No secrets committed; required secrets documented | ✅ | Scans clean; none required (documented); `.gitignore` for `data/*.db`, `.env*` |
| Set up and run from a clean checkout | ⚠️ | A clean `git clone` → `scripts/setup.sh` → 79 tests: verified. Starting Claude Code in the clone and running `/garage`: not yet |

## C. Components

| Kind | Items |
|---|---|
| Coordinator | `/garage`, `/garage-approve`, `/garage-reject` (pinned to `sonnet`) |
| Subagents (8) | `requirements-formalizer`, `diy-researcher`, `product-researcher`, `project-planner`, `cost-planner`, `evidence-validator`, `synthesizer`, `final-output-builder` |
| Skills (7) | `artifact-validator`, `research-evidence`, `garage-html-theme`, `master-voice`, `master-onboarding`, `trade-tiling`, `trade-carpentry` |
| Hooks (4) | PreToolUse: `approval-gate-guard`, `no-leak-guard`, `memory-write-guard`; PostToolUse: `post-write-state` |
| MCP (1) | `workshop-memory`: profile, inventory, purchases, projects (SQLite) |
| Scripts | `state.mjs`, `check-artifact.mjs`, `approve.mjs`, `render-html.mjs`, `setup.sh` |

## D. Hooks: what is actually proven

Main-thread transcripts do not record hook executions, but a blocked call inside a subagent appears in the
subagent transcript as a `PreToolUse:<tool> hook error … Blocked: …` tool result. The deliberate probe
(`docs/hook-probe.md`, session `95d4e4b5`, 2026-10-11) used exactly that.

| Hook | Tests | Live evidence | Gap |
|---|---|---|---|
| `approval-gate-guard` (PreToolUse) | 11 | Blocked the assistant's own `approve.mjs` call in the main thread (session `a3eb908f`); allowed the master's `/garage-reject` and `/garage-approve`. **Probe, inside a subagent:** blocked a write of `output/garage-plan.html` before approval and a direct write of `workflow-state.json` | none |
| `post-write-state` (PostToolUse) | 1 | Coordinator's explicit `artifact-written` was a silent no-op after subagent writes. **Probe:** after the subagent's plain `Write` of `research.md`, `state.mjs summary` showed `diy-researcher created` with no coordinator call | none |
| `no-leak-guard` (PreToolUse) | 3 | **Probe, inside a subagent:** blocked a `final-plan.md` write that contained `research-bonding.md` and `cost-planner` | none |
| `memory-write-guard` (PreToolUse) | 1 | `upsert_project` with `run_id` passed after approval. **Probe, inside a subagent:** blocked MCP `record_purchase` with the `run_id` of an unapproved run; no row was written | none |

Verdict of the probe: 5 of 5 attempts matched the expectation. Not covered: a hook that is skipped when the
harness itself changes (no evidence either way); the heuristic Bash inspection remains best-effort by design
(see E and the design document), while the Write/Edit/MCP checks and the hash check are exact.

## E. Deviations from the wording of the task

1. The task says artifacts need no deterministic checks. The implementation adds `check-artifact.mjs`
   (structure, citations, size, shorthand). It goes beyond the requirement for reliability; JSON is used only
   for the machine state.
2. `final-output-builder` is a thin agent around a deterministic renderer: the HTML is not generated by the
   model, so repeated runs give identical output.
3. Approval provenance relies on the harness transcript marker `origin.kind = human`. It was found in logs,
   not in documentation; if it changes, approval fails closed.
4. The MCP server is the master's personal memory, not an external data source like Open-Meteo in the
   example; external information comes from web search.
5. The domain is custom (home-workshop assistant), which the task allows.

## Known findings of the current checker on the earlier runs

Run 1 cites PDF data sheets (4 artifacts) and Run 2's final plan predates the style rules; see
`workflows/README.md`. They were produced under earlier rules and are kept unchanged as historical records.
Run 3 passes all checks.

## F. Open items before submission

1. ~~Live hook probe in a subagent~~ **done 2026-10-11**, 5/5 (`docs/hook-probe.md`).
2. Start Claude Code in a fresh clone and run one short `/garage` (`setup.sh` and the tests already pass in a clone).
3. Measure the light re-validation on a run with a validator FAIL.
4. Final README read-through and secret scan.
5. Optional: a live run of a forced unresolved failure (`# BLOCKED`) to replace the test-only evidence of A7.
6. Optional: a repeat of one run with the same input to show structural identity (A16).

## G. Token economy, measured (`scripts/usage-report.mjs`)

| | Run 2 (before) | Run 3 (after composite commands, retry depth, one-line hand-backs) |
|---|---|---|
| Coordinator calls / input tokens | 161 / 22.5 M | 77 / 7.8 M |
| All agents calls / input tokens | 325 / 29.3 M | 169 / 10.5 M |
| Average coordinator context | 140k | 102k |
| Subagent runs, coordinator calls per run | ~30, ~5.4 | 18, ~4.3 |

Not a like-for-like comparison: Run 2 had a rejected plan, a 3.5 h pause inside one resumed session and a
longer requirements phase. The per-run call count (−20 %) is the cleanest figure for the composite
commands; retry research used 3–4 searches instead of 12.
