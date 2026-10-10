# Garage Copilot — System Design and Implementation Plan

Status: **Implemented; this is the original design.** The current state, evidence and open items are in
[`traceability.md`](traceability.md) and [`implementation-status.md`](implementation-status.md). Where this
document and the code differ, the code and those two files are right; the differences are listed below.
Deadline: 2026-10-15.

### Implementation notes (supersede the text below)

- **Approval (§10):** the `!` shell substitution of the slash commands is not executed by the harness in this
  environment. The commands tell the assistant to run `scripts/approve.mjs` with Bash, and
  `approval-gate-guard` allows exactly that call only when the last human-typed message in the transcript
  (`origin.kind = human`) is the matching `/garage-approve` or `/garage-reject`. The approval is still bound
  to the SHA-256 of the plan that was shown (`request-approval`), and `render-html.mjs` re-verifies it.
- **HTML output (§5, §12):** rendered by the deterministic script `scripts/render-html.mjs` with the template
  of the `garage-html-theme` skill; `final-output-builder` only runs and checks it.
- **Skills:** six, not three (`master-voice`, `trade-tiling`, `trade-carpentry` added).
- **Product research:** three parallel nodes (materials, tools, protective equipment) in the regular graph; a
  single node in the **small** graph; coordinator picks by project size.
- **State tooling:** composite commands `start-ready` and `finish-node`, `add-nodes`, `reset-plan`, `verify`.
- **Limits:** artifact size targets with a 15 % tolerance (`artifact_hard_factor`); `retry` research depth.
- **Models:** every agent and command declares a model; `node_models` overrides individual nodes.
- **Hooks:** `approval-gate-guard` also blocks the assistant from running `approve.mjs` and
  `render-html.mjs` outside the allowed conditions.
- **Style:** the final plan follows the `master-voice` skill and passes a shorthand lint in G0.
Source of truth for requirements: [`task_description.md`](../task_description.md).

---

## 1. Product summary

Garage Copilot is a personal workshop assistant that runs inside Claude Code. A home craftsman ("master") describes a task in natural language, and the system:

1. knows the master's workshop (profile, tools, materials, past projects) from a persistent local database;
2. gathers and confirms whatever is still missing for the task;
3. researches techniques, safety, products and current local prices on the web;
4. produces a validated, sourced plan with a shopping list and budget;
5. asks for explicit approval and only then renders the final HTML guide;
6. records the approved outcome (planned project, items to buy) back into the workshop memory.

Primary use cases (MVP):

| Workflow type | Example request | Final output |
|---|---|---|
| `project-plan` | "Помоги спланировать укладку плитки в гараже" / "Хочу сделать подвесную полку в коридор" / "Шкаф в комнату" | Phased plan, materials, shopping list, budget, safety, DIY vs ready-made comparison |
| `purchase-decision` | "Стоит ли мне покупать этот фрезер?" | Verdict, fit to owned tools, alternatives, prices in local shops, risks |
| `how-to` | "Чем лучше клеить плитку на старую стяжку?" | Short sourced answer with recommended method, materials and safety notes |

Out of MVP scope (architecture must allow adding later): workshop layout planning (`layout-planner`), cut lists / panel optimisation (local panel shops provide this), YouTube evidence, PDF export (HTML is print-friendly), humour tuning.

---

## 2. Language and tone rules

- **Everything stored in the repository is in English:** CLAUDE.md, README, commands, agents, skills, hooks, scripts, schema, config, comments, identifiers, file and directory names.
- **Everything the master reads at runtime is in Russian:** coordinator dialogue, workflow artifacts content, final plan, HTML guide. Artifact section headings are fixed Russian strings defined in the English templates of the `artifact-validator` skill.
- Product names, model numbers, brands, standards, shop names and URLs are never translated.
- Web research may use Polish, English and Russian sources (Polish first for prices).
- Tone (default `restrained`): a calm, experienced workshop mate. Informal "ты", addresses the master by name, short sentences, concrete facts, no bureaucratic language, honest about uncertainty. Reference example:
  > «Смотри, у твоего фрезера цанга на 8 мм, а переходника на 6 мм в комплекте нет. Учти это при покупке фрезы.»
- Tone is a profile field (`tone`) so humour can be tuned later without code changes.
- Internal names (artifact filenames, agent names, state files, run paths) never appear in user-facing text (enforced by `no-leak-guard`).

---

## 3. Architecture overview

Model-driven hub-and-spoke. The coordinator is the `/garage` slash command running in the main Claude Code thread (subagents cannot spawn subagents, so the hub must be the main thread).

```
                         Master (Russian dialogue)
                                   │  /garage, /garage-approve, /garage-reject
                                   ▼
┌──────────────────────────── Coordinator (/garage) ────────────────────────────┐
│ onboarding · intake · requirements Q&A · workflow type · execution DAG         │
│ dispatch (parallel / sequential) · stage gates · domain gates · targeted retry │
│ approval handling · memory write-back · resume                                 │
│ produces NO domain content                                                     │
└───────┬───────────────┬───────────────┬────────────────┬──────────────────────┘
        │ Agent tool    │ Bash           │ MCP             │ Skills
        ▼               ▼                ▼                 ▼
  8 subagents     scripts/state.mjs   workshop-memory   artifact-validator
  (own 1 artifact (single writer of   (SQLite: profile, research-evidence
   type each)      workflow state)     inventory, ...)   garage-html-theme
        │
        ▼
  workflows/<run-id>/artifacts/*.md  ──►  hooks (Pre/PostToolUse) guard & record
```

