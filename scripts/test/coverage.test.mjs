// Tests for the rules added after the clean-clone run of 2026-10-11: depth chosen by the script, the previous
// artifact kept as a baseline (no loss of prices), the price-coverage gate and the shopping-list table.
// Run: node --test scripts/test/coverage.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { budgetCoverage, productsPriced, hasPrice } from '../lib/price-table.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const STATE = join(ROOT, 'scripts', 'state.mjs');
const CHECK = join(ROOT, 'scripts', 'check-artifact.mjs');
const TEMPLATES = join(ROOT, '.claude', 'skills', 'artifact-validator', 'templates');
const CONFIG = JSON.parse(readFileSync(join(ROOT, 'config', 'workflow.json'), 'utf8'));
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
const write = (id, rel, text) => {
  mkdirSync(dirname(join(wf, id, rel)), { recursive: true });
  writeFileSync(join(wf, id, rel), text);
};
const headings = (t) => [...readFileSync(join(TEMPLATES, `${t}.md`), 'utf8').matchAll(/^##\s+(.+?)\s*$/gm)].map((m) => m[1]);

const PRODUCT_HEAD = '| Позиция | Модель | Параметры | Магазин | Цена | Ссылка | Дата цены |\n|---|---|---|---|---|---|---|\n';
const priced = (n) => `| Позиция ${n} | M${n} | p | Castorama | ${10 * n},00 PLN | https://example.pl/${n} | 2026-10-10 |\n`;
const unpriced = (n) => `| Позиция ${n} | M${n} | p | магазин | не найдена | https://example.pl/${n} | 2026-10-10 |\n`;

function productsDoc(runId, rows, assumptions = 'Текст.') {
  const body = headings('products').map((h) => {
    if (h === 'Кандидаты') return `## ${h}\n${PRODUCT_HEAD}${rows.join('')}`;
    if (h === 'Покрытие требований') return `## ${h}\n| Требование | Где отражено | Статус |\n|---|---|---|\n| R1 | Кандидаты | ok |\n`;
    if (h === 'Допущения и неопределённости') return `## ${h}\n${assumptions}\n`;
    if (h === 'Источники') return `## ${h}\n1. Магазин — https://example.pl/1 (дата обращения: 2026-10-10)\n`;
    return `## ${h}\nТекст.\n`;
  }).join('\n');
  return `# Продукты\n\n<!-- meta\nartifact: products\nowner: product-researcher\nrun: ${runId}\nversion: 1\n-->\n\n${body}`;
}

const BUDGET_HEAD = '| Позиция | Кол-во | Магазин 1 | Цена 1 | Магазин 2 | Цена 2 | Средняя | Ссылка | Дата цены |\n|---|---|---|---|---|---|---|---|---|\n';
const bPriced = (n) => `| Позиция ${n} | 1 | Castorama | ${n}0,00 PLN | нет | нет | ${n}0,00 PLN | https://example.pl/${n} | 2026-10-10 |\n`;
const bUnpriced = (n) => `| Позиция ${n} | 1 | нет | нет | нет | нет | нет цены | нет | нет |\n`;

function budgetDoc(runId, rows) {
  const body = headings('budget').map((h) => {
    if (h === 'Список покупок') return `## ${h}\n${BUDGET_HEAD}${rows.join('')}`;
    if (h === 'Покрытие требований') return `## ${h}\n| Требование | Где отражено | Статус |\n|---|---|---|\n| R1 | Список | ok |\n`;
    return `## ${h}\nТекст.\n`;
  }).join('\n');
  return `# Бюджет\n\n<!-- meta\nartifact: budget\nowner: cost-planner\nrun: ${runId}\nversion: 1\n-->\n\n${body}`;
}

before(() => {
  wf = mkdtempSync(join(tmpdir(), 'garage-coverage-'));
  env = { ...process.env, GARAGE_WORKFLOWS_DIR: wf };
});
after(() => rmSync(wf, { recursive: true, force: true }));

function newRun(slug, nodes) {
  const id = ok('init', slug);
  write(id, 'artifacts/requirements.md', '# R\n<!-- meta\nstatus: ready\nworkflow_type: project-plan\n-->\n| ID | Требование | Приоритет |\n|---|---|---|\n| R1 | Что-то | must |\n');
  ok('confirm-requirements', id);
  const f = join(wf, id, 'plan.json');
  writeFileSync(f, JSON.stringify({ nodes }));
  ok('set-plan', id, f);
  return id;
}

const finish = (id, node, doc) => {
  write(id, nodeOf(id, node).artifact, doc);
  return ok('finish-node', id, node);
};

// ---------- price tables ----------

test('price table reading: priced rows are counted, unpriced and owned positions are not', () => {
  assert.equal(hasPrice('105,00 PLN'), true);
  assert.equal(hasPrice('ориентировочно 327,87 PLN'), true);
  assert.equal(hasPrice('не найдена'), false);
  assert.equal(hasPrice('цена после входа 2'), false);
  assert.equal(hasPrice('нет цены'), false);
  const md = `## Кандидаты\n${PRODUCT_HEAD}${priced(1)}${unpriced(2)}${priced(3)}`;
  assert.deepEqual(productsPriced(md), { total: 3, priced: 2 });
  const b = `## Список покупок\n${BUDGET_HEAD}${bPriced(1)}${bUnpriced(2)}| Пылесос, уже есть | 1 | — | — | — | — | — | — | — |\n`;
  const c = budgetCoverage(b);
  assert.equal(c.total, 2);
  assert.equal(c.priced, 1);
  assert.deepEqual(c.unpriced, ['Позиция 2']);
});

test('budget G0: unpriced positions may be rows without URL, a priced row still needs URL and date', () => {
  const id = newRun('g0-budget', [{ id: 'cost-planner', agent: 'cost-planner', artifact: 'artifacts/budget.md' }]);
  write(id, 'artifacts/budget.md', budgetDoc(id, [bPriced(1), bUnpriced(2)]));
  let r = spawnSync('node', [CHECK, join(wf, id, 'artifacts/budget.md')], { encoding: 'utf8' });
  assert.match(r.stdout, /^PASS/);
  assert.match(r.stdout, /price coverage: 1 of 2/);

  write(id, 'artifacts/budget.md', budgetDoc(id, ['| Позиция 3 | 1 | Castorama | 30,00 PLN | нет | нет | 30,00 PLN | нет | нет |\n']));
  r = spawnSync('node', [CHECK, join(wf, id, 'artifacts/budget.md')], { encoding: 'utf8' });
  assert.match(r.stdout, /no source URL/);
  assert.match(r.stdout, /no price date/);

  write(id, 'artifacts/budget.md', budgetDoc(id, []));
  r = spawnSync('node', [CHECK, join(wf, id, 'artifacts/budget.md')], { encoding: 'utf8' });
  assert.match(r.stdout, /no position rows/);
});

// ---------- depth decided by the script ----------

const PRODUCT_PLAN = [
  { id: 'diy-researcher', agent: 'diy-researcher', artifact: 'artifacts/research.md', depth: 'quick' },
  { id: 'product-researcher-materials', agent: 'product-researcher', artifact: 'artifacts/products-materials.md', depth: 'standard', depends_on: ['diy-researcher'] },
  { id: 'cost-planner', agent: 'cost-planner', artifact: 'artifacts/budget.md', depends_on: ['product-researcher-materials'] },
];

test('depth: the first run takes the node level; the script prints it with the numbers from the config', () => {
  const id = newRun('depth-first', PRODUCT_PLAN);
  const out = ok('start-ready', id);
  const q = CONFIG.research_depth.quick;
  assert.match(out, new RegExp(`started\\tdiy-researcher\\tdiy-researcher\\tartifacts/research.md\\tattempt=1\\tdepth=quick:${q.max_searches}/${q.max_fetches}`));
});

test('depth: a gate failure earns the small retry budget, a changed input or the master a full one', () => {
  const id = newRun('depth-rerun', PRODUCT_PLAN);
  ok('start-ready', id);
  const bad = '# R\n';
  let out = finish(id, 'diy-researcher', bad); // G0 fails: missing structure -> findings
  const r = CONFIG.research_depth.retry;
  assert.match(out, new RegExp(`started\\tdiy-researcher\\t[^\\n]*attempt=2\\tdepth=retry:${r.max_searches}/${r.max_fetches}`));

  // validated, then the master's revision: the node's own level again
  ok('invalidate', id, 'diy-researcher', '--reason', 'master changed the method');
  const again = ok('start-ready', id);
  const q = CONFIG.research_depth.quick;
  assert.match(again, new RegExp(`started\\tdiy-researcher\\t[^\\n]*depth=quick:${q.max_searches}/${q.max_fetches}`));
});

test('depth: a coverage finding and an upstream change are research again, not a small fix', () => {
  const id = newRun('depth-cov', PRODUCT_PLAN);
  const s = readState(id);
  // Put the product node into a failed-gate state by hand through the CLI: fail with a coverage finding.
  ok('start', id, 'diy-researcher');
  write(id, 'artifacts/research.md', '# x\n');
  ok('artifact-written', join(wf, id, 'artifacts/research.md'));
  ok('stage-gate', id, 'diy-researcher', 'pass');
  ok('start', id, 'product-researcher-materials');
  write(id, 'artifacts/products-materials.md', '# x\n');
  ok('artifact-written', join(wf, id, 'artifacts/products-materials.md'));
  ok('fail', id, 'product-researcher-materials', '[G2] COVERAGE: 5 of 8 positions have no price');
  const out = ok('start-ready', id);
  const std = CONFIG.research_depth.standard;
  assert.match(out, new RegExp(`started\\tproduct-researcher-materials\\t[^\\n]*depth=standard:${std.max_searches}/${std.max_fetches}`));
  assert.ok(s);
});

test('depth: only researchers may carry a depth, and only a known level', () => {
  const id = ok('init', 'depth-bad');
  write(id, 'artifacts/requirements.md', '# R\n<!-- meta\nstatus: ready\nworkflow_type: project-plan\n-->\n');
  ok('confirm-requirements', id);
  const f = join(wf, id, 'plan.json');
  writeFileSync(f, JSON.stringify({ nodes: [{ id: 'cost-planner', agent: 'cost-planner', artifact: 'artifacts/budget.md', depth: 'quick' }] }));
  assert.notEqual(run('set-plan', id, f).status, 0);
  writeFileSync(f, JSON.stringify({ nodes: [{ id: 'diy-researcher', agent: 'diy-researcher', artifact: 'artifacts/research.md', depth: 'retry' }] }));
  assert.notEqual(run('set-plan', id, f).status, 0);
});

// ---------- previous artifact is a baseline: prices must not be lost ----------

test('a re-run cannot lose prices: the previous version is snapshotted and compared', () => {
  const id = newRun('regress', [
    { id: 'product-researcher-materials', agent: 'product-researcher', artifact: 'artifacts/products-materials.md', depth: 'quick' },
  ]);
  ok('start-ready', id);
  const first = productsDoc(id, [priced(1), priced(2), unpriced(3)]);
  assert.match(finish(id, 'product-researcher-materials', first), /\[G0\] PASS/);

  // The master's revision starts the node again; a snapshot of the validated version appears.
  ok('invalidate', id, 'product-researcher-materials', '--reason', 'plan changed');
  ok('start-ready', id);
  const snap = join(wf, id, 'artifacts', '_prev', 'products-materials.md');
  assert.ok(existsSync(snap), 'baseline snapshot is missing');
  assert.equal(readFileSync(snap, 'utf8'), first);

  // Rebuilt from scratch with fewer prices: refused.
  let out = finish(id, 'product-researcher-materials', productsDoc(id, [priced(1), unpriced(2), unpriced(3)]));
  assert.match(out, /price regression: 1 priced candidate rows, the previous version had 2/);
  assert.match(out, /started\tproduct-researcher-materials\t[^\n]*price regression/);
  assert.equal(readFileSync(snap, 'utf8'), first, 'the baseline must not be replaced by the regressed version');

  // Keeping the prices passes.
  out = finish(id, 'product-researcher-materials', productsDoc(id, [priced(1), priced(2), priced(4)]));
  assert.match(out, /\[G0\] PASS/);
});

test('a re-run may drop prices when it says which positions left the plan', () => {
  const id = newRun('regress-explained', [
    { id: 'product-researcher-materials', agent: 'product-researcher', artifact: 'artifacts/products-materials.md', depth: 'quick' },
  ]);
  ok('start-ready', id);
  finish(id, 'product-researcher-materials', productsDoc(id, [priced(1), priced(2)]));
  ok('invalidate', id, 'product-researcher-materials', '--reason', 'glue replaced by screws');
  ok('start-ready', id);
  const out = finish(id, 'product-researcher-materials',
    productsDoc(id, [priced(1)], 'Снято с плана: Позиция 2 (клей заменён шурупами).'));
  assert.match(out, /\[G0\] PASS/);
});

// ---------- price-coverage gate ----------

function coverageRun(slug, budgetRows) {
  const id = newRun(slug, [
    { id: 'product-researcher-materials', agent: 'product-researcher', artifact: 'artifacts/products-materials.md', depth: 'quick' },
    { id: 'product-researcher-tools', agent: 'product-researcher', artifact: 'artifacts/products-tools.md', depth: 'quick' },
    { id: 'cost-planner', agent: 'cost-planner', artifact: 'artifacts/budget.md', depends_on: ['product-researcher-materials', 'product-researcher-tools'] },
    { id: 'evidence-validator', agent: 'evidence-validator', artifact: 'artifacts/validation.md', depends_on: ['cost-planner'] },
  ]);
  ok('start-ready', id);
  const materials = productsDoc(id, [priced(1)]).replace('Текст.\n\n## Совместимость', 'Лента светодиодная, блок питания.\n\n## Совместимость');
  finish(id, 'product-researcher-materials', materials);
  finish(id, 'product-researcher-tools', productsDoc(id, [priced(2)]));
  finish(id, 'cost-planner', budgetDoc(id, budgetRows));
  const gate = ['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7'].map((g) => `| ${g} | PASS | — | — | ok | — |`);
  const head = '| Гейт | Статус | Артефакт | Узел | Замечание | Как исправить |\n|---|---|---|---|---|---|\n';
  const validation = `# Валидация\n\n<!-- meta\nartifact: validation\nowner: evidence-validator\nrun: ${id}\nversion: 1\nresult: PASS\n-->\n\n## Кратко\nТекст.\n\n## Результаты гейтов\n${head}${gate.join('\n')}\n\n## Итог\nPASS.\n\n## Допущения и неопределённости\nТекст.\n`;
  return { id, validation };
}

test('coverage gate: too many positions without a price fail G2 and go back to the product nodes', () => {
  const { id, validation } = coverageRun('cov-fail', [bPriced(1), bUnpriced(2), bUnpriced(3), bUnpriced(4)]);
  const out = finish(id, 'evidence-validator', validation);
  assert.match(out, /domain gates: FAIL/);
  assert.match(out, /product-researcher-(materials|tools): retry 1\/3/);
  const s = readState(id);
  assert.equal(s.domain_gates.result, 'fail');
  assert.deepEqual(s.domain_gates.coverage, { priced: 1, total: 4, limit: 0.3 });
  const failed = s.domain_gates.results.filter((r) => r.status === 'FAIL');
  assert.ok(failed.length >= 1);
  assert.ok(failed.every((r) => /^COVERAGE: 3 of 4 positions/.test(r.finding)));
  assert.equal(nodeOf(id, 'cost-planner').status, 'stale');
  assert.equal(nodeOf(id, 'evidence-validator').status, 'stale');
});

test('coverage gate: positions are handed to the node whose artifact mentions them', () => {
  const { id, validation } = coverageRun('cov-owner', [
    bPriced(1),
    '| Светодиодная лента 24 В | 1 | нет | нет | нет | нет | нет цены | нет | нет |\n',
    '| Блок питания | 1 | нет | нет | нет | нет | нет цены | нет | нет |\n',
    bUnpriced(4),
  ]);
  finish(id, 'evidence-validator', validation);
  const s = readState(id);
  const mat = s.domain_gates.results.find((r) => r.status === 'FAIL' && r.node === 'product-researcher-materials');
  assert.ok(mat, 'the materials node owns the tape and the power supply');
  assert.match(mat.finding, /Светодиодная лента/);
  assert.match(mat.finding, /Блок питания/);
});

test('coverage gate: enough prices pass', () => {
  const { id, validation } = coverageRun('cov-pass', [bPriced(1), bPriced(2), bPriced(3), bUnpriced(4)]);
  const out = finish(id, 'evidence-validator', validation);
  assert.match(out, /domain gates: PASS/);
  assert.deepEqual(readState(id).domain_gates.coverage, { priced: 3, total: 4, limit: 0.3 });
});

test('waive-coverage: after exhausted retries the master can accept the gaps; the plan then goes on', () => {
  const rows = [bPriced(1), bUnpriced(2), bUnpriced(3), bUnpriced(4)];
  const { id, validation } = coverageRun('cov-waive', rows);
  finish(id, 'evidence-validator', validation);
  // Every round the researchers bring the same few prices: the coverage failure repeats until retries run out.
  for (let i = 0; i < 40 && !readState(id).plan.nodes.some((n) => n.status === 'blocked'); i++) {
    const running = readState(id).plan.nodes.find((n) => n.status === 'running');
    if (!running) {
      ok('start-ready', id);
      continue;
    }
    const doc = { 'product-researcher': productsDoc(id, [priced(1)]), 'cost-planner': budgetDoc(id, rows), 'evidence-validator': validation }[running.agent];
    finish(id, running.id, doc);
  }
  const blocked = readState(id).plan.nodes.filter((n) => n.status === 'blocked');
  assert.ok(blocked.length >= 1, 'a product node must be blocked after its retries');
  assert.match(blocked[0].last_error, /COVERAGE:/);
  assert.match(ok('ready', id), /# BLOCKED/);

  assert.match(ok('waive-coverage', id), /coverage waived/);
  const s = readState(id);
  assert.ok(s.plan.nodes.every((n) => n.status !== 'blocked'));
  assert.ok(s.coverage_waived);
  // Nodes whose artifacts are intact are back as validated; the validator report is applied again, now passing.
  assert.equal(nodeOf(id, 'evidence-validator').status, 'validated');
  assert.match(ok('domain-gates', id), /domain gates: PASS/);
  assert.match(ok('ready', id), /# COMPLETE/);
});
