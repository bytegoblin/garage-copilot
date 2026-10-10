// PreToolUse (Write|Edit|MultiEdit): text meant for the master (final plan, final output) must not contain
// internal names: artifact filenames, agent names, state files, run paths.
import { readInput, block, targetPaths, locate } from './lib/common.mjs';
import { findLeaks } from './lib/leaks.mjs';

const input = readInput();

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
  const found = findLeaks(newText());
  if (found.length) {
    block(`Blocked: user-facing text contains internal names (${found.join(', ')}). `
      + 'Rewrite it so that the master never sees file names, agent names or run identifiers.');
  }
}
process.exit(0);
