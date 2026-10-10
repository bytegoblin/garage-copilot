// PostToolUse (Write|Edit|MultiEdit): whenever a workflow artifact is written, record it in the run state.
// Never blocks: the write already happened; state.mjs is idempotent.
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { readInput, targetPaths, locate, projectRoot } from './lib/common.mjs';

const input = readInput();
for (const p of targetPaths(input)) {
  const loc = locate(input, p);
  if (!loc || !/^artifacts\/[a-z0-9-]+\.md$/.test(loc.rel)) continue;
  const r = spawnSync('node', [join(projectRoot(input), 'scripts', 'state.mjs'), 'artifact-written', p], {
    encoding: 'utf8',
    env: process.env,
  });
  if (r.status !== 0) process.stderr.write(`post-write-state: ${r.stderr || r.stdout}\n`);
}
process.exit(0);
