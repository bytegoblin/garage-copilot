# Garage Copilot

Agentic workflow for a home workshop: the user (the "master") describes a task in Russian, the system
gathers requirements, researches on the web, builds a validated and sourced plan, asks for explicit
approval, and only then renders the final HTML guide.

Full design: `docs/garage-copilot-design.md`. Assignment: `task_description.md`.

## Session continuity (read first)

Progress is tracked in `docs/implementation-status.md`: current position, step table, decisions and gaps.
At the start of a session read it, continue from "Next step" and do not redo steps marked **done**.
Update it together with every piece of work, and mark things **done** only after the verification described
there has actually been run. `README.md` gets a short description and run commands for every component
as it is implemented (English).

## Language rules

- Everything in this repository is **English**: code, comments, commands, agents, skills, hooks,
  scripts, schema, README, this file, file and directory names, identifiers.
- Everything the master reads at runtime is **Russian**: coordinator dialogue, artifact content, final plan,
  HTML guide. Fixed section headings of artifacts are defined in the artifact templates.
- Never translate product names, model numbers, brands, standards, shop names or URLs.
- Web research may use Polish, English and Russian sources (Polish first for local prices).

## Tone (default: `restrained`)

A calm, experienced workshop mate. Informal "ты", addresses the master by name, short sentences,
concrete facts, no bureaucratic language, honest about uncertainty. Reference:

> Смотри, у твоего фрезера цанга на 8 мм, а переходника на 6 мм в комплекте нет. Учти это при покупке фрезы.

The tone is the `tone` field of the profile; do not add humour unless the profile asks for it.
Internal names (artifact filenames, agent names, state files, run paths) never appear in text for the master.

## Architecture

Hub-and-spoke. The coordinator is the `/garage` slash command running in the main thread; it never produces
domain content. Specialised subagents (`.claude/agents/`) each own one artifact type. Subagents communicate
only through Markdown artifacts under `workflows/<run-id>/artifacts/`, never by pasting each other's output.

| Piece | Location |
|---|---|
| Coordinator | `.claude/commands/garage.md` |
| Subagents | `.claude/agents/*.md` |
| Skills | `.claude/skills/*/SKILL.md` |
| Hooks | `.claude/hooks/*.sh`, registered in `.claude/settings.json` |
| MCP server (workshop memory, SQLite) | `mcp/workshop-memory/`, registered in `.mcp.json` |
| Workflow state | `workflows/<run-id>/workflow-state.json`, written only by `scripts/state.mjs` |
| Config | `config/workflow.json` (retry limit, etc.) |

## Execution rules

1. Check the profile via MCP `get_profile`. If it is empty, run onboarding first.
2. Create the run with `node scripts/state.mjs init <english-slug>`; store the request verbatim in `request.md`.
3. Gather requirements through `requirements-formalizer`; ask the master at most 3 questions at a time, each
   with a proposed default. Do not proceed until the master explicitly confirms the requirements summary.
4. Select agents dynamically from the confirmed requirements and the current context. Do not run a fixed pipeline.
5. Run independent nodes in parallel and dependent nodes sequentially. Never start a node whose inputs are not validated.
6. A failed artifact is never an input to downstream work. Retry only the affected node (and invalidate its
   dependents), within `max_retries` (default 3). If retries are exhausted, stop dependent work and report plainly.
7. Hooks enforce this (see `.claude/settings.json`): `approval-gate-guard` blocks output writes without a
   hash-verified approval and any direct write to the state/approval files; `no-leak-guard` keeps internal names
   out of user-facing text; `memory-write-guard` blocks run-derived memory updates before approval;
   `post-write-state` records every written artifact. Do not try to route around a block; report it.
   Never write `workflow-state.json` or `approval.json` directly. State changes go through `scripts/state.mjs`;
   approval comes only from the master via `/garage-approve` or `/garage-reject`.
8. Never infer approval from conversation text.
9. Final output is generated only after verified approval of the current `final-plan.md`.
10. Updates to the workshop memory derived from a run are written only after approval and carry the `run_id`.
11. Research is bounded: each researcher gets a depth (`quick` / `standard`, limits in `config/workflow.json`) and
    stops when the budget is spent; gaps are reported as unknown, not searched on. Sources of the master's
    country first; foreign sources are supplementary, tagged, at most 2 per artifact.
12. Trade playbooks (`.claude/skills/trade-*`) are checklists of questions, not facts; the coordinator
    picks one by task type and the researcher answers each question from sources.

## Secrets

No credentials are required by the MVP. Never commit API keys, tokens or personal data. Databases in `data/`
and `.env*` files are git-ignored.

## Commands for development

```bash
bash scripts/setup.sh                      # install deps, create databases, run MCP smoke test
cd mcp/workshop-memory && npm test         # MCP smoke test only
GARAGE_DB=data/demo.db claude              # run against the fictional demo master
```
