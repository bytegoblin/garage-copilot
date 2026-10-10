#!/usr/bin/env node
// The only way a plan gets approved or rejected. Invoked by the /garage-approve and /garage-reject commands
// through a `!` shell substitution, i.e. by the harness before the model sees the prompt.
// Usage: node scripts/approve.mjs approve|reject [run-id]
import { readFileSync, writeFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG = JSON.parse(readFileSync(join(ROOT, 'config', 'workflow.json'), 'utf8'));
const RUN_ID_RE = new RegExp(CONFIG.run_id_pattern);
const WORKFLOWS = process.env.GARAGE_WORKFLOWS_DIR ? resolve(process.env.GARAGE_WORKFLOWS_DIR) : join(ROOT, 'workflows');

const die = (msg) => {
  console.error(`APPROVAL REFUSED: ${msg}`);
  process.exit(1);
};
const readState = (id) => JSON.parse(readFileSync(join(WORKFLOWS, id, 'workflow-state.json'), 'utf8'));

const [decision, given] = process.argv.slice(2);
if (!['approve', 'reject'].includes(decision)) die('usage: approve.mjs approve|reject [run-id]');

let runId = given && RUN_ID_RE.test(given.trim()) ? given.trim() : '';
if (!runId) {
  const waiting = existsSync(WORKFLOWS)
    ? readdirSync(WORKFLOWS).filter((n) => RUN_ID_RE.test(n) && existsSync(join(WORKFLOWS, n, 'workflow-state.json'))
      && readState(n).approval?.status === 'awaiting_approval')
    : [];
  if (waiting.length === 1) runId = waiting[0];
  else if (waiting.length === 0) die('no run is awaiting approval');
  else die(`several runs await approval, give the run id: ${waiting.join(', ')}`);
}
if (!RUN_ID_RE.test(runId)) die(`invalid run id: ${runId}`);
const dir = join(WORKFLOWS, runId);
if (!existsSync(join(dir, 'workflow-state.json'))) die(`run not found: ${runId}`);

const state = readState(runId);
if (state.approval.status !== 'awaiting_approval') die(`run is not awaiting approval (status: ${state.approval.status})`);
const planFile = join(dir, 'artifacts', 'final-plan.md');
if (!existsSync(planFile)) die('the final plan does not exist');
const hash = createHash('sha256').update(readFileSync(planFile)).digest('hex');
if (hash !== state.approval.pending_sha256) {
  die('the plan on disk is not the version that was presented to the master; a new approval round is required');
}

const approvalFile = join(dir, 'approval.json');
const record = {
  decision: decision === 'approve' ? 'approved' : 'rejected',
  final_plan_sha256: hash,
  round: state.approval.round,
  decided_at: new Date().toISOString(),
  ...(decision === 'approve' ? { approved_at: new Date().toISOString() } : {}),
};
writeFileSync(approvalFile, JSON.stringify(record, null, 2) + '\n');

const r = spawnSync('node', [join(ROOT, 'scripts', 'state.mjs'), 'record-decision', runId, record.decision, hash], {
  encoding: 'utf8',
  env: process.env,
});
if (r.status !== 0) {
  rmSync(approvalFile, { force: true });
  die((r.stderr || r.stdout).trim());
}
console.log(`${record.decision.toUpperCase()}: run ${runId}, round ${record.round}, plan ${hash.slice(0, 8)}`);
