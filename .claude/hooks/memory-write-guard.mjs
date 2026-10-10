// PreToolUse (mcp__workshop-memory__ write tools): memory updates derived from a run (they carry run_id)
// are allowed only after that run's plan is approved. Writes without run_id (onboarding, profile edits
// the master dictated) pass.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readInput, block, approvalStatus, workflowsDir } from './lib/common.mjs';

const input = readInput();
const runId = input.tool_input?.run_id;
if (!runId) process.exit(0);
if (!/^[0-9]{8}-[0-9]{4}-[a-z0-9-]+$/.test(runId) || !existsSync(join(workflowsDir(input), runId))) {
  block(`Blocked: unknown run "${runId}" for a memory update.`);
}
const a = approvalStatus(input, runId);
if (!a.ok) block(`Blocked: memory is updated from a run only after its plan is approved - ${a.reason}.`);
process.exit(0);
