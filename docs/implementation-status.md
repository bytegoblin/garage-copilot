# Implementation status

Single source of truth for progress. Read this first when resuming work in a new session.
Update it in the same change as the work it describes. Status values:

- **done** — implemented and verified as described in the "Verified by" column
- **built, unverified** — implemented but not yet exercised end to end
- **todo** — not started

Plan and design: `docs/garage-copilot-design.md` (sections 18 and 19). Deadline: 2026-10-15.

## Current position

*Snapshot: 2026-10-11, after the clean-clone run. 4 days to the deadline.*

- **State:** the system is functionally complete and the assignment checklist is closed (DoD in `docs/traceability.md` §B). All three workflow types have a stored, approved demo run
  (≥ 3 runs required by the assignment: met); 98 tests pass (`node --test scripts/test/*.test.mjs`, plus the MCP
  smoke test in `mcp/workshop-memory`).
- **Last commit:** `b536601` (onboarding skill with the assistant introduction).
- **Uncommitted:** the fixes of step 22, the README pass and the documentation. Commit only when the master asks.
- **Open question for the master:** none

### Next steps (in order)

1. ~~Hook probe~~ **done 2026-10-11, 5/5**. ~~Clean-clone run~~ **done 2026-10-11**, with quality findings.
2. ~~Fix the findings of the clean-clone run~~ **done** (step 22, tests only). **Show it live:** in the clone
   (`git pull` from this repository), run a task with many small items (the LED profile again is a good one,
   with the same answers); check `depth=` in the `started` lines, the `price coverage: X of Y` note after the
   budget, a re-run that keeps prices, and the share of priced positions in the final plan. Not started: the
   master asked to hold the live run.
3. **Measure the light re-validation** on the next real run with a validator FAIL
   (`node scripts/usage-report.mjs <session-id>`); note the result in `docs/traceability.md` §G.
