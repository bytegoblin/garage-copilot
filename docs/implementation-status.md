# Implementation status

Single source of truth for progress. Read this first when resuming work in a new session.
Update it in the same change as the work it describes. Status values:

- **done** — implemented and verified as described in the "Verified by" column
- **built, unverified** — implemented but not yet exercised end to end
- **todo** — not started

Plan and design: `docs/garage-copilot-design.md` (sections 18 and 19). Deadline: 2026-10-15.

## Current position

*Snapshot: 2026-10-11, end of the day. 5 days to the deadline.*

- **State:** the system is functionally complete. All three workflow types have a stored, approved demo run
  (≥ 3 runs required by the assignment: met); 82 tests pass (`node --test scripts/test/*.test.mjs`, plus the MCP
  smoke test in `mcp/workshop-memory`).
- **Uncommitted work (done and tested, waiting for the master's «коммитим»):** G0 rules for PDF sources and
  untagged foreign sources; lighter re-validation by `evidence-validator`; ban on pipeline phrases («по правилам
  поиска» and similar) in the master's text; `/garage-probe-hooks` command; `workflows/README.md`; traceability
  and README updates. Files: `.claude/agents/evidence-validator.md`, `.claude/commands/garage.md`,
  `.claude/commands/garage-probe-hooks.md` (new), `.claude/skills/master-voice/SKILL.md`, `README.md`,
  `config/workflow.json`, `docs/traceability.md`, `scripts/check-artifact.mjs`, three test files,
  `workflows/README.md` (new). Check with `git status`; commit with the usual attribution line only when asked.
- **Last commit:** `8962026` (demo run 3).
- **Open question for the master:** commit the uncommitted batch now or after the hook probe result?

### Next steps (in order)

1. **Hook probe (the master runs it):** in a fresh session `GARAGE_DB=data/demo.db claude`, then
   `/garage-probe-hooks`. It writes `docs/hook-probe.md` and deletes its throw-away run. Afterwards: copy the
   outcome into `docs/traceability.md` §D (replace «not proven» for PreToolUse inside subagents, `no-leak-guard`,
   `memory-write-guard`), mark step 12 **done**, or fix the hook if a block did not fire.
2. **Clean-checkout test (the master runs it):**
   `git clone <repo> /tmp/garage-clone && cd /tmp/garage-clone && nvm use && bash scripts/setup.sh`, then
   `GARAGE_DB=data/demo.db claude` and one short request, e.g.
   `/garage Каким клеем лучше склеивать щиты из бука?` (also exercises the `how-to` type live). Record the
   outcome; mark step 20 **done**.
3. **Measure the light re-validation** on the next real run with a validator FAIL
   (`node scripts/usage-report.mjs <session-id>`); note the result in `docs/traceability.md` §G.
4. **Final README pass** (English, check every command still matches the files) and **secret scan**
   (`git grep -nEi "api[_-]?key|secret|token|password|BEGIN .*PRIVATE"`, check `git ls-files data`; the
   databases must not be tracked). Mark steps 19 and 21 **done**.
5. Optional, if time allows: a live `# BLOCKED` run (A7 is unit-tested only) and a repeat of one run with the
   same input (A16, structural identity).
6. Final commit; push is the master's decision (the repository is public).

### What to know before touching anything

- The master wants: dialogue in Russian, repository files in English, tone «сдержанный напарник по цеху».
- **Commit only when the master asks.** Never write `workflow-state.json` / `approval.json` by hand; never run
  `approve.mjs` yourself without the master's typed `/garage-approve` or `/garage-reject`.
- Runs 1 and 2 intentionally fail the *current* G0 (PDF sources in run 1, final plan of run 2 written before the
  style rules). They were valid when produced; the exact list is in `workflows/README.md` and
  `docs/traceability.md` («Known findings of the current checker»). Do not rewrite them.
- Real workshop data lives in `data/garage.db` (git-ignored). Demo master is `data/demo.db`
  (`GARAGE_DB=data/demo.db`).
- Where things are: requirement-to-evidence map → `docs/traceability.md`; run table and rule versions →
  `workflows/README.md`; original design → `docs/garage-copilot-design.md` (§18–19 plan, implementation
  notes); coordinator → `.claude/commands/garage.md`; executable state rules → `scripts/state.mjs`.

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
| 12 | Hooks: `post-write-state`, `approval-gate-guard`, `no-leak-guard`, `memory-write-guard`; `.claude/settings.json` | 3 | built, partly verified | 12+ hook tests. Live: PostToolUse registers artifacts written by subagents; `approval-gate-guard` fired in the main session and allowed the master's own commands (runs 1–3); `memory-write-guard` let an approved write-back through. **Not proven live:** PreToolUse blocks inside subagents, `no-leak-guard` and `memory-write-guard` blocks (Claude Code transcripts do not record hook runs). Probe prepared: `/garage-probe-hooks` — **the master has not run it yet** |
| 13 | Resume flow (`/garage resume`) | 3 | done | Live: session interrupted mid-`cost-planner`; `resume` → `verify` detected the node, re-ran only it and the validator, nothing validated was repeated, no duplicate dispatch |
| 14 | `synthesizer`, fixed final structures (3 workflow types), G0 for the final plan | 4 | done | Live (session a3eb908f): `add-nodes` appended synthesizer + builder to the old run, synthesizer wrote a 15 020-char plan in ~4.8 min, G0 PASS, plan presented; 4 checker tests |
| 15 | `scripts/approve.mjs`, `/garage-approve`, `/garage-reject`, revision loop (Phase 5b), `request-approval`/`record-decision` | 4 | done | Live (a3eb908f): `/garage-reject` → feedback recorded, only the affected nodes re-ran (round 1); `/garage-approve` → approved (round 2); provenance check allowed both commands; 14 approval/hook tests |
| 16 | `garage-html-theme` skill, `final-output-builder`, deterministic `render-html.mjs` | 4 | done | Live: builder ran after approval, `check-artifact` PASS on the HTML (10 sections, 2 tables, 22 links, no scripts, no internal names) |
| 17 | Memory write-back after approval (Phase 7, `writeback`) | 4 | done | Live: `upsert_project` with `run_id` passed `memory-write-guard`; run `completed`. Defect found: it created a second project instead of updating the seeded one (fixed in Phase 7, smoke-tested) |
| 18 | Demo runs 1–3 committed under `workflows/` | 5 | done | Runs `20261010-1232-garage-tiles` (regular), `20261010-1806-hanging-cabinet-beech` (small), `20261010-2340-bosch-gas15ps-dust-extraction` (purchase-decision): all `completed`, approved, HTML rendered, committed; table in `workflows/README.md` |
| 19 | Final `CLAUDE.md`, `README.md` complete | 5 | built, unverified | Both exist and are kept in sync with each change (13 execution rules, setup/run/approve/resume/tests/usage/probe sections); final read-through against the files still to do (next step 4) |
| 20 | Clean-checkout test | 5 | built, partly verified | In a clone: `setup.sh` ran from scratch and the test suite passed (79/82 at that time, the 3 failures were checks of the not-yet-committed files). **Not done:** starting Claude Code in the clone and one live `/garage` (next step 2) |
| 21 | Secret scan, traceability table updated | 5 | built, partly verified | `docs/traceability.md` exists (A requirements, B DoD, C components, D hook evidence, E deviations, F open, G tokens) and is updated with each batch; **secret scan not run in the final state** (next step 4) |

## Decisions made during implementation

- Node 22.23.1 on the master's machine; `node:sqlite` used without a native dependency (requires >= 22.13).
- `data/*.db` is git-ignored because the repository is public; `data/demo.db` holds a fictional master.
- `task_description.md` stays in the repo root; brainstorm files are in `docs/background/`.
- Git repository initialised; the master's commits so far end at `8962026`. Commit only when the master asks;
  attribution line `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- `state.mjs` is a CLI only (no exports); tests drive it through the CLI with `GARAGE_WORKFLOWS_DIR`.
- Structural gate G0 requires the exact `##` heading list of each template; headings are the contract.
- The live requirements artifact of run `20261010-1232-garage-tiles` lacked the closing `## Источники` section;
  it was appended by hand (`Не применимо.`) and requirements were re-confirmed with `state.mjs`. The formalizer
  prompt now states the section is mandatory and the coordinator runs G0 on `requirements.md`.
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
- Design deviations (Day 4): the HTML guide is rendered by a deterministic script (`render-html.mjs`), the
  `final-output-builder` agent only runs it and checks the result; `approval-gate-guard` blocks the model from
  running `approve.mjs` and `render-html.mjs` before approval. Risk: if the harness routes the `!` substitution
  of `/garage-approve` through PreToolUse, the guard would block the master's own command — verify first.
  The final plan is checked by G0 for fixed sections per workflow type and for internal names.
- **Finding (live, a3eb908f):** in the VS Code environment the `!` shell substitution of a slash command is
  *not* executed by the harness: the transcript entry carries `promptShellHandOff` and the expanded prompt says
  «run this first: …», so the assistant ran the script itself and `approval-gate-guard` blocked it. Also `$1`
  was the first word of the feedback because the run id was optional. Fix: no `!` substitution; the command
  tells the assistant to run `scripts/approve.mjs` with Bash; the hook allows exactly that call only when the
  last human-typed message (`origin.kind = human` in the transcript, which the assistant cannot write) is the
  matching `/garage-approve` or `/garage-reject`; `approve.mjs` ignores a first argument that is not a run id.
  Consequence: approval is verified by transcript provenance + plan hash, not by "harness runs the script".
- Agents were dispatched in the background even though the coordinator passed `"false"`; completion arrives
  by notification and the `running` guard prevents duplicates. Prompt now asks for a boolean.
- Revision rule added: a new fact about owned items is written to the inventory (no `run_id`) before the
  affected nodes are invalidated.
- Round 5 findings (live, revision after the master's adhesive choice, 28 machine-minutes): (1) a size
  overshoot of 3–4 % cost whole retry rounds and burned the last retry of a node → target + 15 % tolerance
  (`artifact_hard_factor`), overshoot passes with a note; (2) `retries` carried over between rounds → a master
  revision (`invalidate`) now resets the budget of the nodes it touches; (3) the validator wrote "G1 Источники"
  in the gate column and failed G0 → ids with names accepted; (4) changing the adhesive changed consumption,
  so the validator failed the plan's quantities (G4) and re-ran planner → products ×2 → cost → validator
  (~9 min): quantity depends on the chosen product's consumption rate; (5) the project was inserted instead of
  updating the seeded idea project (fixed).
- Universality review (before demo run 2, hanging shelf): agents/scripts have no tile-specific logic. Added:
  playbook chosen in Phase 2 and given to the requirements agent; playbooks gained «Questions for the master»;
  coordinator has a **small** `project-plan` path (one research node `standard`, one product node `standard`)
  next to the **regular** one; examples in planner/product prompts made neutral; `contracts.test.mjs` keeps
  playbooks, coordinator and agents consistent. The carpentry playbook has not run live yet (demo run 2).
- Model assignment (token economy): all agents have an explicit `model`; coordinator commands pinned to
  `sonnet`; `cost-planner` was tried on `haiku` and **reverted to `sonnet`** after demo run 2 (the haiku budget
  had an inconsistent exact/approximate split that cost a validator re-run; the saving was ~1 % of tokens);
  `node_models.product-researcher-ppe = haiku`. Measured token drivers: product-researcher ≈70 % of subagent
  input (143 turns over 3 sessions). Bigger levers than the model: fewer turns, fewer retry rounds, small path.
- **Demo run 2** (hanging beech cabinet with a drawer, run `20261010-1806-hanging-cabinet-beech`, sessions
  17bc1db8 + 32c92fbe): small path chosen (7 nodes), 3 requirement rounds, master overrides handled (safety
  section dropped at his request, depth 26 cm, plywood as solid, anchors owned → inventory), 5 domain-gate
  rounds, 1 reject + 1 approve, HTML, project row created, no hook false-positives, ~97 min wall clock
  including a 3.5 h pause. Findings: (1) **the coordinator is 77 % of all input tokens** (161 calls, average
  context 140k, growing 47k → 222k; a resumed session carries the whole earlier conversation) — earlier
  per-agent numbers excluded it; (2) every product-research re-run repeated a full 11–12 search budget (5 full
  runs) even for a one-number plan fix; (3) the Russian text of the final plan is telegraphic (shorthand «ор.»,
  `W = 564 − 2g`, fragments) — caused by size caps + "one line per fact" rules + «short sentences» in the tone
  spec; fixed with the `master-voice` skill, a shorthand lint in G0 and a larger final-plan cap (18 000);
  (4) anchor load capacity was not found in open HTML sources (as predicted) and the plan says so.
  Implemented in response: `start-ready` + `finish-node` composite commands (one call replaces
  artifact-written + check + stage-gate + domain-gates + ready), `research_depth.retry` (4 searches / 5 fetches,
  «start from your previous artifact»), exactly-one-line hand-backs, advice to open a new session after a pause.
  **Not measured yet** — compare coordinator calls and tokens in demo run 3 with `node scripts/usage-report.mjs <session-id>` (baseline, run 2: coordinator 161 calls / 22.5 M input, all agents 325 calls / 29.3 M).
- **Demo run 3** findings: the validator caught what G0 cannot — PDF documents listed as sources although they
  were never opened, and three foreign sources without the `[иностранный источник]` tag (G1, two rounds); the
  validator ran 4 times with 5 page checks each (~7.5 of ~29 machine minutes); the master's mid-run remark
  («штуцеры я напечатаю») was applied through the coordinator and inventory; new style reads as connected
  prose; one pipeline phrase leaked into the master's text («по правилам поиска»).
- Product research default is now three parallel nodes (materials, tools, ppe) to avoid retry rounds for
  unpriced items (round 4 finding); `_superseded-*` artifacts are git-ignored; first commit made.
- Expected full-cycle duration is ~35 min per run; reduction deferred until after the MVP is complete.
- Resume (`/garage resume`) works through `state.mjs verify` + the normal execution loop; the `post-write-state`
  hook registers artifacts, `finish-node` is the one call after each subagent. Open a new session after a pause
  (a resumed session carries the whole earlier conversation, which is what made run 2 expensive).

- **Batch of 2026-10-11 (after demo run 3, uncommitted):**
  (1) G0 now fails a PDF among sources and a foreign source without the `[иностранный источник]` tag
  (`config/workflow.json` → `source_policy`: local TLDs `pl`; EU TLDs allowed as supplementary; ambiguous
  locale codes ignored). This used to cost two validator rounds per run.
  (2) `validator_depth`: attempt 1 is a full check with 5 page spot-checks; from attempt 2 the validator reads
  its previous report, re-checks only failed or affected gates (the coordinator passes the list of re-run
  nodes), carries other gates forward as PASS «без изменений с прошлой проверки», 2 spot-checks. Risk accepted:
  a consequence in an «unchanged» gate can be missed; all seven rows stay in the table.
  (3) The phrase lint in G0 covers «по правилам поиска/исследования/проекта/системы/работы» and is mirrored in
  `master-voice`. A JS `\b` does not work with Cyrillic: the regex has no word boundary.
  (4) `/garage-probe-hooks` (dev-only, `disable-model-invocation`): throw-away run `hook-probe`; a
  general-purpose subagent tries (a) a leak into `final-plan.md`, (b) writing the HTML, (c) writing
  `workflow-state.json`, (d) a clean artifact write (expects `created` via PostToolUse), (e) an MCP
  `record_purchase` with a `run_id` before approval; result goes to `docs/hook-probe.md`.
  (5) `workflows/README.md` records which known checker findings apply to runs 1–2.

## Known gaps and risks

- PreToolUse hooks inside subagents, `no-leak-guard` and `memory-write-guard` blocks are tested by unit tests
  only; the live probe is prepared and not yet run (next step 1).
- Approval provenance relies on the transcript marker `origin.kind = "human"`, which is undocumented; if the
  harness changes it, approval fails closed (the master sees a block, no unapproved output is produced).
- `# BLOCKED` (retries exhausted) was never reached live; unit-tested only.
- No repeated same-input run (structural identity is argued from the fixed templates and G0, not shown).
- The light re-validation has not been measured live; a real run with a validator FAIL is needed.
- Quantity calculation stays in `project-planner` (the master chose «оставляем как есть»); a changed product
  can change quantities and cost one extra planner → products → cost → validator round.
- Wall-clock of a regular run is ~35 min; reduction deferred until after submission.
- Old runs 1–2 fail the current G0 on documented, known grounds (see `workflows/README.md`).
- `ExperimentalWarning` from `node:sqlite` is expected and harmless (mentioned in the README).
