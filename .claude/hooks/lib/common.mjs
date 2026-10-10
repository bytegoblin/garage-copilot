// Shared helpers for the Garage Copilot hooks. Hooks receive the tool call as JSON on stdin and block by
// exiting with code 2 and a reason on stderr.
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, join, relative, sep } from 'node:path';

export function readInput() {
  try {
    return JSON.parse(readFileSync(0, 'utf8') || '{}');
  } catch {
    return {};
  }
}

export function projectRoot(input) {
  return resolve(process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd());
}

export function workflowsDir(input) {
  return process.env.GARAGE_WORKFLOWS_DIR
    ? resolve(process.env.GARAGE_WORKFLOWS_DIR)
    : join(projectRoot(input), 'workflows');
}

export function block(reason) {
  process.stderr.write(`${reason}\n`);
  process.exit(2);
}

export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

// Paths a Write/Edit/MultiEdit call touches.
export function targetPaths(input) {
  const ti = input.tool_input || {};
  return [ti.file_path, ti.notebook_path].filter(Boolean).map((p) => resolve(input.cwd || process.cwd(), p));
}

// Splits a path inside the workflows directory into { runId, rel } (rel uses "/"), or null.
export function locate(input, absPath) {
  const rel = relative(workflowsDir(input), absPath).split(sep);
  if (rel[0] === '..' || rel.length < 2) return null;
  return { runId: rel[0], rel: rel.slice(1).join('/') };
}

// Deterministic approval check: approval.json says approved AND records the hash of the current final plan.
export function approvalStatus(input, runId) {
  const dir = join(workflowsDir(input), runId);
  const approvalFile = join(dir, 'approval.json');
  const planFile = join(dir, 'artifacts', 'final-plan.md');
  if (!existsSync(approvalFile)) return { ok: false, reason: 'the plan has not been approved yet' };
  let approval;
  try {
    approval = JSON.parse(readFileSync(approvalFile, 'utf8'));
  } catch {
    return { ok: false, reason: 'approval record is unreadable' };
  }
  if (approval.decision !== 'approved') return { ok: false, reason: `last decision is "${approval.decision}"` };
  if (!existsSync(planFile)) return { ok: false, reason: 'the final plan does not exist' };
  if (sha256(readFileSync(planFile)) !== approval.final_plan_sha256) {
    return { ok: false, reason: 'the plan changed after it was approved; approval is void' };
  }
  return { ok: true };
}

// Provenance of an approval: the harness marks messages typed by the person with origin.kind === "human".
// The assistant cannot write such an entry, so "the last human message is the master's /garage-approve (or
// /garage-reject) command" is a fact about the transcript, not about what the model claims.
export function lastHumanMessage(input) {
  const path = input.transcript_path;
  if (!path || !existsSync(path)) return null;
  const lines = readFileSync(path, 'utf8').split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].trim()) continue;
    let e;
    try {
      e = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    if (e.type !== 'user' || e.isMeta || e.origin?.kind !== 'human') continue;
    const c = e.message?.content;
    if (typeof c === 'string') return c;
    if (Array.isArray(c)) return c.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  }
  return null;
}

export function masterIssuedCommand(input, commandName) {
  const text = lastHumanMessage(input);
  return typeof text === 'string' && text.includes(`<command-name>/${commandName}</command-name>`);
}
