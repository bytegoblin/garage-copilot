<task>
Claude Learning - Practical Task
Build a Reliable Agentic Workflow with Claude Code
Overview
This practical assignment requires building a complete agentic workflow from scratch using Claude Code. The workflow must analyze the initial input, gather requirements, plan the work, dynamically select the required subagents, execute the necessary steps, solve the given task, and produce the final result in a clear, human-readable format.
The workflow is invoked directly by the user via a custom Claude Code slash command, which instantiates the coordinator. A custom implementation built with the Claude Agent SDK is also allowed but requires your own Anthropic API key.
System Architecture
The workflow must use a model-driven, hub-and-spoke architecture with dynamic subagent selection. A coordinator acts as the central orchestration point, gathering requirements, planning the work, selecting the required subagents, and managing execution.
Each subagent has a single responsibility and explicit artifact ownership. Subagent outputs follow a consistent structure and are passed to a dedicated synthesis subagent, which combines them into a coherent artifact. Dependent subagents run sequentially, while independent subagents run in parallel.
Explicit quality gates validate workflow artifacts. On a gate failure, the coordinator identifies the affected work and re-runs only the required agents. Execution and validation repeat until the gate passes or the retry limit is reached.
Final output generation requires explicit human approval that is deterministically verified before the output is created. Rejected work is revised and submitted for approval again.
Workflow state is persisted so execution can recover from interruptions and process restarts, preserving completed work and continuing only the remaining or failed work.
Requirements
- The workflow must gather, capture, and confirm all missing information required to process the initial request.
- The workflow must adapt its execution plan to the confirmed requirements and current workflow context.
- The workflow must support sequential and parallel execution based on task dependencies.
- The workflow must use external information sources, including web search, and integrate at least one MCP server. It must not rely solely on the model's internal knowledge.
- Common workflow capabilities must be implemented as reusable skills.
- Workflow artifacts must follow a consistent and predictable structure and pass the required quality gates before dependent work proceeds.
- Quality gate failures must trigger targeted retries of only the affected work within a defined retry limit. If affected work has dependent downstream artifacts, those artifacts must also be revised or regenerated. Unresolved failures must stop dependent execution and be clearly reported.
- Workflow progress must survive interruptions and process restarts. Resuming must continue from the persisted workflow state without unnecessarily repeating completed work.
- Final output generation must require explicit and deterministically verified human approval. Rejected results must be revised based on feedback and submitted for approval again.
- The final result must address the confirmed requirements, follow a consistent and predictable document structure across repeated runs with the same input, and be delivered in a clear, human-readable Markdown, HTML, and/or PDF format.
Definition of Done
The assignment is considered complete when:
- CLAUDE.md documents the workflow and its execution rules.
- At least 5 subagents and 1 coordinator are used in the workflow.
- At least 2 reusable skills are implemented and used by the workflow.
- PreToolUse and PostToolUse hooks are implemented and used by the workflow.
- At least one community or custom MCP server is integrated and used by the workflow.
- All workflow components, skills, hooks, and MCP configuration are stored in the repository and version-controlled.
- At least 3 workflow runs, including their sample inputs, artifacts, and execution state, are stored in the repository to demonstrate the workflow's ability to handle different scenarios.
- README.md provides setup, run, and resume instructions, including required prerequisites and environment configuration.
- No credentials, API keys, or secrets are committed to the repository. Required secrets are documented and excluded from version control.
- The workflow can be set up and run from a clean repository checkout using the documented instructions after the required prerequisites and credentials are provided.
Domain
Choose one of the suggested domains or define a custom domain:
- Event Planner - plans and organizes an event based on the occasion, budget, location, guest preferences, schedule, and required services, producing a complete event plan.
- Personalized Learning Assistant - assesses learning goals and current knowledge, researches relevant resources, and builds a structured learning path with exercises and assessments.
- Fitness Program Builder - analyzes fitness goals, experience, available equipment, and constraints to create a structured training program.
Note: Any domain is allowed except Travel Planner, as its implementation is provided above.
Example - Travel Planner
Creates a personalized trip plan based on destination, transport, weather, accommodation, activities, food, packing, budget, and traveler preferences.
Input
/plan-trip Plan a 5-day family trip to Lisbon. We're 2 adults and 2 kids (ages 5 and 8). Departure from Warsaw on August 1, 2026. We prefer a comfortable trip with sightseeing, nearby beaches, good local restaurants, activities for children, and minimal walking due to the summer heat.
Output
- travel-guide.html
Artifacts
The workflow artifacts are human-readable Markdown files. Simplicity is the main driver for this education project: they're read by humans and agents rather than parsed by a program, so there's no need for structured JSON or deterministic artifact checks.
Execution flow
requirements-formalizer → [<transport>-planner, weather] → [accommodation-planner, activities-planner, food-planner] → [packing-planner, budget-aggregator] → validator (gates; targeted retry on fail, max 3) → daily-plan-builder → human approval (revision loop on reject) → html-builder
image
Coordinator
- The /plan-trip orchestrator - coordinates the whole workflow: builds the execution plan, runs quality gates, enforces human approval, maps failures to the right agent, persists/resumes state. Produces no travel content.
Sub-agents
- requirements-formalizer - formalizes the request and clarifying Q&A into structured requirements (transport mode, trip currency, constraints).
- flight-planner / train-planner / car-planner - plans transport for the confirmed mode; exactly one runs per trip.
- weather - per-stop weather outlook via the Open-Meteo MCP.
- accommodation-planner - finds accommodation matching preferences and budget.
- activities-planner - finds activities/attractions with duration, cost, and suitability.
- food-planner - suggests restaurants/cuisine matching dietary constraints.
- packing-planner - builds a personalised packing checklist from the weather outlook and planned activities.
- budget-aggregator - aggregates costs from all domain agents into a total.
- validator - checks all artifacts against named quality gates; reports pass/fail with findings.
- daily-plan-builder- merges validated artifacts into a day-by-day itinerary.
- html-builder - renders the approved daily plan as a standalone HTML guide.
Quality gates
- Budget total ≤ user limit
- Daily travel time ≤ user limit
- No duplicate attractions
- Every day has ≥1 meaningful activity
- Transport matches user preference
- Accommodation matches preferences (stars, parking, accessibility)
- Every recommendation links to a real source page
Skills
- artifact-validator - reusable structural + citation check applied to each new artifact before the next group runs.
- trip-html-theme-builder - reusable HTML rendering rules and the predefined template in a trip-guide visual style.
Hooks
- PreToolUse - approval-gate-guard (blocks the final HTML write until the daily plan is approved) and no-leak-guard (keeps internal artifact filenames out of user-facing output).
- PostToolUse - post-write-state (updates persisted workflow-state.json whenever an artifact is written).
MCP
- Open-Meteo
</task>