# Garage Copilot

A personal workshop assistant built as an agentic workflow on Claude Code. You describe a task in natural
language (Russian), and the system gathers and confirms requirements, researches on the web, produces a
validated and sourced plan with a shopping list and budget, asks for your explicit approval, and only then
renders the final HTML guide. It remembers your workshop (tools, materials, purchases, projects) in a local
SQLite database through a custom MCP server.

> **Status: feature complete, demo runs in progress.** See [docs/traceability.md](docs/traceability.md) for
> how each requirement of the assignment is met and verified, and
> [docs/implementation-status.md](docs/implementation-status.md) for the work log. Original design:
> [docs/garage-copilot-design.md](docs/garage-copilot-design.md).

## How it works

Hub-and-spoke architecture. The `/garage` slash command is the coordinator: it never produces domain
content, it plans the work, dispatches specialised subagents, validates their Markdown artifacts, and
handles approval and state. Subagents each own one artifact type and communicate only through files.

Implemented so far:

| Component | Where | What it does |
|---|---|---|
| Coordinator | `.claude/commands/garage.md` | Onboarding, intake, requirements Q&A and confirmation, dynamic planning, parallel/sequential execution, stage gates, retries, resume |
| `requirements-formalizer` | `.claude/agents/requirements-formalizer.md` | Turns request, Q&A and profile into numbered requirements |
| `diy-researcher` | `.claude/agents/diy-researcher.md` | Web research on technique, conditions, materials, safety |
| `product-researcher` | `.claude/agents/product-researcher.md` | Concrete products and local prices, checked against what you own |
| `project-planner` | `.claude/agents/project-planner.md` | Phases, tools, materials with quantities |
| `cost-planner` | `.claude/agents/cost-planner.md` | Shopping list, totals, budget fit, DIY vs ready-made |
| `synthesizer` | `.claude/agents/synthesizer.md` | Merges validated artifacts into one final plan in the fixed structure of the workflow type, in the master's voice |
| `final-output-builder` | `.claude/agents/final-output-builder.md` | Runs the deterministic renderer after approval; owns the HTML guide |
| Approval commands | `.claude/commands/garage-approve.md`, `garage-reject.md`, `scripts/approve.mjs` | The master's explicit decision, bound to the SHA-256 of the exact plan that was shown |
| HTML renderer | `scripts/render-html.mjs`, `.claude/skills/garage-html-theme/` | Standalone, deterministic HTML from the approved plan; refuses without a matching approval |
| `evidence-validator` | `.claude/agents/evidence-validator.md` | Independent gates G1–G7 (sources, budget arithmetic, duplicates, fit, safety, requirement coverage, uncertainty); maps each failure to the owner node |
| Hooks | `.claude/hooks/`, `.claude/settings.json` | `approval-gate-guard` and `no-leak-guard` (PreToolUse), `memory-write-guard` (PreToolUse on memory tools), `post-write-state` (PostToolUse) |
| Skills | `.claude/skills/` | `artifact-validator` (structure and citation check, templates), `research-evidence` (research budget, local sources first, prices, uncertainty), `master-voice` (how the master's text is written), `master-onboarding` (first-run profile questions), `garage-html-theme`, `trade-tiling` and `trade-carpentry` (research playbooks: question checklists per trade) |
| `workshop-memory` MCP server | `mcp/workshop-memory/` | Profile, inventory, purchases, projects on SQLite (9 tools) |
| Run state | `scripts/state.mjs` (incl. composite `start-ready`, `finish-node`) | Single writer of `workflows/<run-id>/workflow-state.json`: plan DAG, node statuses, retries, cascade invalidation |
| Stage gate G0 | `scripts/check-artifact.mjs` | Deterministic structural check of every artifact before dependents start |

## Prerequisites

- [Claude Code](https://docs.claude.com/en/docs/claude-code) installed and logged in
- Node.js >= 22.13 (`nvm install` in the repo root picks the version from `.nvmrc`)
- Git

No API keys or other secrets are required. Optionally, if you run Claude Code with API-key authentication,
`ANTHROPIC_API_KEY` is read from your shell environment and is never stored in the repository.

## Setup

```bash
git clone <repository-url> garage_assist
cd garage_assist
nvm install            # optional, if you use nvm
bash scripts/setup.sh  # installs MCP deps, creates data/garage.db and data/demo.db, runs a smoke test
```

`setup.sh` is safe to re-run; existing databases are never overwritten. You will see an
`ExperimentalWarning: SQLite` message: `node:sqlite` is still flagged experimental in Node 22 and works fine.

## Run

```bash
claude                              # your own workshop (data/garage.db, empty until onboarding)
GARAGE_DB=data/demo.db claude       # fictional demo master from Wrocław
```

On the first start Claude Code asks you to approve the project MCP server `workshop-memory` from
`.mcp.json`. With an empty database the first `/garage` runs a short onboarding (three rounds of at most three
questions: name, city, country and currency; garage, power and dust extraction; skill level, preferences and
main tools; instructions in `.claude/skills/master-onboarding/SKILL.md`), shows a summary, and saves it only
after you confirm. Then:

```text
/garage Хочу уложить плитку в гараже
```

On the first run the coordinator introduces itself and asks a few questions about you and your workshop
(city, currency, tools, skill level) and stores the answers in the database.

## Approve or reject a plan

When a plan is ready the coordinator shows it and stops. Only your explicit command moves it forward:

```text
/garage-approve                         # approve the plan that was shown (run id optional if only one waits)
/garage-reject Найди клей подешевле     # reject and say what to change; a revised plan is shown again
```

Approval is recorded together with the SHA-256 of the exact plan text you were shown. If the plan changes
afterwards the approval is void. Only after a valid approval the guide is rendered to
`workflows/<run-id>/output/garage-plan.html`, a standalone page you can open or print, and the project is
written to your workshop memory. Typing "ok" or "approved" in the chat does nothing by design.

## Tests

```bash
cd mcp/workshop-memory && npm test        # starts the MCP server over stdio and exercises every tool
node --test scripts/test/*.test.mjs       # state machine, composite commands, artifact checker, hooks, approval, contracts
```

## Checking the guard hooks

```text
/garage-probe-hooks
```

A scripted developer check: a throw-away run and a subagent attempt five actions that the hooks must block
or record (a leak in the plan, output without approval, a direct write to the state file, a normal artifact
write, a memory write for an unapproved run). The result is written to `docs/hook-probe.md`.

## Measuring token usage

```bash
node scripts/usage-report.mjs <session-id> [<session-id> ...]   # calls and tokens per agent, de-duplicated
```

Session ids are the file names under `~/.claude/projects/<project>/`.

## Repository layout

```text
.claude/commands/     slash commands (coordinator)
.claude/agents/       subagents
mcp/workshop-memory/  custom MCP server (Node.js, SQLite)
scripts/              setup and workflow-state scripts
config/               workflow configuration (retry limit)
data/                 local databases (git-ignored)
workflows/            run folders: request, artifacts, state
docs/                 design, implementation status, background material
```

## Resume an interrupted run

Progress is persisted after every step in `workflows/<run-id>/workflow-state.json`. After an interruption
(closed terminal, crashed session) start Claude Code again and run:

```text
/garage resume
```

Tip: after a pause, or when a session has grown long, start a **new** session and run `/garage resume`.
The state is on disk, a fresh session starts with a small context and the run costs noticeably fewer tokens.

With one unfinished run it continues that run; with several it asks which one. Validated artifacts whose
files are unchanged are not re-run; edited or missing ones are marked stale together with their dependents,
and only that work is redone. Approval-related resume (after the final plan is produced) is added with the
approval step.

## Privacy

The repository is public. `data/*.db` and `.env*` are git-ignored, so your real workshop data stays local.
Committed demo runs use the fictional demo master only.