Component inventory:

| Kind | Count | Items |
|---|---|---|
| Coordinator | 1 | `/garage` command |
| Subagents | 8 | `requirements-formalizer`, `diy-researcher`, `product-researcher`, `project-planner`, `cost-planner`, `evidence-validator`, `synthesizer`, `final-output-builder` |
| Skills | 3 | `artifact-validator`, `research-evidence`, `garage-html-theme` |
| Hooks | 4 | PreToolUse: `approval-gate-guard`, `no-leak-guard`, `memory-write-guard`; PostToolUse: `post-write-state` |
| MCP servers | 1 (custom) | `workshop-memory` (Node.js, stdio, SQLite via built-in `node:sqlite`) |
| Built-in external sources | 2 | `WebSearch`, `WebFetch` |
| Commands | 3 | `/garage`, `/garage-approve`, `/garage-reject` |
| Deterministic scripts | 4 | `setup.sh`, `state.mjs`, `approve.mjs`, `check-artifact.mjs` |

---

## 4. Coordinator (`/garage`)

### 4.1 Invocation

```
/garage <request in Russian>      start a new run
/garage resume [run-id]           resume an interrupted run (lists unfinished runs if no id)
/garage                           no args: greet, onboard if needed, ask what we are doing
```

### 4.2 Responsibilities

1. **Onboarding** (before any run): call `get_profile`. If empty, run a short onboarding dialogue (name, city/country, currency, units, voltage, garage size and conditions, power lines, dust extraction, skill level, preferences, main tools). Show a summary, ask for confirmation, then write via `update_profile` / `add_inventory_item`.
2. **Intake:** create the run (`state.mjs init`), save the original request to `request.md`.
3. **Requirements loop:** dispatch `requirements-formalizer` → read its "Open questions" → ask the master at most 3 questions at a time (with proposed defaults) → append Q&A to `qa-log.md` → re-dispatch → repeat until no blocking questions remain → present the requirements summary → get explicit confirmation (`AskUserQuestion` with "Подтверждаю / Исправить") → `state.mjs confirm-requirements`.
4. **Planning:** determine workflow type, build the execution DAG from the selection rules (§7) and the current context (profile, inventory, confirmed requirements), store it via `state.mjs set-plan`, and show the master a one-paragraph human description of what will happen.
5. **Execution:** loop `state.mjs ready` → dispatch all ready nodes in parallel (several Agent calls in one message) → after each node, run the stage gate (§9.1) → mark `validated` or retry.
6. **Domain gates:** dispatch `evidence-validator` → map failures to owner nodes → targeted retry with downstream invalidation (§9.3).
7. **Synthesis:** dispatch `synthesizer` → stage gate on `final-plan.md` → set `awaiting_approval` → present the plan to the master with instructions to run `/garage-approve <run-id>` or `/garage-reject <run-id> <причина>`.
8. **Revision loop:** on rejection, map feedback to affected nodes, invalidate them and their dependents, re-run, re-validate, re-synthesise, request approval again.
9. **Final output:** only after verified approval, dispatch `final-output-builder`.
10. **Memory write-back:** apply the "proposed memory updates" section of the approved plan through MCP (guarded by `memory-write-guard`).
11. **Reporting:** unresolved failures are explained in plain Russian: what failed, why, what was stopped, what the master can do.

### 4.3 Must not

