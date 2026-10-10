// PreToolUse (Write|Edit|MultiEdit|Bash): protects two invariants.
//  1. Nothing is written to workflows/<run>/output/ unless the current final plan is approved (hash-checked).
//  2. workflow-state.json and approval.json are never written by the model, only by scripts/state.mjs and
//     scripts/approve.mjs.
// The Bash inspection is a best-effort heuristic (a command that writes through an interpreter in a way it
// cannot see is not caught); the Write/Edit checks and the hash verification are exact.
import { readInput, block, targetPaths, locate, approvalStatus } from './lib/common.mjs';

const input = readInput();
const tool = input.tool_name;
const PROTECTED = /(workflow-state\.json|approval\.json)/;
const OUTPUT = /workflows\/([0-9]{8}-[0-9]{4}-[a-z0-9-]+)\/output\b/;
const WRITE_VERB = /(?<![=<>-])>>?|\btee\b|\bsed\s+(-[a-z]*i|--in-place)\b|\bmv\b|\bcp\b|\brm\b|\btruncate\b|\bdd\b|\bpython3?\b|\bnode\s+-e\b|\bperl\b|\bawk\b|\binstall\b|\bgit\s+(checkout|restore)\b/g;
const SCRIPT_OK = /^\s*node\s+(\.\/)?scripts\/(state|approve)\.mjs\b/;

// Remove heredoc bodies so that file contents mentioning protected names are not mistaken for targets.
function stripHeredocs(cmd) {
  return cmd.replace(/<<-?\s*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?\n[ \t]*\2[ \t]*(?=\n|$)/g, (m) => m.split('\n')[0]);
}

// True when a write verb occurs before the given pattern inside one simple command.
function writesTo(segment, pattern) {
  const target = segment.match(pattern);
  if (!target) return null;
  for (const v of segment.matchAll(WRITE_VERB)) {
    if (v.index < target.index) return target;
  }
  return null;
}

if (['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(tool)) {
  for (const p of targetPaths(input)) {
    const loc = locate(input, p);
    if (!loc) continue;
    if (PROTECTED.test(loc.rel) && !loc.rel.includes('/')) {
      block(`Blocked: ${loc.rel} is written only by the workflow scripts, never edited directly.`);
    }
    if (loc.rel.startsWith('output/')) {
      const a = approvalStatus(input, loc.runId);
      if (!a.ok) block(`Blocked: final output cannot be written - ${a.reason}. The master must approve the current plan first.`);
    }
  }
} else if (tool === 'Bash') {
  const segments = stripHeredocs(String(input.tool_input?.command || '')).split(/\n|;|&&|\|\|/);
  for (const segment of segments) {
    if (SCRIPT_OK.test(segment)) continue;
    if (writesTo(segment, PROTECTED)) {
      block('Blocked: workflow state and approval files are written only by the workflow scripts.');
    }
    const out = writesTo(segment, OUTPUT);
    if (out) {
      const a = approvalStatus(input, out[1]);
      if (!a.ok) block(`Blocked: final output cannot be written - ${a.reason}.`);
    }
  }
}
process.exit(0);