4. ~~Final README pass and secret scan~~ **done 2026-10-11** (steps 19 and 21).
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
| 12 | Hooks: `post-write-state`, `approval-gate-guard`, `no-leak-guard`, `memory-write-guard`; `.claude/settings.json` | 3 | done | 12+ hook tests. Live: PostToolUse registers artifacts written by subagents; `approval-gate-guard` allowed the master's own commands (runs 1–3). **Probe 2026-10-11 (session `95d4e4b5`, `docs/hook-probe.md`):** inside a subagent `no-leak-guard`, `approval-gate-guard` (HTML and state file) and `memory-write-guard` each blocked, the clean write was registered by PostToolUse; verified in the subagent transcript, no row written to the DB |
| 13 | Resume flow (`/garage resume`) | 3 | done | Live: session interrupted mid-`cost-planner`; `resume` → `verify` detected the node, re-ran only it and the validator, nothing validated was repeated, no duplicate dispatch |
| 14 | `synthesizer`, fixed final structures (3 workflow types), G0 for the final plan | 4 | done | Live (session a3eb908f): `add-nodes` appended synthesizer + builder to the old run, synthesizer wrote a 15 020-char plan in ~4.8 min, G0 PASS, plan presented; 4 checker tests |
| 15 | `scripts/approve.mjs`, `/garage-approve`, `/garage-reject`, revision loop (Phase 5b), `request-approval`/`record-decision` | 4 | done | Live (a3eb908f): `/garage-reject` → feedback recorded, only the affected nodes re-ran (round 1); `/garage-approve` → approved (round 2); provenance check allowed both commands; 14 approval/hook tests |
| 16 | `garage-html-theme` skill, `final-output-builder`, deterministic `render-html.mjs` | 4 | done | Live: builder ran after approval, `check-artifact` PASS on the HTML (10 sections, 2 tables, 22 links, no scripts, no internal names) |
| 17 | Memory write-back after approval (Phase 7, `writeback`) | 4 | done | Live: `upsert_project` with `run_id` passed `memory-write-guard`; run `completed`. Defect found: it created a second project instead of updating the seeded one (fixed in Phase 7, smoke-tested) |
| 18 | Demo runs 1–3 committed under `workflows/` | 5 | done | Runs `20261010-1232-garage-tiles` (regular), `20261010-1806-hanging-cabinet-beech` (small), `20261010-2340-bosch-gas15ps-dust-extraction` (purchase-decision): all `completed`, approved, HTML rendered, committed; table in `workflows/README.md` |
| 19 | Final `CLAUDE.md`, `README.md` complete | 5 | done | 2026-10-11: README read through against the files (components, workflow types, reliability rules, run, approve, resume, tests, probe, usage, layout, privacy); CLAUDE.md has 15 execution rules; both reflect the fixes of the clean-clone run |
| 20 | Clean-checkout test | 5 | done | Live run in a fresh clone on an empty database, 2026-10-11 (sessions `709c6def` + resume `780cf7c8`, run `20261011-1019-led-profile-adhesive`): setup, onboarding with the introduction, requirements, dynamic plan, hooks, approval, HTML and memory write-back all worked. The result quality was poor; the causes were fixed in step 22 |
| 21 | Secret scan, traceability table updated | 5 | done | 2026-10-11: `git grep` and `git log -p` for keys, tokens, private keys, e-mails, home paths: only false positives (`cisk-` in an Allegro URL); `git ls-files data` = `.gitkeep`; no `.db`/`.env` ever committed; traceability A–H updated |
| 22 | Fixes after the clean-clone run: depth chosen by the script, baseline `_prev` and price-regression check, price-coverage gate (`COVERAGE:`), `waive-coverage`, node sizing, formalizer `must` for a priced list, cost-planner rows and averaging, validator never carries G2/G6 forward, object-class rule | 5 | done (not yet shown in a live run) | `coverage.test.mjs` (12 tests) + contract tests; 97 tests pass. **A live run with the new rules has not been made** (the master asked not to start one yet) |
| 23 | PDF support: `mcp/pdf-reader` (`read_pdf`), `.mcp.json`, `setup.sh`, agent tools, `research-evidence` rules, G0 page-reference rule, validator spot-check via `read_pdf` | 5 | done (not yet shown in a live run) | `mcp/pdf-reader` smoke test (generated PDF over stdio, SSRF checks), a real Ceresit data sheet read by query (4 pages, the application-temperature line found with its page), G0 test, contract test; `setup.sh` from a scratch copy; 98 tests pass |

## Decisions made during implementation

- Node 22.23.1 on the master's machine; `node:sqlite` used without a native dependency (requires >= 22.13).
- `data/*.db` is git-ignored because the repository is public; `data/demo.db` holds a fictional master.
- The assignment text `task_description.md` is a local reference only: untracked and git-ignored (removed from the
  repository on 2026-10-11); brainstorm files are in `docs/background/`.
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
- PDF documents were first excluded (token cost for the MVP) and **re-enabled on 2026-10-11** at the master's
  request. `WebFetch` only saves a PDF as a binary, and `Read` of pages needs poppler (`pdftoppm`), so a small
  MCP server `mcp/pdf-reader` (`unpdf`, pure Node, no external tools) provides `read_pdf`: search words → snippets
  with page numbers (cheap), or pages, with a character cap. Rules: a call counts as a fetch, at most two
  documents per node (`source_policy.pdf`), a PDF source line needs «стр. N» (G0), text is untrusted data, the
  server refuses local and private addresses.
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

## Findings of the clean-clone run (2026-10-11) — fixed in step 22

The run (kitchen LED profile; the master changed the task four times: glue → whole lighting → screws, no
safety → corrected profile type) ended `completed` with a shopping list priced for **2 of ~24 positions**
(sensor, multimeter; no tape, power supply, profile, screws, wire). An earlier intermediate result had more
prices (tape, router bit) and was lost. Causes found in the logs:

