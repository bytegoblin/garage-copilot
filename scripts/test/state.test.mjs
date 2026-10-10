// Tests for scripts/state.mjs through its CLI, against a throwaway workflows directory.
// Run: node --test scripts/test/
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'state.mjs');
let dir;
let env;

const run = (...args) => execFileSync('node', [SCRIPT, ...args], { env, encoding: 'utf8' }).trim();
const tryRun = (...args) => spawnSync('node', [SCRIPT, ...args], { env, encoding: 'utf8' });
const readState = (id) => JSON.parse(readFileSync(join(dir, id, 'workflow-state.json'), 'utf8'));
const nodeOf = (id, nodeId) => readState(id).plan.nodes.find((n) => n.id === nodeId);
const write = (id, rel, text) => writeFileSync(join(dir, id, rel), text);
const written = (id, rel) => run('artifact-written', join(dir, id, rel));

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'garage-state-'));
  env = { ...process.env, GARAGE_WORKFLOWS_DIR: dir };
});
after(() => rmSync(dir, { recursive: true, force: true }));

function newConfirmedRun(slug = 'tiles') {
  const id = run('init', slug);
  write(id, 'artifacts/requirements.md', '# R\n<!-- meta\nstatus: ready\nworkflow_type: project-plan\n-->\n');
  run('confirm-requirements', id);
  return id;
}

function tilesPlan(id) {
  const file = join(dir, id, 'plan.json');
  writeFileSync(file, JSON.stringify({
    nodes: [
      { id: 'diy-researcher', agent: 'diy-researcher', artifact: 'artifacts/research.md' },
      { id: 'project-planner', agent: 'project-planner', artifact: 'artifacts/project-plan.md', depends_on: ['diy-researcher'] },
      { id: 'product-researcher', agent: 'product-researcher', artifact: 'artifacts/products.md', depends_on: ['project-planner'] },
      { id: 'cost-planner', agent: 'cost-planner', artifact: 'artifacts/budget.md', depends_on: ['product-researcher'] },
    ],
  }));
  return file;
}

function pass(id, nodeId, rel) {
  run('start', id, nodeId);
  write(id, rel, `# ${nodeId}\n`);
  written(id, rel);
  run('stage-gate', id, nodeId, 'pass');
}

test('confirm-requirements refuses a requirements file that is not ready', () => {
  const id = run('init', 'refuse');
  write(id, 'artifacts/requirements.md', 'status: needs-answers\nworkflow_type: how-to\n');
  assert.notEqual(tryRun('confirm-requirements', id).status, 0);
});

test('ready releases nodes only after dependencies are validated (sequential chain)', () => {
  const id = newConfirmedRun();
  run('set-plan', id, tilesPlan(id));
  assert.match(run('ready', id), /^dispatch\tdiy-researcher\t/);
  assert.doesNotMatch(run('ready', id), /project-planner/);
  assert.notEqual(tryRun('start', id, 'project-planner').status, 0);

  pass(id, 'diy-researcher', 'artifacts/research.md');
  const out = run('ready', id);
  assert.match(out, /dispatch\tproject-planner/);
  assert.doesNotMatch(out, /product-researcher/);
});

test('independent nodes become ready together (parallel)', () => {
  const id = newConfirmedRun('parallel');
  const file = join(dir, id, 'plan.json');
  writeFileSync(file, JSON.stringify({
    nodes: [
      { id: 'product-researcher', agent: 'product-researcher', artifact: 'artifacts/products.md' },
      { id: 'diy-researcher', agent: 'diy-researcher', artifact: 'artifacts/research.md' },
      { id: 'cost-planner', agent: 'cost-planner', artifact: 'artifacts/budget.md', depends_on: ['product-researcher', 'diy-researcher'] },
    ],
  }));
  run('set-plan', id, file);
  const out = run('ready', id);
  assert.match(out, /dispatch\tproduct-researcher/);
  assert.match(out, /dispatch\tdiy-researcher/);
  assert.doesNotMatch(out, /cost-planner/);
});

