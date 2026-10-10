// End-to-end tests of the approval chain: request-approval -> approve.mjs/reject -> hooks -> renderer.
// Run: node --test scripts/test/approval.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPTS = join(ROOT, 'scripts');
let wf;
let env;

const node = (script, ...args) => spawnSync('node', [join(SCRIPTS, script), ...args], { env, encoding: 'utf8' });
const state = (...args) => node('state.mjs', ...args);
const okOut = (r) => {
  assert.equal(r.status, 0, r.stderr || r.stdout);
  return r.stdout.trim();
};
const readState = (id) => JSON.parse(readFileSync(join(wf, id, 'workflow-state.json'), 'utf8'));
const nodeOf = (id, n) => readState(id).plan.nodes.find((x) => x.id === n);

const HEADINGS = ['Кратко', 'Что мы учли', 'План работ по этапам', 'Что у тебя уже есть', 'Список покупок',
  'Бюджет и сравнение с готовым решением', 'Безопасность', 'Риски и неопределённости',
  'Что я запишу в твою базу после одобрения', 'Источники'];

function finalPlan(id, extra = '') {
  const body = HEADINGS.map((h, i) => {
    if (h === 'Источники') return `## ${h}\n1. Производитель — https://example.pl/karta (дата обращения: 2026-10-10)\n`;
    if (h === 'Список покупок') {
      return `## ${h}\n| Позиция | Цена | Ссылка |\n|---|---|---|\n| Клей | **42,99 PLN** | [Castorama](https://example.pl/klej) |\n`;
    }
    return `## ${h}\nТекст раздела ${i + 1}.${i === 0 ? extra : ''}\n- пункт <b>один</b>\n`;
  }).join('\n');
  return `# План проекта\n\n<!-- meta\nartifact: final-plan\nowner: synthesizer\nrun: ${id}\nversion: 1\nworkflow_type: project-plan\n-->\n\n${body}`;
}

function approvalRun(slug) {
  const id = okOut(state('init', slug));
  writeFileSync(join(wf, id, 'artifacts', 'requirements.md'), '# R\n<!-- meta\nstatus: ready\nworkflow_type: project-plan\n-->\n');
  okOut(state('confirm-requirements', id));
  const plan = join(wf, id, 'plan.json');
  writeFileSync(plan, JSON.stringify({ nodes: [
    { id: 'synthesizer', agent: 'synthesizer', artifact: 'artifacts/final-plan.md' },
    { id: 'final-output-builder', agent: 'final-output-builder', artifact: 'output/garage-plan.html', depends_on: ['synthesizer'], gate: 'approval' },
  ] }));
  okOut(state('set-plan', id, plan));
  okOut(state('start', id, 'synthesizer'));
  writeFileSync(join(wf, id, 'artifacts', 'final-plan.md'), finalPlan(id));
  okOut(state('artifact-written', join(wf, id, 'artifacts', 'final-plan.md')));
  okOut(state('stage-gate', id, 'synthesizer', 'pass'));
  return id;
}

before(() => {
  wf = mkdtempSync(join(tmpdir(), 'garage-approval-'));
  env = { ...process.env, GARAGE_WORKFLOWS_DIR: wf, CLAUDE_PROJECT_DIR: ROOT };
});
after(() => rmSync(wf, { recursive: true, force: true }));

test('approval is refused before it was requested', () => {
  const id = approvalRun('not-requested');
  const r = node('approve.mjs', 'approve', id);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /not awaiting approval/);
  assert.equal(existsSync(join(wf, id, 'approval.json')), false);
});

test('the final output node stays locked until the plan is approved, then opens', () => {
  const id = approvalRun('happy');
  assert.match(okOut(state('ready', id)), /# WAITING_APPROVAL/);
  okOut(state('request-approval', id));
  assert.equal(readState(id).status, 'awaiting_approval');
  assert.match(okOut(node('approve.mjs', 'approve', id)), /APPROVED/);
  assert.equal(readState(id).approval.status, 'approved');
  assert.equal(readState(id).status, 'approved');
  assert.match(okOut(state('ready', id)), /dispatch\tfinal-output-builder/);
});

test('approval is voided when the plan changes after it was presented', () => {
  const id = approvalRun('changed');
  okOut(state('request-approval', id));
  writeFileSync(join(wf, id, 'artifacts', 'final-plan.md'), finalPlan(id, ' Поменяли цифру.'));
  const r = node('approve.mjs', 'approve', id);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /not the version that was presented/);
  assert.equal(existsSync(join(wf, id, 'approval.json')), false);
});

test('a run id can be omitted when exactly one run awaits approval', () => {
  const id = approvalRun('single');
  okOut(state('request-approval', id));
  const r = node('approve.mjs', 'approve');
  // Other runs of this suite may also wait; either it picks the only one or it asks for the id.
  assert.ok(r.status === 0 || /several runs await approval/.test(r.stderr), r.stderr);
});