1. **Re-run from scratch, previous artifact ignored.** After a cascade the product node was re-dispatched with
   «no content findings, previous attempts did not finish» (the resumed coordinator had no context); the agent
   did not read its existing `products-materials.md` and rebuilt it with 4 searches.
2. **Depth by attempt number.** `retry` depth (4 searches / 5 fetches) is chosen when `attempt` ≥ 2
   (`garage.md` Phase 4), also for the first real result of an interrupted node. Four searches cannot price ~12
   positions; the tape was never searched.
3. **Node scope too wide.** One «materials» node held profile, strip, power supply, sensor, screws, wire,
   connectors, grommets, sealant: 6 searches for ≥ 12 positions.
4. **No price-coverage rule.** Requirements had no `must` for a priced list (only R20 `should`), G2 checks
   arithmetic only, and the validator called the gap «a search-budget limit, not a calculation error».
5. **My light re-validation carried G6 and G2 forward** («без изменений с прошлой проверки») although the
   products artifact had changed; step 2 of the dispatch rules did not list G6/G2 for product changes.
6. **Budget arithmetic.** The «average» of two different multimeter models (157.84 and 155.00) was summed as one
   position and made up 60 % of the total; optional tools should not enter the total, averages only across shops
   for the same item.
7. **Domain fit.** For «врезной профиль в паз ДСП» research took plasterboard-type profiles with side lugs
   (groove 23 × 10 mm); the master had to correct it. The final plan still has no confirmed furniture profile.
8. Retailer pages: several Polish shops answer 403 or show prices «после входа»; expected, not fixable.

Fixes (step 22), by finding number: (1) every researcher reads its existing artifact first, `state.mjs start`
saves a baseline in `artifacts/_prev/` (git-ignored) and G0 rejects a products artifact with fewer priced rows
unless the removal is explained on a line `Снято с плана:`; (2) depth is decided by `state.mjs` (node `depth`
in `plan.json`; `retry` only for a re-run that fixes quoted findings; a `COVERAGE:` finding, an upstream change,
an interruption or the master's revision get the node's own level) and printed as `depth=<level:s/f>` in the
`started` line; (3) node sizing rule in Phase 3 (`product_nodes.max_positions_per_node` = 6); (4) the shopping
list has a row per position, `domain-gates` computes the priced share and fails G2 above
`price_coverage.max_unpriced_share` (0.3), handing positions to the node whose artifact mentions them; the
validator never carries G2/G6 forward after a re-run; the formalizer adds a `must` for a priced list;
`waive-coverage` / `unblock` for the master's decision after exhausted retries; (6) averaging and optional-item
rules in `cost-planner`; (7) object-class rule in `diy-researcher` and a G4 clause in the validator.
Not fixed on purpose: retailer pages that answer 403 or hide prices behind a login (finding 8).

## Known gaps and risks

- Approval provenance relies on the transcript marker `origin.kind = "human"`, which is undocumented; if the
  harness changes it, approval fails closed (the master sees a block, no unapproved output is produced).
- `# BLOCKED` (retries exhausted) was never reached live; unit-tested only.
- No repeated same-input run (structural identity is argued from the fixed templates and G0, not shown).
- The light re-validation has not been measured live; a real run with a validator FAIL is needed.
- Quantity calculation stays in `project-planner` (the master chose «оставляем как есть»); a changed product
  can change quantities and cost one extra planner → products → cost → validator round.
- Source locality in the G0 check comes from `config/workflow.json` → `source_policy.local_tlds` (`pl`), not
  from the profile country; a master outside Poland must change that list. The research agents read the
  country from the profile.
- Wall-clock of a regular run is ~35 min; reduction deferred until after submission.
- Old runs 1–2 fail the current G0 on documented, known grounds (see `workflows/README.md`).
- `ExperimentalWarning` from `node:sqlite` is expected and harmless (mentioned in the README).
