// PreToolUse (Write|Edit|MultiEdit): text meant for the master (final plan, final output) must not contain
// internal names: artifact filenames, agent names, state files, run paths.
import { readInput, block, targetPaths, locate } from './lib/common.mjs';

const input = readInput();
const LEAKS = [
  /\b(requirements|research(-[a-z0-9-]+)?|products(-[a-z0-9-]+)?|project-plan|budget|validation|final-plan|qa-log|request|plan)\.(md|json)\b/i,
  /\bworkflow-state\b/i,
  /\bapproval\.json\b/i,
  /\bworkflows\//,
  /\.claude\//,
  /\b(requirements-formalizer|diy-researcher|product-researcher|project-planner|cost-planner|evidence-validator|synthesizer|final-output-builder)\b/i,
  /\b[0-9]{8}-[0-9]{4}-[a-z0-9-]+\b/,
];

function newText() {
  const ti = input.tool_input || {};
  if (typeof ti.content === 'string') return ti.content;
  if (typeof ti.new_string === 'string') return ti.new_string;
  if (Array.isArray(ti.edits)) return ti.edits.map((e) => e.new_string || '').join('\n');
  return '';
}

for (const p of targetPaths(input)) {
  const loc = locate(input, p);
  if (!loc) continue;
  const userFacing = loc.rel === 'artifacts/final-plan.md' || loc.rel.startsWith('output/');
  if (!userFacing) continue;
  const text = newText().replace(/<!--\s*meta[\s\S]*?-->/g, '');
  const found = [];
  for (const re of LEAKS) {
    const m = text.match(re);
    if (m) found.push(m[0]);
  }
  if (found.length) {
    block(`Blocked: user-facing text contains internal names (${[...new Set(found)].join(', ')}). `
      + 'Rewrite it so that the master never sees file names, agent names or run identifiers.');
  }
}
process.exit(0);