test('rejection records feedback, then a new round needs a new request', () => {
  const id = approvalRun('rejected');
  okOut(state('request-approval', id));
  assert.match(okOut(node('approve.mjs', 'reject', id)), /REJECTED/);
  assert.equal(readState(id).status, 'revision_requested');
  const fb = join(wf, id, 'feedback.md');
  writeFileSync(fb, 'Найди клей дешевле');
  okOut(state('set-feedback', id, fb));
  assert.equal(readState(id).approval.history[0].feedback, 'Найди клей дешевле');
  // Rejected plan cannot be approved without a new round.
  assert.equal(node('approve.mjs', 'approve', id).status, 1);
  okOut(state('invalidate', id, 'synthesizer', '--reason', 'master feedback'));
  okOut(state('start', id, 'synthesizer'));
  writeFileSync(join(wf, id, 'artifacts', 'final-plan.md'), finalPlan(id, ' Теперь с другим клеем.'));
  okOut(state('artifact-written', join(wf, id, 'artifacts', 'final-plan.md')));
  okOut(state('stage-gate', id, 'synthesizer', 'pass'));
  okOut(state('request-approval', id));
  assert.equal(readState(id).approval.round, 2);
  assert.match(okOut(node('approve.mjs', 'approve', id)), /APPROVED/);
});

test('renderer refuses before approval and renders a checked standalone page after it', () => {
  const id = approvalRun('render');
  assert.equal(node('render-html.mjs', id).status, 1);
  assert.equal(existsSync(join(wf, id, 'output', 'garage-plan.html')), false);

  okOut(state('request-approval', id));
  okOut(node('approve.mjs', 'approve', id));
  assert.match(okOut(node('render-html.mjs', id)), /rendered/);
  const out = join(wf, id, 'output', 'garage-plan.html');
  const html = readFileSync(out, 'utf8');
  assert.match(html, /^<!doctype html>/i);
  assert.match(html, /<h2>Список покупок<\/h2>/);
  assert.match(html, /<th>Позиция<\/th>/);
  assert.match(html, /<strong>42,99 PLN<\/strong>/);
  assert.match(html, /<a href="https:\/\/example\.pl\/klej">Castorama<\/a>/);
  assert.doesNotMatch(html, /<b>один<\/b>/, 'raw HTML in the plan must be escaped');
  assert.match(html, /&lt;b&gt;один&lt;\/b&gt;/);
  assert.doesNotMatch(html, /\{\{/);

  const check = spawnSync('node', [join(SCRIPTS, 'check-artifact.mjs'), out], { env, encoding: 'utf8' });
  assert.equal(check.status, 0, check.stdout);

  okOut(state('start', id, 'final-output-builder'));
  okOut(state('artifact-written', out));
  okOut(state('stage-gate', id, 'final-output-builder', 'pass'));
  assert.equal(readState(id).final_output.status, 'done');
  assert.match(okOut(state('ready', id)), /# COMPLETE/);
});

test('rendering is deterministic: same plan, same bytes', () => {
  const id = approvalRun('determinism');
  okOut(state('request-approval', id));
  okOut(node('approve.mjs', 'approve', id));
  okOut(node('render-html.mjs', id));
  const first = readFileSync(join(wf, id, 'output', 'garage-plan.html'), 'utf8');
  okOut(node('render-html.mjs', id));
  assert.equal(readFileSync(join(wf, id, 'output', 'garage-plan.html'), 'utf8'), first);
});

test('write-back is allowed only after approval', () => {
  const id = approvalRun('writeback');
  assert.notEqual(state('writeback', id, 'done').status, 0);
  okOut(state('request-approval', id));
  okOut(node('approve.mjs', 'approve', id));
  okOut(state('writeback', id, 'done'));
  assert.equal(readState(id).memory_writeback.status, 'done');
});

test('final plan structural check: fixed sections, workflow type and internal names', () => {
  const id = approvalRun('g0final');
  const file = join(wf, id, 'artifacts', 'final-plan.md');
  const check = () => spawnSync('node', [join(SCRIPTS, 'check-artifact.mjs'), file], { env, encoding: 'utf8' });
  assert.equal(check().status, 0, check().stdout);

  writeFileSync(file, finalPlan(id, ' Подробности в research-bonding.md.'));
  let r = check();
  assert.equal(r.status, 1);
  assert.match(r.stdout, /internal names/);

  writeFileSync(file, finalPlan(id).replace('## Безопасность\n', '## Безопасность и охрана\n'));
  r = check();
  assert.equal(r.status, 1);
  assert.match(r.stdout, /missing sections: Безопасность/);
});

test('final plan lint rejects private shorthand but accepts natural prose', () => {
  const id = approvalRun('lint');
  const file = join(wf, id, 'artifacts', 'final-plan.md');
  const check = () => spawnSync('node', [join(SCRIPTS, 'check-artifact.mjs'), file], { env, encoding: 'utf8' });
  writeFileSync(file, finalPlan(id, ' Бук стоит 49 ор. за доску.'));
  let r = check();
  assert.equal(r.status, 1);
  assert.match(r.stdout, /«ор\.»/);
  writeFileSync(file, finalPlan(id, ' Ширина короба W = 564 минус зазоры, длина c_L.'));
  r = check();
  assert.equal(r.status, 1);
  assert.match(r.stdout, /variable-style notation|formula/);
  writeFileSync(file, finalPlan(id, ' Бук обойдётся примерно в 49 zł за доску, цену смотрел по выдаче поиска.'));
  assert.equal(check().status, 0, check().stdout);
});