test('failed gate retries only the affected node and invalidates downstream', () => {
  const id = newConfirmedRun('retry');
  run('set-plan', id, tilesPlan(id));
  pass(id, 'diy-researcher', 'artifacts/research.md');
  pass(id, 'project-planner', 'artifacts/project-plan.md');
  pass(id, 'product-researcher', 'artifacts/products.md');
  pass(id, 'cost-planner', 'artifacts/budget.md');
  assert.match(run('ready', id), /# COMPLETE/);

  run('fail', id, 'product-researcher', 'G1: price without source');
  assert.equal(nodeOf(id, 'product-researcher').status, 'stale');
  assert.equal(nodeOf(id, 'product-researcher').retries, 1);
  assert.equal(nodeOf(id, 'cost-planner').status, 'stale');
  assert.equal(nodeOf(id, 'cost-planner').retries, 0);
  assert.equal(nodeOf(id, 'diy-researcher').status, 'validated');
  assert.equal(nodeOf(id, 'project-planner').status, 'validated');
  assert.match(run('ready', id), /dispatch\tproduct-researcher/);
});

test('retry limit blocks the node and skips dependents', () => {
  const id = newConfirmedRun('limit');
  run('set-plan', id, tilesPlan(id));
  pass(id, 'diy-researcher', 'artifacts/research.md');
  pass(id, 'project-planner', 'artifacts/project-plan.md');
  for (let i = 0; i < 3; i++) {
    run('start', id, 'product-researcher');
    write(id, 'artifacts/products.md', `# attempt ${i}\n`);
    written(id, 'artifacts/products.md');
    run('stage-gate', id, 'product-researcher', 'fail', 'missing sources');
  }
  assert.equal(nodeOf(id, 'product-researcher').retries, 3);
  assert.equal(nodeOf(id, 'product-researcher').status, 'stale');

  run('start', id, 'product-researcher');
  write(id, 'artifacts/products.md', '# attempt 3\n');
  written(id, 'artifacts/products.md');
  run('stage-gate', id, 'product-researcher', 'fail', 'missing sources');
  assert.equal(nodeOf(id, 'product-researcher').status, 'blocked');
  assert.equal(nodeOf(id, 'cost-planner').status, 'skipped');
  assert.equal(readState(id).status, 'blocked');
  assert.match(run('ready', id), /# BLOCKED/);
  assert.notEqual(tryRun('start', id, 'cost-planner').status, 0);
});

test('modifying a validated artifact marks it and its dependents stale', () => {
  const id = newConfirmedRun('modified');
  run('set-plan', id, tilesPlan(id));
  pass(id, 'diy-researcher', 'artifacts/research.md');
  pass(id, 'project-planner', 'artifacts/project-plan.md');
  write(id, 'artifacts/research.md', '# edited by hand\n');
  written(id, 'artifacts/research.md');
  assert.equal(nodeOf(id, 'diy-researcher').status, 'stale');
  assert.equal(nodeOf(id, 'project-planner').status, 'stale');
});

test('stage-gate pass is refused when the file changed after artifact-written', () => {
  const id = newConfirmedRun('hashcheck');
  run('set-plan', id, tilesPlan(id));
  run('start', id, 'diy-researcher');
  write(id, 'artifacts/research.md', '# v1\n');
  written(id, 'artifacts/research.md');
  write(id, 'artifacts/research.md', '# v2\n');
  assert.notEqual(tryRun('stage-gate', id, 'diy-researcher', 'pass').status, 0);
});

test('approval-gated node is not ready before approval', () => {
  const id = newConfirmedRun('gated');
  const file = join(dir, id, 'plan.json');
  writeFileSync(file, JSON.stringify({
    nodes: [
      { id: 'diy-researcher', agent: 'diy-researcher', artifact: 'artifacts/research.md' },
      { id: 'final-output-builder', agent: 'final-output-builder', artifact: 'output/garage-plan.html', depends_on: ['diy-researcher'], gate: 'approval' },
    ],
  }));
  run('set-plan', id, file);
  pass(id, 'diy-researcher', 'artifacts/research.md');
  assert.match(run('ready', id), /# WAITING_APPROVAL/);
  assert.notEqual(tryRun('start', id, 'final-output-builder').status, 0);
});

test('set-plan rejects cycles, unknown agents and duplicate artifacts', () => {
  const id = newConfirmedRun('invalid');
  const bad = (nodes) => {
    const file = join(dir, id, 'bad.json');
    writeFileSync(file, JSON.stringify({ nodes }));
    return tryRun('set-plan', id, file).status;
  };
  assert.notEqual(bad([
    { id: 'a', agent: 'diy-researcher', artifact: 'artifacts/a.md', depends_on: ['b'] },
    { id: 'b', agent: 'project-planner', artifact: 'artifacts/b.md', depends_on: ['a'] },
  ]), 0);
  assert.notEqual(bad([{ id: 'a', agent: 'wizard', artifact: 'artifacts/a.md' }]), 0);
  assert.notEqual(bad([
    { id: 'a', agent: 'diy-researcher', artifact: 'artifacts/a.md' },
    { id: 'b', agent: 'project-planner', artifact: 'artifacts/a.md' },
  ]), 0);
});

test('changing requirements after confirmation invalidates the plan', () => {
  const id = newConfirmedRun('reqchange');
  run('set-plan', id, tilesPlan(id));
  pass(id, 'diy-researcher', 'artifacts/research.md');
  write(id, 'artifacts/requirements.md', '# R changed\n<!-- meta\nstatus: ready\nworkflow_type: project-plan\n-->\n');
  written(id, 'artifacts/requirements.md');
  const s = readState(id);
  assert.equal(s.requirements.confirmed, false);
  assert.equal(s.status, 'requirements');
  assert.equal(nodeOf(id, 'diy-researcher').status, 'stale');
  run('confirm-requirements', id);
  assert.equal(nodeOf(id, 'requirements-formalizer').status, 'validated');
});

test('unblock resets a blocked node and its skipped dependents', () => {
  const id = newConfirmedRun('unblock');
  run('set-plan', id, tilesPlan(id));
  pass(id, 'diy-researcher', 'artifacts/research.md');
  for (let i = 0; i < 4; i++) {
    run('start', id, 'project-planner');
    write(id, 'artifacts/project-plan.md', `# ${i}\n`);
    written(id, 'artifacts/project-plan.md');
    run('stage-gate', id, 'project-planner', 'fail', 'x');
  }
  assert.equal(nodeOf(id, 'project-planner').status, 'blocked');
  run('unblock', id, 'project-planner');
  assert.equal(nodeOf(id, 'project-planner').status, 'stale');
  assert.equal(nodeOf(id, 'project-planner').retries, 0);
  assert.equal(nodeOf(id, 'cost-planner').status, 'pending');
  assert.equal(readState(id).status, 'executing');
});

test('verify marks edited or missing validated artifacts and their dependents stale', () => {
  const id = newConfirmedRun('verify');
  run('set-plan', id, tilesPlan(id));
  pass(id, 'diy-researcher', 'artifacts/research.md');
  pass(id, 'project-planner', 'artifacts/project-plan.md');
  assert.match(run('verify', id), /intact/);

  write(id, 'artifacts/research.md', '# edited while the session was closed\n');
  assert.match(run('verify', id), /updated -> diy-researcher, project-planner/);
  assert.equal(nodeOf(id, 'diy-researcher').status, 'stale');
  assert.equal(nodeOf(id, 'project-planner').status, 'stale');
});

test('ready reports last_error so a retry can quote the findings', () => {
  const id = newConfirmedRun('feedback');
  run('set-plan', id, tilesPlan(id));
  run('start', id, 'diy-researcher');
  write(id, 'artifacts/research.md', '# v1\n');
  written(id, 'artifacts/research.md');
  run('stage-gate', id, 'diy-researcher', 'fail', 'missing', 'sources');
  assert.match(run('ready', id), /dispatch\tdiy-researcher\t.*attempt=2\tmissing sources/);
});

test('reset-plan keeps requirements, moves artifacts aside and allows a new plan', () => {
  const id = newConfirmedRun('reset');
  run('set-plan', id, tilesPlan(id));
  pass(id, 'diy-researcher', 'artifacts/research.md');
  assert.match(run('reset-plan', id), /moved aside: research.md/);
  assert.equal(readState(id).plan.nodes.length, 1);
  assert.equal(readState(id).status, 'planning');
  run('set-plan', id, tilesPlan(id));
  assert.equal(nodeOf(id, 'diy-researcher').status, 'pending');
});

test('verify turns an interrupted running node into stale (no artifact) or created (artifact on disk)', () => {
  const id = newConfirmedRun('interrupted');
  run('set-plan', id, tilesPlan(id));
  run('start', id, 'diy-researcher');
  assert.match(run('verify', id), /updated -> diy-researcher/);
  assert.equal(nodeOf(id, 'diy-researcher').status, 'stale');
  assert.match(nodeOf(id, 'diy-researcher').last_error, /interrupted/);

  run('start', id, 'diy-researcher');
  write(id, 'artifacts/research.md', '# written before the crash\n');
  run('verify', id);
  assert.equal(nodeOf(id, 'diy-researcher').status, 'created');
  run('stage-gate', id, 'diy-researcher', 'pass');
  assert.equal(nodeOf(id, 'diy-researcher').status, 'validated');
});

function validationDoc(rows) {
  const head = '| Гейт | Статус | Артефакт | Узел | Замечание | Как исправить |\n|---|---|---|---|---|---|\n';
  return `# Валидация\n\n## Результаты гейтов\n${head}${rows.join('\n')}\n`;
}
const PASS_ROWS = ['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7'].map((g) => `| ${g} | PASS | — | — | ok | — |`);

function validatorRun(slug) {
  const id = newConfirmedRun(slug);
  const file = join(dir, id, 'plan.json');
  writeFileSync(file, JSON.stringify({
    nodes: [
      { id: 'diy-researcher', agent: 'diy-researcher', artifact: 'artifacts/research.md' },
      { id: 'product-researcher', agent: 'product-researcher', artifact: 'artifacts/products.md', depends_on: ['diy-researcher'] },
      { id: 'cost-planner', agent: 'cost-planner', artifact: 'artifacts/budget.md', depends_on: ['product-researcher'] },
      { id: 'evidence-validator', agent: 'evidence-validator', artifact: 'artifacts/validation.md', depends_on: ['cost-planner'] },
    ],
  }));
  run('set-plan', id, file);
  pass(id, 'diy-researcher', 'artifacts/research.md');
  pass(id, 'product-researcher', 'artifacts/products.md');
  pass(id, 'cost-planner', 'artifacts/budget.md');
  return id;
}

function validate(id, rows) {
  run('start', id, 'evidence-validator');
  write(id, 'artifacts/validation.md', validationDoc(rows));
  written(id, 'artifacts/validation.md');
  run('stage-gate', id, 'evidence-validator', 'pass');
}

test('domain gates PASS completes the run only after they were applied', () => {
  const id = validatorRun('dg-pass');
  validate(id, PASS_ROWS);
  const before = run('ready', id);
  assert.match(before, /domain-gates\tevidence-validator/);
  assert.doesNotMatch(before, /# COMPLETE/);
  assert.match(run('domain-gates', id), /PASS/);
  assert.match(run('ready', id), /# COMPLETE/);
});

test('domain gate FAIL maps to the owner node, invalidates downstream and re-validation', () => {
  const id = validatorRun('dg-fail');
  const rows = PASS_ROWS.map((r) => r);
  rows[0] = '| G1 | FAIL | products.md | product-researcher | price without date | add date |';
  validate(id, rows);
  const out = run('domain-gates', id);
  assert.match(out, /FAIL/);
  assert.match(out, /product-researcher: retry 1\/3/);
  assert.equal(nodeOf(id, 'diy-researcher').status, 'validated');
  assert.equal(nodeOf(id, 'product-researcher').status, 'stale');
  assert.equal(nodeOf(id, 'cost-planner').status, 'stale');
  assert.equal(nodeOf(id, 'evidence-validator').status, 'stale');
  assert.match(nodeOf(id, 'product-researcher').last_error, /\[G1\] price without date \| fix: add date/);
  assert.match(run('ready', id), /dispatch\tproduct-researcher\t.*\[G1\]/);
});

test('domain gate FAIL on the requirements node is reported to the master, not retried', () => {
  const id = validatorRun('dg-ask');
  const rows = PASS_ROWS.map((r) => r);
  rows[5] = '| G6 | FAIL | requirements.md | requirements-formalizer | R3 is contradictory | ask the master |';
  validate(id, rows);
  assert.match(run('domain-gates', id), /ASK_MASTER\trequirements-formalizer/);
  assert.equal(nodeOf(id, 'requirements-formalizer').status, 'validated');
});

test('domain gate retries are bounded by the owner retry limit', () => {
  const id = validatorRun('dg-limit');
  for (let i = 0; i < 4; i++) {
    const rows = PASS_ROWS.map((r) => r);
    rows[1] = `| G2 | FAIL | budget.md | cost-planner | sum wrong ${i} | recompute |`;
    if (i > 0) {
      pass(id, 'cost-planner', 'artifacts/budget.md');
    }
    validate(id, rows);
    run('domain-gates', id);
  }
  assert.equal(nodeOf(id, 'cost-planner').status, 'blocked');
  assert.equal(nodeOf(id, 'evidence-validator').status, 'skipped');
  assert.match(run('ready', id), /# BLOCKED/);
});

test('add-nodes appends a validator to a plan that is already executing', () => {
  const id = newConfirmedRun('addnodes');
  run('set-plan', id, tilesPlan(id));
  pass(id, 'diy-researcher', 'artifacts/research.md');
  const file = join(dir, id, 'extra.json');
  writeFileSync(file, JSON.stringify({ nodes: [
    { id: 'evidence-validator', agent: 'evidence-validator', artifact: 'artifacts/validation.md', depends_on: ['cost-planner'] },
  ] }));
  assert.match(run('add-nodes', id, file), /added evidence-validator/);
  assert.equal(nodeOf(id, 'diy-researcher').status, 'validated');
  assert.equal(nodeOf(id, 'evidence-validator').status, 'pending');
  assert.notEqual(tryRun('add-nodes', id, file).status, 0);
  writeFileSync(file, JSON.stringify({ nodes: [{ id: 'x', agent: 'synthesizer', artifact: 'artifacts/final-plan.md', depends_on: ['ghost'] }] }));
  assert.notEqual(tryRun('add-nodes', id, file).status, 0);
});

test('verify does not accept an artifact left by an earlier attempt as the interrupted result', () => {
  const id = newConfirmedRun('stalefile');
  run('set-plan', id, tilesPlan(id));
  pass(id, 'diy-researcher', 'artifacts/research.md');
  run('fail', id, 'diy-researcher', 'G6: missing criterion');
  // The old research.md is still on disk. The node is started again and the session dies before it writes.
  const old = new Date(Date.now() - 60_000);
  utimesSync(join(dir, id, 'artifacts', 'research.md'), old, old);
  run('start', id, 'diy-researcher');
  assert.match(run('verify', id), /updated -> diy-researcher/);
  assert.equal(nodeOf(id, 'diy-researcher').status, 'stale');
  assert.match(nodeOf(id, 'diy-researcher').last_error, /interrupted/);
});