- write domain content (research, plans, prices, verdicts) itself;
- edit artifacts owned by subagents;
- write `workflow-state.json` or `approval.json` directly (only via `scripts/state.mjs`; approval only via the master's command);
- infer approval from conversation text;
- dispatch a node whose dependencies are not `validated`.

### 4.4 Allowed tools (frontmatter)

`Agent`, `Read`, `Write` (only `request.md`, `qa-log.md`), `Bash(node scripts/state.mjs:*)`, `Bash(node scripts/check-artifact.mjs:*)`, `AskUserQuestion`, `Skill`, `mcp__workshop-memory__*`.

---

## 5. Subagents

All subagents: write only their owned artifact(s) under `workflows/<run-id>/artifacts/`, follow the common artifact structure (§6), write content in Russian, never talk to the master, return a short status message to the coordinator (`DONE <artifact>` or `BLOCKED <reason>`). Default model: `sonnet`; `evidence-validator` and `synthesizer` may use `opus`.

| Agent | Responsibility | Inputs | Owns | Tools | Must not |
|---|---|---|---|---|---|
| `requirements-formalizer` | Turn request + Q&A + profile into structured requirements with IDs (`R1…`), constraints, budget, assumptions, open questions | `request.md`, `qa-log.md`, profile & inventory (MCP) | `requirements.md` | Read, Write, MCP read tools | ask the master directly; research; recommend products |
| `diy-researcher` | Techniques, process, materials types, standards, safety (electrical, dust, PPE, loads/anchoring), common mistakes | `requirements.md`, profile | `research.md` (or `research-<topic>.md` when split) | WebSearch, WebFetch, Read, Write, MCP read, skill `research-evidence` | pick concrete products or prices |
| `product-researcher` | Concrete products/materials with specs, 2–3 local shop prices with dates, compatibility with owned tools, alternatives, ready-made benchmark (for `project-plan`) | `requirements.md`; `research.md` and `project-plan.md` when they are upstream nodes in the plan; inventory (MCP) | `products.md` (or `products-<category>.md` when split) | WebSearch, WebFetch, Read, Write, MCP read (`check_owned`, `list_inventory`), skill `research-evidence` | recommend items already owned; invent prices |
| `project-planner` | Phases, steps, durations, required tools and materials with quantities (bill of materials), owned vs missing | `requirements.md`, `research.md`, inventory (MCP) | `project-plan.md` | Read, Write, MCP read | price items; choose brands |
| `cost-planner` | Shopping list (qty, shops, prices, average, date), totals, contingency, budget fit, DIY vs ready-made comparison | `products*.md`, `project-plan.md`, `requirements.md` | `budget.md` | Read, Write | introduce new products or prices not present in `products*.md` |
| `evidence-validator` | Apply domain gates G1–G7 to all validated artifacts; report pass/fail per gate with owner mapping and fix hints | all artifacts, `requirements.md`, inventory (MCP `check_owned`) | `validation.md` | Read, Write, MCP read, WebFetch (spot-check links), skill `artifact-validator` | fix artifacts itself |
| `synthesizer` | Merge all validated outputs into one coherent plan in the fixed final structure; list proposed memory updates | all validated artifacts, `validation.md`, rejection feedback (if any) | `final-plan.md` | Read, Write, skill `artifact-validator` | add facts, products or prices not present in inputs |
| `final-output-builder` | Render the approved `final-plan.md` as a standalone HTML guide | `final-plan.md`, skill `garage-html-theme` | `output/garage-plan.html` | Read, Write, skill `garage-html-theme` | change plan content; run before approval |

Invariant: every workflow type dispatches at least 5 distinct subagents (smallest graph, `how-to`: formalizer, diy-researcher, evidence-validator, synthesizer, final-output-builder).

### 5.1 Dispatch contract (coordinator → subagent)

Every Agent call prompt contains, in this order:
1. `run_id`, `node_id`, workflow type;
2. the path of the artifact to write and its template type;
3. paths of input artifacts — only nodes with status `validated` (never pasted content; the agent reads the files);
4. on retry/revision: the exact findings or rejection feedback to address, and the attempt number;
5. reminder: Russian content, fixed structure, write only the owned artifact, return `DONE <path>` or `BLOCKED <reason>`.

Agents read the profile and inventory themselves through MCP; the coordinator does not copy them into prompts.

Extensibility: a new specialised agent (e.g. `layout-planner` owning `layout.md`) is added by (1) creating the agent file, (2) adding its artifact template to `artifact-validator`, (3) adding a selection rule (§7). The coordinator logic does not change.

---

## 6. Artifacts

### 6.1 Layout of a run

```
workflows/<run-id>/
├── request.md               # coordinator: original request verbatim
├── qa-log.md                # coordinator: clarifying Q&A, append-only
├── workflow-state.json      # scripts/state.mjs only
├── approval.json            # scripts/approve.mjs only (via /garage-approve, /garage-reject)
├── artifacts/
│   ├── requirements.md
│   ├── research.md          # or research-<topic>.md
│   ├── products.md          # or products-<category>.md
│   ├── project-plan.md
│   ├── budget.md
│   ├── validation.md
│   └── final-plan.md
└── output/
    └── garage-plan.html
```

`run-id` format: `YYYYMMDD-HHMM-<slug>`, e.g. `20261012-1430-garage-tiles`.

### 6.2 Common artifact structure

Every artifact in `artifacts/` follows the same skeleton (headings are fixed strings; checked by `check-artifact.mjs`):

```markdown
# <Artifact title in Russian>

<!-- meta
artifact: products
owner: product-researcher
run: 20261012-1430-garage-tiles
version: 2
inputs: requirements.md@<sha8>, research.md@<sha8>
-->

## Кратко
<3–6 sentence summary>

## <Artifact-specific sections, fixed per artifact type>

## Покрытие требований
| Требование | Где отражено | Статус |

## Допущения и неопределённости
- ...

## Источники
1. <title> — <URL> (дата обращения: YYYY-MM-DD)
```

Artifact-specific required sections (templates live in `.claude/skills/artifact-validator/templates/`):

| Artifact | Specific sections |
|---|---|
| `requirements.md` | Цель; Требования (table `R#` / text / priority); Ограничения (budget, currency, deadline, space, power); Что уже есть; Открытые вопросы |
| `research.md` | Технология / подход; Материалы (types, not brands); Безопасность; Типичные ошибки |
| `products.md` | Кандидаты (table: item, model, key specs, fit to owned tools, shops & prices with dates); Совместимость с тем, что есть; Альтернативы; Готовое изделие (benchmark, `project-plan` only) |
| `project-plan.md` | Этапы (numbered, duration, dependencies); Инструменты (owned / missing); Материалы и количества (BOM) |
| `budget.md` | Список покупок (table: item, qty, shop 1–3 price, average, date); Итого; Резерв; Соответствие бюджету; Сделать самому vs купить готовое |
| `validation.md` | Результаты гейтов (table: gate, status, artifact, owner, finding, fix hint); Итог (PASS/FAIL) |
| `final-plan.md` | see §6.3 |

`Источники` may be "Не применимо" only for `requirements.md`, `project-plan.md`, `budget.md`, `validation.md` (they cite upstream artifacts, not the web).

### 6.3 Final plan structure (fixed across runs)

Fixed section order per workflow type. Sections never reorder or disappear; a non-applicable section contains «Не применимо» and a one-line reason. This makes the output predictable across repeated runs with the same input.

`project-plan`:
1. Кратко
2. Что мы учли (confirmed requirements)
3. План работ по этапам
4. Что у тебя уже есть
5. Список покупок (with average prices)
6. Бюджет и сравнение «сделать / купить готовое»
7. Безопасность
8. Риски и неопределённости
9. Что я запишу в твою базу после одобрения
10. Источники

`purchase-decision`: 1 Вердикт · 2 Что мы учли · 3 Как это ляжет на твой инструмент · 4 Альтернативы · 5 Цены и где купить · 6 Безопасность и эксплуатация · 7 Риски и неопределённости · 8 Что я запишу в твою базу · 9 Источники.

`how-to`: 1 Коротко · 2 Что мы учли · 3 Рекомендуемый способ · 4 Материалы · 5 Безопасность · 6 Риски и неопределённости · 7 Источники.

### 6.4 Artifact lifecycle

```
pending → running → created ──stage gate──► validated ──► available to dependents
                       │                        │
                       └─ fail → retry          └─ upstream changed / domain gate fail / rejection → stale → re-run
                       └─ retries exhausted → blocked (dependents → skipped)
```

A non-`validated` artifact is never used as input to downstream work. Each validated artifact records its SHA-256; if the file changes afterwards (manual edit, re-run), it and its dependents become `stale`.

---

## 7. Dynamic agent selection and execution graphs

The coordinator builds the DAG from these rules plus context. Nodes whose dependencies are all `validated` run in parallel.

### 7.1 Selection rules

| Condition | Effect |
|---|---|
| Always | `requirements-formalizer` first; `evidence-validator` → `synthesizer` → approval → `final-output-builder` last |
| `project-plan` | `diy-researcher` → `project-planner` → `product-researcher` → `cost-planner` |
| `project-plan` with ≥2 independent material categories (e.g. boards + hardware) | `product-researcher` split into parallel instances, each owning `products-<category>.md` |
| `purchase-decision` | `product-researcher` ∥ `diy-researcher` (usage, safety, compatibility) → `cost-planner` |
| `how-to` | `diy-researcher` only (+ `product-researcher` if the master asked for specific products) |
| Everything needed is already owned (MCP `check_owned`) | `product-researcher` skipped or limited to missing items; `cost-planner` still runs (shows zero/low spend) |
| No budget given and no purchases needed | `cost-planner` skipped |
| `diy-researcher` scope covers clearly independent topics (e.g. subfloor prep vs adhesive/grout) | split into parallel `research-<topic>.md` |

### 7.2 Example graphs

`purchase-decision` — "Стоит ли покупать фрезер X?":
```
requirements-formalizer
        │
        ├──────────────┬──────────────┐
        ▼              ▼              │  (parallel)
 product-researcher  diy-researcher   │
        └──────┬───────┘
               ▼
          cost-planner → evidence-validator → synthesizer → [approval] → final-output-builder
```

`project-plan` — garage floor tiles (tiles already owned):
```
requirements-formalizer → diy-researcher → project-planner
        → product-researcher (only missing: adhesive, grout, primer, spacers)
        → cost-planner → evidence-validator → synthesizer → [approval] → final-output-builder
```

`project-plan` — wardrobe (split product research):
```
requirements-formalizer → diy-researcher → project-planner
        ├─► product-researcher [boards]   ─┐ (parallel)
        └─► product-researcher [hardware] ─┤
                                           ▼
                     cost-planner → evidence-validator → synthesizer → [approval] → final-output-builder
```

`how-to`:
```
requirements-formalizer → diy-researcher → evidence-validator → synthesizer → [approval] → final-output-builder
```

---

## 8. Workflow state

### 8.1 Single writer

`workflow-state.json` is mutated **only** by `scripts/state.mjs` (atomic write: temp file + rename). The coordinator calls it through Bash; `post-write-state` calls it from the hook. Direct Write/Edit of the file is blocked by `approval-gate-guard`.

`state.mjs` commands: `init`, `confirm-requirements`, `set-plan`, `start <node>`, `artifact-written <path>`, `stage-gate <node> pass|fail <findings>`, `domain-gates <validation.md>`, `invalidate <node> --cascade`, `ready`, `summary`, `set-status`, `set-feedback`, `list-unfinished`.

### 8.2 Shape

```json
{
  "schema_version": 1,
  "run_id": "20261012-1430-garage-tiles",
  "created_at": "...", "updated_at": "...",
  "status": "executing",
  "workflow_type": "project-plan",
  "request_file": "request.md",
  "requirements": { "confirmed": true, "confirmed_at": "...", "artifact_sha256": "..." },
  "config": { "max_retries": 3 },
  "plan": {
    "nodes": [
      {
        "id": "product-researcher",
        "agent": "product-researcher",
        "artifact": "artifacts/products.md",
        "depends_on": ["project-planner"],
        "status": "validated",
        "attempts": 2,
        "retries": 1,
        "artifact_sha256": "...",
        "stage_gate": { "result": "pass", "at": "..." },
        "last_error": null
      }
    ]
  },
  "domain_gates": {
    "attempt": 1,
    "results": [ { "gate": "G1-sources", "status": "fail", "artifact": "products.md", "owner": "product-researcher" } ]
  },
  "approval": {
    "status": "awaiting_approval",
    "round": 1,
    "history": [ { "round": 1, "decision": "rejected", "feedback": "...", "at": "...", "final_plan_sha256": "..." } ]
  },
  "memory_writeback": { "status": "pending" },
  "final_output": { "status": "not_started", "path": null }
}
```

Run status values: `intake`, `requirements`, `planning`, `executing`, `validating`, `synthesizing`, `awaiting_approval`, `revision_requested`, `approved`, `rendering`, `completed`, `blocked`.

Node status values: `pending`, `running`, `created`, `validated`, `stale`, `blocked`, `skipped`.

### 8.3 Resume algorithm

1. `state.mjs list-unfinished` → master picks a run (or the id is given).
2. `state.mjs summary` → coordinator tells the master where the run stopped, in plain Russian.
3. For each node:
   - `validated` and file hash unchanged → skip;
   - `validated` but hash changed → `stale` + cascade;
   - `running` (interrupted) → if file exists, treat as `created` and re-run stage gate; otherwise re-dispatch;
   - `created` → re-run stage gate only.
4. If interrupted during requirements Q&A, continue from `qa-log.md` without repeating answered questions.
5. If `awaiting_approval`, just re-present the plan and approval instructions.
6. If `approved` but output missing → verify approval again → dispatch `final-output-builder`.

---

## 9. Quality gates and retries

### 9.1 Stage gate G0 (per artifact, before dependents)

Run by the coordinator via the `artifact-validator` skill immediately after each node finishes. Deterministic part: `node scripts/check-artifact.mjs <path> <artifact-type>` checks:
- meta block present with correct `artifact`, `owner`, `run`;
- all required headings for this artifact type present, in order;
- `Покрытие требований` references only `R#` IDs that exist in `requirements.md` (semantic coverage is judged in G6);
- `Источники` contains ≥1 URL where sources are required;
- artifact-local part of G1: in `products*.md` and `budget.md` every price row has a URL and a retrieval date; in `research*.md` every numbered recommendation references a source number;
- no internal placeholders (`TODO`, `TBD`, `lorem`).

This ensures sourcing problems are caught before dependents consume the artifact, not only at the final domain gate.

Pass → `validated`; fail → targeted retry of that node (§9.3).

### 9.2 Domain gates G1–G7 (before synthesis)

Run by `evidence-validator` over all validated artifacts. Each failure names gate, artifact, owner and a fix hint.

| Gate | Rule | Typical owner on failure |
|---|---|---|
| G1 Sources | Every recommendation, factual claim that drives a decision and every price links to a real source; prices carry a retrieval date | `diy-researcher`, `product-researcher` |
| G2 Budget | Total (incl. contingency) ≤ confirmed budget; arithmetic consistent; average price = mean of listed prices | `cost-planner` (or `product-researcher` if no cheaper option was researched) |
| G3 No duplicates | Nothing recommended for purchase is already owned (MCP `check_owned`), unless explicitly justified | `product-researcher`, `project-planner` |
| G4 Fit & compatibility | Products fit space, power (230V), owned tools (e.g. collet size, battery platform), and the project's BOM | `product-researcher`, `project-planner` |
| G5 Safety | Electrical, dust/respiratory, PPE, load and anchoring (for wall-hung items), tool-specific hazards covered where relevant | `diy-researcher` |
| G6 Requirements coverage | Every confirmed `must` requirement is addressed by at least one artifact | owner of the artifact responsible for the requirement's area |
| G7 Explicit uncertainty | Unknowns, assumptions and price volatility stated; no unsupported invented facts | owner of the offending artifact |

### 9.3 Targeted retry and downstream regeneration

1. Coordinator reads failures (G0 from script output, G1–G7 from `validation.md`) and maps each to the owner node via the plan.
2. For each affected node: if `retries < max_retries` (default 3, from `config/workflow.json`; i.e. up to 3 re-runs after the first attempt), `state.mjs invalidate <node> --cascade` marks it and **all transitive dependents** `stale`, then re-dispatches the node with the findings as explicit feedback.
3. Dependents are regenerated in DAG order once the node is re-validated. Regenerating a dependent because of an upstream change does not consume its own retry budget.
4. Domain gates re-run after all affected work is re-validated (validator re-checks all gates; previously passed gates normally stay green). Domain-gate rounds are themselves capped at `max_retries + 1`.
5. If a node exhausts its retries: node → `blocked`, all its dependents → `skipped`, run → `blocked`. Independent branches already running may finish, but nothing downstream of the blocked node starts; synthesis, approval and output are not started. The coordinator explains in Russian what failed and why, what was stopped, and options (relax a requirement, provide info, `/garage resume` after changing something).
6. A requirement conflict that cannot be fixed by retry (e.g. budget impossible) is reported to the master immediately instead of burning retries; the master may amend requirements, which invalidates `requirements.md` and cascades.

---

## 10. Human approval (deterministic)

### 10.1 Commands

- `/garage-approve [run-id]`
- `/garage-reject [run-id] <feedback in Russian>`

Both are slash commands with `disable-model-invocation: true`. The command body tells the coordinator to run
`node scripts/approve.mjs approve|reject [<run-id>]` with Bash; the run id is passed only when the first
word of the master's text looks like one, free text never reaches the shell.

`approve.mjs`:
- verifies the run exists and `approval.status == awaiting_approval`;
- compares the SHA-256 of `artifacts/final-plan.md` with the hash recorded by `state.mjs request-approval`
  (the version that was shown); a mismatch refuses the decision;
- **approve:** writes `approval.json` `{ decision: "approved", final_plan_sha256, approved_at, round }` and
  calls `state.mjs record-decision`;
- **reject:** writes `{ decision: "rejected", ... }`; the coordinator stores the feedback with
  `state.mjs set-feedback` and starts the revision loop.

### 10.2 Verification

- `approval-gate-guard` blocks any Write/Edit into `workflows/*/output/**` unless `approval.json` exists, `decision == approved`, and its `final_plan_sha256` equals the current hash of `final-plan.md`; it blocks `node scripts/render-html.mjs <run>` under the same condition.
- The same hook lets the assistant run `approve.mjs` only in a turn whose last human-typed message is the master's own `/garage-approve` (for `approve`) or `/garage-reject` (for `reject`), read from the transcript the harness writes.
- Any change to `final-plan.md` after approval invalidates approval automatically (hash mismatch); a new approval round is required.
- Approval is never inferred from chat text ("ок", "да, норм" do nothing).

### 10.3 Revision loop

On rejection the coordinator classifies the feedback to affected nodes (e.g. "найди плитку дешевле" → `product-researcher` + cascade; "добавь этап гидроизоляции" → `diy-researcher` + `project-planner` + cascade; "перепиши понятнее" → `synthesizer` only), invalidates them with cascade, re-runs, re-validates (G0 + G1–G7), re-synthesises (the synthesizer receives the feedback), and requests approval again (round + 1).

---

## 11. Hooks

Configured in `.claude/settings.json` and invoked as `bash "$CLAUDE_PROJECT_DIR/.claude/hooks/<name>.sh"` (no dependence on executable bits after checkout). Each hook is a thin bash entrypoint delegating JSON parsing to Node (`.claude/hooks/lib/*.mjs`), so `jq` is not required. Blocking uses exit code 2 with a reason on stderr. Hooks also apply to tool calls made by subagents (to be verified on Day 3).

| Hook | Event / matcher | Invariant | Data used | Action |
|---|---|---|---|---|
| `approval-gate-guard` | PreToolUse `Write\|Edit\|MultiEdit\|Bash` | (a) no final output without verified approval; (b) `approval.json` and `workflow-state.json` are never edited by the model | tool input path/command, `approval.json`, `final-plan.md` hash | Block write to `workflows/*/output/**` if approval invalid; block any Write/Edit/Bash targeting `approval.json` or `workflow-state.json` except `node scripts/state.mjs` |
| `no-leak-guard` | PreToolUse `Write\|Edit` on `final-plan.md` and `workflows/*/output/**` | user-facing text contains no internal names | content being written (the `<!-- meta -->` block of `final-plan.md` is ignored and never rendered), list of internal names (artifact filenames, agent names, `workflow-state`, `workflows/`) | Block with the list of leaked tokens so the agent rewrites |
| `memory-write-guard` | PreToolUse `mcp__workshop-memory__(add_\|update_\|record_\|upsert_).*` | run-derived memory updates only after approval | tool input `run_id`, state of that run | If `run_id` present and run approval invalid → block. Writes without `run_id` (onboarding, direct updates confirmed in chat) pass |
| `post-write-state` | PostToolUse `Write\|Edit` on `workflows/*/artifacts/*.md` | state always reflects what is on disk | file path, content | `state.mjs artifact-written <path>`: record hash, set node `created`, flag dependents `stale` if a validated artifact changed |

---

## 12. Skills

| Skill | Used by | Contents | Interface |
|---|---|---|---|
| `artifact-validator` | coordinator (G0), `evidence-validator`, `synthesizer` | Common artifact skeleton, per-type templates (`templates/*.md`), structural rules, how to run `scripts/check-artifact.mjs`, how to report findings (gate, artifact, owner, finding, fix hint) | Input: artifact path + type. Output: PASS or list of findings in the standard format |
| `research-evidence` | `diy-researcher`, `product-researcher`, `evidence-validator` | Source quality ranking (manufacturer > standards/official > reputable shops > reviews > forums), Polish shop list (Castorama, Leroy Merlin, OBI, Bricomarché, Allegro, Media Expert, producer stores; OLX for used), price capture rules (2–3 shops, retrieval date, currency from profile, "ориентировочно" flag when only search snippets available), citation format, how to mark uncertainty, never invent URLs or prices | Instructions + citation/price table formats |
| `garage-html-theme` | `final-output-builder` | Standalone HTML template (`template.html`, inline CSS, light/dark, print-friendly for PDF via browser), mapping of `final-plan.md` sections to HTML blocks, shopping-list table styling, checklist for steps | Input: `final-plan.md`. Output: `output/garage-plan.html` with fixed section order |

---

## 13. MCP: `workshop-memory`

Custom stdio server, Node.js ≥ 22.13, SQLite via built-in `node:sqlite`, deps: `@modelcontextprotocol/sdk`, `zod`. Configured in project `.mcp.json`:

```json
{
  "mcpServers": {
    "workshop-memory": {
      "command": "node",
      "args": ["mcp/workshop-memory/server.mjs"],
      "env": { "GARAGE_DB": "${GARAGE_DB:-data/garage.db}" }
    }
  }
}
```

### 13.1 Schema (`schema.sql`)

| Table | Key columns |
|---|---|
| `profile` (single row) | name, city, country, currency, units, voltage, garage_size_m2, garage_notes, power_notes, dust_extraction, skill_level, preferences, tone, updated_at |
| `inventory` | id, kind (`tool`/`material`/`consumable`/`hardware`), name, brand, model, category, specs (e.g. "collet 8 mm"), quantity, unit, condition, location, notes, created_at, updated_at |
| `purchases` | id, item_name, inventory_id, shop, price, currency, quantity, purchased_at, run_id, notes |
| `projects` | id, title, workflow_type, status (`idea`/`planned`/`in_progress`/`done`/`abandoned`), run_id, budget, currency, summary, created_at, updated_at |

### 13.2 Tools

| Tool | Kind | Used by |
|---|---|---|
| `get_profile` | read | coordinator, formalizer, researchers |
| `update_profile` | write | coordinator (onboarding) |
| `list_inventory(kind?, category?, query?)` | read | formalizer, planner, product-researcher |
| `check_owned(items[])` | read | product-researcher, project-planner, evidence-validator (G3) |
| `add_inventory_item` / `update_inventory_item` | write | coordinator (onboarding, write-back) |
| `record_purchase` | write | coordinator (when the master reports a purchase) |
| `list_projects(status?)` / `upsert_project` | read / write | coordinator (write-back after approval) |

Write tools accept an optional `run_id`; when present, `memory-write-guard` requires approval of that run.

### 13.3 Data and privacy

- `data/*.db` is git-ignored (repository is public; real workshop data is personal).
- `seed.demo.sql` contains a fictional demo master (Wrocław, PLN) used for the committed demo runs: `GARAGE_DB=data/demo.db claude`.
- `scripts/setup.sh` creates `data/garage.db` (empty schema) and `data/demo.db` (schema + demo seed).

---

## 14. External information sources

- `WebSearch`, `WebFetch` (built-in) — mandatory for `diy-researcher` and `product-researcher`; G1 fails any decision-driving claim or price without a URL.
- Price capture: when shop pages block fetching, prices may come from search result snippets, marked «ориентировочно» with date; the average is computed only from captured prices.
- MCP `workshop-memory` — personal context (profile, inventory, projects) that makes research personal and drives G3/G4.

Stretch (post-MVP): YouTube transcript MCP for long-term reviews; layout planner.

---

## 15. Repository structure

```
garage_assist/
├── CLAUDE.md                     # workflow + execution rules (English)
├── README.md                     # prerequisites, setup, run, approve/reject, resume, demo runs
├── .gitignore                    # data/*.db, .env*, node_modules, .claude/settings.local.json
├── .nvmrc                        # 22
├── .mcp.json
├── config/
│   └── workflow.json             # max_retries: 3, default tone, models
├── task_description.md           # assignment, kept at root as the reference
├── docs/
│   ├── garage-copilot-design.md  # this document
│   └── background/               # garage_copilot.txt, prompt.txt (brainstorm material, moved)
├── .claude/
│   ├── settings.json             # hooks registration, permissions
│   ├── commands/
│   │   ├── garage.md             # coordinator
│   │   ├── garage-approve.md
│   │   └── garage-reject.md
│   ├── agents/                   # 8 subagent definitions
│   ├── skills/
│   │   ├── artifact-validator/   # SKILL.md, templates/*.md
│   │   ├── research-evidence/    # SKILL.md
│   │   └── garage-html-theme/    # SKILL.md, template.html
│   └── hooks/
│       ├── approval-gate-guard.sh
│       ├── no-leak-guard.sh
│       ├── memory-write-guard.sh
│       ├── post-write-state.sh
│       └── lib/*.mjs
├── mcp/workshop-memory/          # package.json, server.mjs, db.mjs, schema.sql, seed.demo.sql
├── scripts/                      # setup.sh, state.mjs, approve.mjs, check-artifact.mjs
├── data/.gitkeep                 # databases live here, ignored
└── workflows/                    # committed demo runs (inputs, artifacts, state, approval, output)
```

`mcp/workshop-memory/package-lock.json` is committed so `npm ci` is reproducible from a clean checkout.

---

## 16. Secrets and configuration

- No secrets are required by the MVP: Claude Code's own login is the only credential; web search is built-in; the MCP server is local.
- If Claude Code is used with API-key auth, `ANTHROPIC_API_KEY` is set in the shell environment, never in the repo.
- `.env*`, `data/*.db`, `.claude/settings.local.json`, `node_modules/` are git-ignored.
- README documents optional `GARAGE_DB` env var, that Claude Code asks once to trust the project MCP server from `.mcp.json`, and that `scripts/setup.sh` runs `npm ci` and creates the databases.
- A pre-commit check (`git grep` for key patterns) is run before each demo-run commit.

---

## 17. Demo runs (committed)

All on the demo profile (`data/demo.db`), each stored with `request.md`, `qa-log.md`, all artifacts, `workflow-state.json`, `approval.json`, `output/garage-plan.html`.

| Run | Scenario | Demonstrates |
|---|---|---|
| run 1 | `project-plan`: garage floor tiles (tiles already owned) | requirements Q&A, context adaptation (owned items excluded), sequential chain, full approval |
| run 2 | `purchase-decision`: router for furniture work | parallel research branch, compatibility with owned tools (G4), verdict format |
| run 3 | `project-plan`: hanging shelf in hallway | safety gate (anchoring/load), targeted retry with downstream regeneration, one rejection + revision round, interrupted session + resume |
| run 4 (optional) | `project-plan`: wardrobe | parallel split of `product-researcher` |

Retry demonstration: if no gate fails naturally in run 3, a documented fault injection is used — between steps the `Источники` section of `products.md` is removed by hand; `post-write-state` marks it stale, G0/G1 fail, the coordinator retries only `product-researcher` and regenerates `cost-planner`. This is recorded in the run's README note; nothing is faked in artifacts.

Resume demonstration: the Claude Code process is killed mid-execution in run 3; `/garage resume <run-id>` continues from the persisted state; the state history shows completed nodes were not re-run.

---

## 18. Implementation plan

> Historical plan. Actual progress and decisions: [`implementation-status.md`](implementation-status.md).

Each step ends with a verifiable acceptance check. Nothing is marked done in §19 until its check passes.

### Day 1 — 2026-10-10: foundation and memory
1. `git init`, `.gitignore`, `.nvmrc`, move brainstorm files to `docs/background/`, `config/workflow.json`.
2. `mcp/workshop-memory`: schema, seed, server with all tools; `scripts/setup.sh`.
   *Check:* setup creates both DBs; each tool works via a stdio smoke test script.
3. `.mcp.json`; Claude Code lists the server and its tools.
4. Draft `CLAUDE.md` (language, tone, roles, execution rules).
5. `/garage` skeleton: onboarding + intake + `requirements-formalizer` + Q&A loop + confirmation.
   *Check:* empty DB triggers onboarding; profile written; a request yields confirmed `requirements.md`.

### Day 2 — 2026-10-11: research and planning agents
6. `scripts/state.mjs` (init, set-plan, ready, start, artifact-written, invalidate --cascade, summary).
   *Check:* unit-run on a sample DAG: `ready` and cascade behave correctly.
7. `artifact-validator` skill + templates + `scripts/check-artifact.mjs`.
8. `research-evidence` skill.
9. `diy-researcher`, `product-researcher`, `project-planner`, `cost-planner`.
10. Coordinator: DAG building from selection rules, parallel dispatch, G0 after each node.
    *Check:* tiles request runs end-to-end up to `budget.md`, all artifacts pass G0.

### Day 3 — 2026-10-12: gates, retries, hooks, persistence
11. `evidence-validator` with G1–G7; coordinator failure mapping, targeted retry, cascade, retry limit, blocked reporting.
    *Check:* fault injection triggers retry of one node + regeneration of its dependents only.
12. Hooks: `post-write-state`, `approval-gate-guard`, `no-leak-guard`, `memory-write-guard`; `.claude/settings.json`.
    *Check:* each hook blocks/records on a crafted case, including inside a subagent.
13. Resume flow (`/garage resume`).
    *Check:* kill mid-run, resume, validated nodes not re-dispatched.

### Day 4 — 2026-10-13: synthesis, approval, output, write-back
14. `synthesizer` with fixed final structures for all workflow types.
15. `scripts/approve.mjs`, `/garage-approve`, `/garage-reject`, revision loop.
    *Check:* output write blocked before approval; approve → allowed; edit `final-plan.md` → blocked again; reject → revision → new round.
16. `garage-html-theme` skill + `final-output-builder`.
    *Check:* HTML renders standalone, sections in fixed order, no internal names.
17. Memory write-back after approval.
    *Check:* project row created only after approval; blocked before.

### Day 5 — 2026-10-14: demo runs and documentation
18. Demo runs 1–3 (and 4 if time) on the demo DB; commit full run folders.
19. Final `CLAUDE.md`, `README.md` (prerequisites, setup, run, approve/reject, resume, demo DB, troubleshooting).
20. Clean-checkout test: fresh clone → setup → `/garage` how-to run works.
21. Secret scan; traceability table (§19) updated with real statuses.

### 2026-10-15 — buffer and submission.

Scope cut order if late: run 4 → `how-to` workflow → `memory-write-guard` (keep write-back with chat confirmation) → split parallel product research (purchase-decision still shows parallelism).

---

## 19. Requirements traceability

Moved to [`traceability.md`](traceability.md), which records the real status and the evidence for every
requirement of the task. The table that stood here only listed the planned design.

---

## 20. Risks and open points

| Risk | Mitigation |
|---|---|
| Polish shops block `WebFetch` (Allegro especially) | Prices from search snippets marked «ориентировочно» with date; ≥2 shops required where possible; G1 still requires a URL |
| PreToolUse hooks may behave differently for subagent tool calls | Still unproven live (transcripts do not record hook runs); the renderer and `state.mjs` re-check approval themselves (defence in depth); a deliberate probe is planned (traceability §D) |
| Model bypasses `state.mjs` via Bash redirection | `approval-gate-guard` inspects Bash commands for `workflow-state.json` / `approval.json` |
| `memory-write-guard` relies on `run_id` being passed | Coordinator rules require `run_id` for write-back; documented limitation |
| Domain gates are model-judged (non-deterministic) | Deterministic G0 for structure; G1–G7 findings must cite artifact + evidence; repeated runs use fixed templates |
| Long runs eat the schedule | Demo runs on Day 5 morning; scope cut order in §18 |
| Approval provenance depends on a transcript marker (`origin.kind = human`) | Fails closed: without the marker the assistant cannot approve; documented in traceability §E |
| Same input → different research results across runs | Structure is fixed; content variance is expected and allowed by the task (structure must be predictable, not content) |
