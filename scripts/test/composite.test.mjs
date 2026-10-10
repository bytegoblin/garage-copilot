// Tests for the composite commands finish-node and start-ready (run through the CLI).
// Run: node --test scripts/test/composite.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const STATE = join(ROOT, 'scripts', 'state.mjs');
const TEMPLATES = join(ROOT, '.claude', 'skills', 'artifact-validator', 'templates');
let wf;
let env;

const run = (...a) => spawnSync('node', [STATE, ...a], { env, encoding: 'utf8' });
const ok = (...a) => {
  const r = run(...a);
  assert.equal(r.status, 0, r.stderr || r.stdout);
  return r.stdout.trim();
};
const readState = (id) => JSON.parse(readFileSync(join(wf, id, 'workflow-state.json'), 'utf8'));
const nodeOf = (id, n) => readState(id).plan.nodes.find((x) => x.id === n);
const headings = (t) => [...readFileSync(join(TEMPLATES, `${t}.md`), 'utf8').matchAll(/^##\s+(.+?)\s*$/gm)].map((m) => m[1]);

// A structurally valid artifact built from the template headings.
function artifact(type, owner, runId, extra = {}) {
  const title = { research: 'Исследование', products: 'Продукты', 'project-plan': 'План', budget: 'Бюджет' }[type];
  const body = headings(type).map((h) => {
    if (h === 'Покрытие требований') return `## ${h}\n| Требование | Где отражено | Статус |\n|---|---|---|\n| R1 | Раздел выше | ok |\n`;
    if (h === 'Источники') return `## ${h}\n1. Производитель — https://example.pl/karta (дата обращения: 2026-10-10)\n`;
    if (h === 'Кандидаты') return `## ${h}\n| Позиция | Модель | Параметры | Магазин | Цена | Ссылка | Дата цены |\n|---|---|---|---|---|---|---|\n| Клей | X | C2 | Castorama | 40 PLN | https://example.pl/k | 2026-10-10 |\n`;
    return `## ${h}\nТекст.\n`;
  }).join('\n');
  return `# ${title}\n\n<!-- meta\nartifact: ${type}\nowner: ${owner}\nrun: ${runId}\nversion: 1\n-->\n\n${body}${extra.tail || ''}`;
}

function newRun(slug) {
  const id = ok('init', slug);
  writeFileSync(join(wf, id, 'artifacts', 'requirements.md'),
    '# R\n<!-- meta\nstatus: ready\nworkflow_type: project-plan\n-->\n| ID | Требование | Приоритет |\n|---|---|---|\n| R1 | Что-то | must |\n');
  ok('confirm-requirements', id);
  return id;
}
function setPlan(id, nodes) {
  const f = join(wf, id, 'plan.json');
  writeFileSync(f, JSON.stringify({ nodes }));
  ok('set-plan', id, f);
}

before(() => {
  wf = mkdtempSync(join(tmpdir(), 'garage-composite-'));
  env = { ...process.env, GARAGE_WORKFLOWS_DIR: wf };
});
after(() => rmSync(wf, { recursive: true, force: true }));

const CHAIN = [
  { id: 'diy-researcher', agent: 'diy-researcher', artifact: 'artifacts/research.md' },
  { id: 'project-planner', agent: 'project-planner', artifact: 'artifacts/project-plan.md', depends_on: ['diy-researcher'] },
];

test('start-ready starts every ready node and reports them as started', () => {
  const id = newRun('startready');
  setPlan(id, [
    { id: 'diy-researcher', agent: 'diy-researcher', artifact: 'artifacts/research.md' },
    { id: 'product-researcher', agent: 'product-researcher', artifact: 'artifacts/products.md' },
    { id: 'cost-planner', agent: 'cost-planner', artifact: 'artifacts/budget.md', depends_on: ['diy-researcher', 'product-researcher'] },
  ]);
  const out = ok('start-ready', id);
  assert.match(out, /started\tdiy-researcher\t/);
  assert.match(out, /started\tproduct-researcher\t/);
  assert.doesNotMatch(out, /cost-planner/);
  assert.equal(nodeOf(id, 'diy-researcher').status, 'running');
  assert.equal(nodeOf(id, 'product-researcher').status, 'running');
  // Calling it again must not start anything twice.
  assert.doesNotMatch(ok('start-ready', id), /^started/m);
  assert.equal(nodeOf(id, 'diy-researcher').attempts, 1);
});

test('finish-node: a valid artifact is recorded, checked, gated and the next node is started', () => {
  const id = newRun('finishok');
  setPlan(id, CHAIN);
  ok('start-ready', id);
  writeFileSync(join(wf, id, 'artifacts', 'research.md'), artifact('research', 'diy-researcher', id));
  const out = ok('finish-node', id, 'diy-researcher');
  assert.match(out, /\[G0\] PASS/);
  assert.match(out, /diy-researcher: validated/);
  assert.match(out, /--- next[\s\S]*started\tproject-planner\t/);
  assert.equal(nodeOf(id, 'diy-researcher').status, 'validated');
  assert.equal(nodeOf(id, 'project-planner').status, 'running');
});

test('finish-node: a structural defect fails the gate, counts a retry and re-offers the node with findings', () => {
  const id = newRun('finishfail');
  setPlan(id, CHAIN);
  ok('start-ready', id);
  writeFileSync(join(wf, id, 'artifacts', 'research.md'), artifact('research', 'diy-researcher', id).replace('## Безопасность\nТекст.\n', ''));
  const out = ok('finish-node', id, 'diy-researcher');
  assert.match(out, /\[G0\] FAIL/);
  assert.match(out, /missing sections: Безопасность/);
  assert.match(out, /retry 1\/3/);
  assert.match(out, /--- next[\s\S]*started\tdiy-researcher\t[^\n]*attempt=2[^\n]*missing sections/);
  assert.equal(nodeOf(id, 'diy-researcher').retries, 1);
});

test('finish-node: a missing file and a BLOCKED reply are both gate failures', () => {
  const id = newRun('finishmissing');
  setPlan(id, CHAIN);
  ok('start-ready', id);
  let out = ok('finish-node', id, 'diy-researcher');
  assert.match(out, /was not written/);
  assert.equal(nodeOf(id, 'diy-researcher').retries, 1);

  out = ok('finish-node', id, 'diy-researcher', '--blocked', 'no access to sources');
  assert.match(out, /agent reported BLOCKED: no access to sources/);
  assert.equal(nodeOf(id, 'diy-researcher').retries, 2);
});

test('finish-node on the validator applies the domain gates in the same call', () => {
  const id = newRun('finishvalidator');
  setPlan(id, [
    { id: 'diy-researcher', agent: 'diy-researcher', artifact: 'artifacts/research.md' },
    { id: 'evidence-validator', agent: 'evidence-validator', artifact: 'artifacts/validation.md', depends_on: ['diy-researcher'] },
    { id: 'synthesizer', agent: 'synthesizer', artifact: 'artifacts/final-plan.md', depends_on: ['evidence-validator'] },
  ]);
  ok('start-ready', id);
  writeFileSync(join(wf, id, 'artifacts', 'research.md'), artifact('research', 'diy-researcher', id));
  ok('finish-node', id, 'diy-researcher');

  const rows = ['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7'].map((g) => `| ${g} | PASS | — | — | проверено | — |`).join('\n');
  writeFileSync(join(wf, id, 'artifacts', 'validation.md'),
    `# Валидация\n\n<!-- meta\nartifact: validation\nowner: evidence-validator\nrun: ${id}\nversion: 1\nresult: PASS\n-->\n\n## Кратко\nВсё в порядке.\n\n## Результаты гейтов\n| Гейт | Статус | Артефакт | Узел | Замечание | Как исправить |\n|---|---|---|---|---|---|\n${rows}\n\n## Итог\nPASS.\n\n## Допущения и неопределённости\nНет.\n`);
  const out = ok('finish-node', id, 'evidence-validator');
  assert.match(out, /domain gates: PASS/);
  assert.match(out, /--- next[\s\S]*started\tsynthesizer\t/);
  assert.equal(nodeOf(id, 'synthesizer').status, 'running');
});
