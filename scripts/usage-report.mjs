#!/usr/bin/env node
// Development aid: token usage per agent for one or more Claude Code sessions of this project.
// Usage: node scripts/usage-report.mjs <session-id> [<session-id> ...]
// Reads the transcripts Claude Code keeps under ~/.claude/projects/<project>/ (override with CLAUDE_PROJECTS_DIR).
// Calls are de-duplicated by API message id, so a resumed session that replays an earlier conversation is not
// counted twice. "input" includes cache reads and cache creation.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const base = process.env.CLAUDE_PROJECTS_DIR
  || join(homedir(), '.claude', 'projects', ROOT.replace(/[^A-Za-z0-9]/g, '-'));
const sessions = process.argv.slice(2);
if (sessions.length === 0) {
  console.error('usage: usage-report.mjs <session-id> [<session-id> ...]');
  process.exit(2);
}

const calls = new Map(); // message id -> { agent, model, input, output, ts }

function addTranscript(file, agent) {
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let d;
    try {
      d = JSON.parse(line);
    } catch {
      continue;
    }
    if (d.type !== 'assistant') continue;
    const m = d.message || {};
    const u = m.usage || {};
    const id = m.id || d.uuid;
    const input = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
    const output = u.output_tokens || 0;
    const prev = calls.get(id);
    if (prev) {
      prev.input = Math.max(prev.input, input);
      prev.output = Math.max(prev.output, output);
    } else {
      calls.set(id, { agent, model: m.model || '?', input, output, ts: d.timestamp || '' });
    }
  }
}

for (const sid of sessions) {
  const main = join(base, `${sid}.jsonl`);
  if (!existsSync(main)) {
    console.error(`session not found: ${main}`);
    process.exit(1);
  }
  addTranscript(main, '(coordinator)');
  const subDir = join(base, sid, 'subagents');
  if (existsSync(subDir)) {
    for (const f of readdirSync(subDir).filter((n) => n.endsWith('.meta.json'))) {
      const meta = JSON.parse(readFileSync(join(subDir, f), 'utf8'));
      addTranscript(join(subDir, f.replace(/\.meta\.json$/, '.jsonl')), meta.agentType || '?');
    }
  }
}

const agg = new Map();
let first = '';
let last = '';
for (const c of calls.values()) {
  if (c.ts && (!first || c.ts < first)) first = c.ts;
  if (c.ts && c.ts > last) last = c.ts;
  const a = agg.get(c.agent) || { calls: 0, input: 0, output: 0, models: {} };
  a.calls += 1;
  a.input += c.input;
  a.output += c.output;
  a.models[c.model] = (a.models[c.model] || 0) + 1;
  agg.set(c.agent, a);
}

const rows = [...agg.entries()].sort((x, y) => y[1].input - x[1].input);
const total = rows.reduce((t, [, a]) => ({ calls: t.calls + a.calls, input: t.input + a.input, output: t.output + a.output }), { calls: 0, input: 0, output: 0 });
const pad = (v, n) => String(v).padStart(n);
console.log(`span: ${first.slice(0, 19)} -> ${last.slice(0, 19)}`);
console.log(`${'agent'.padEnd(26)}${pad('calls', 7)}${pad('input', 13)}${pad('share', 7)}${pad('output', 10)}${pad('avg ctx', 10)}  models`);
for (const [agent, a] of rows) {
  const models = Object.entries(a.models).map(([m, n]) => `${m.replace('claude-', '')}×${n}`).join(' ');
  console.log(`${agent.padEnd(26)}${pad(a.calls, 7)}${pad(a.input, 13)}${pad(`${Math.round((100 * a.input) / total.input)}%`, 7)}${pad(a.output, 10)}${pad(Math.round(a.input / a.calls), 10)}  ${models}`);
}
console.log(`${'TOTAL'.padEnd(26)}${pad(total.calls, 7)}${pad(total.input, 13)}${pad('', 7)}${pad(total.output, 10)}`);
