// Tests for scripts/check-artifact.mjs (stage gate G0).
// Run: node --test scripts/test/check-artifact.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'check-artifact.mjs');
const RUN = '20261010-1000-test';
let artifacts;
let base;

const check = (file) => spawnSync('node', [SCRIPT, join(artifacts, file)], { encoding: 'utf8' });
const meta = (artifact, owner) => `<!-- meta\nartifact: ${artifact}\nowner: ${owner}\nrun: ${RUN}\nversion: 1\n-->`;

const REQUIREMENTS = `# Требования

${meta('requirements', 'requirements-formalizer').replace('version: 1', 'version: 1\nstatus: ready\nworkflow_type: how-to')}

## Кратко
x
## Цель
x
## Требования
| ID | Требование | Приоритет |
|----|------------|-----------|
| R1 | Что-то | must |
## Ограничения
x
## Что уже есть
x
## Допущения
x
## Открытые вопросы
x
## Покрытие требований
Не применимо.
## Допущения и неопределённости
x
## Источники
Не применимо.
`;

const productsDoc = (rows, cover = 'R1 — покрыто', sources = '1. Shop — https://example.com/p (дата обращения: 2026-10-10)') => `# Продукты и цены

${meta('products', 'product-researcher')}

## Кратко
x
## Кандидаты
| Позиция | Модель | Ключевые параметры | Магазин | Цена | Ссылка | Дата цены |
|---------|--------|--------------------|---------|------|--------|-----------|
${rows}
## Совместимость с тем, что есть
x
## Альтернативы
x
## Готовое изделие
Не применимо.
## Покрытие требований
| Требование | Где отражено | Статус |
|---|---|---|
| ${cover} | Кандидаты | ok |
## Допущения и неопределённости
x
## Источники
${sources}
`;

before(() => {
  base = mkdtempSync(join(tmpdir(), 'garage-g0-'));
  artifacts = join(base, RUN, 'artifacts');
  mkdirSync(artifacts, { recursive: true });
  writeFileSync(join(artifacts, 'requirements.md'), REQUIREMENTS);
});
after(() => rmSync(base, { recursive: true, force: true }));

const GOOD_ROW = '| Клей C2 | Mapei Keraflex | 25 kg | Castorama | 79,90 PLN | https://example.com/p | 2026-10-10 |';

test('valid requirements artifact passes', () => {
  const r = check('requirements.md');
  assert.equal(r.status, 0, r.stdout);
});

test('valid products artifact passes', () => {
  writeFileSync(join(artifacts, 'products.md'), productsDoc(GOOD_ROW));
  const r = check('products.md');
  assert.equal(r.status, 0, r.stdout);
});

test('price row without URL and date fails', () => {
  writeFileSync(join(artifacts, 'products.md'), productsDoc('| Клей C2 | Mapei | 25 kg | Castorama | 79,90 PLN | — | — |'));
  const r = check('products.md');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /no source URL/);
  assert.match(r.stdout, /no price date/);
});

test('unknown requirement id fails', () => {
  writeFileSync(join(artifacts, 'products.md'), productsDoc(GOOD_ROW, 'R9 — покрыто'));
  const r = check('products.md');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /unknown requirement IDs: R9/);
});

test('missing sources URL fails', () => {
  writeFileSync(join(artifacts, 'products.md'), productsDoc(GOOD_ROW, 'R1 — покрыто', 'нет'));
  const r = check('products.md');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /no URL/);
});

test('missing section, wrong owner and unfilled placeholder fail', () => {
  const doc = productsDoc(GOOD_ROW)
    .replace('owner: product-researcher', 'owner: diy-researcher')
    .replace('## Альтернативы\nx\n', '')
    .replace('## Кратко\nx', '## Кратко\nTODO');
  writeFileSync(join(artifacts, 'products.md'), doc);
  const r = check('products.md');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /meta\.owner/);
  assert.match(r.stdout, /missing sections: Альтернативы/);
  assert.match(r.stdout, /placeholder/);
});

test('more than two foreign sources fail', () => {
  const src = [1, 2, 3].map((i) => `${i}. [иностранный источник] Site ${i} — https://example.org/${i} (дата обращения: 2026-10-10) — нет локального аналога данных`).join('\n');
  writeFileSync(join(artifacts, 'products.md'), productsDoc(GOOD_ROW, 'R1 — покрыто', src));
  const r = check('products.md');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /more than 2 foreign sources/);
});

test('two tagged foreign sources with a reason pass', () => {
  const src = '1. Local — https://example.pl/1 (дата обращения: 2026-10-10)\n'
    + '2. [иностранный источник] Vendor — https://example.org/2 (дата обращения: 2026-10-10) — нет польского аналога техлиста';
  writeFileSync(join(artifacts, 'products.md'), productsDoc(GOOD_ROW, 'R1 — покрыто', src));
  const r = check('products.md');
  assert.equal(r.status, 0, r.stdout);
});

test('oversized artifact fails the size cap', () => {
  const filler = '| Позиция | Модель | Параметры | Магазин | 1 PLN | https://example.com/x | 2026-10-10 |\n'.repeat(120);
  writeFileSync(join(artifacts, 'products.md'), productsDoc(GOOD_ROW + '\n' + filler));
  const r = check('products.md');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /limit for products is 9000/);
});

const VALIDATION = (result, rows) => `# Валидация

<!-- meta
artifact: validation
owner: evidence-validator
run: ${RUN}
version: 1
result: ${result}
-->

## Кратко
x
## Результаты гейтов
| Гейт | Статус | Артефакт | Узел | Замечание | Как исправить |
|---|---|---|---|---|---|
${rows.join('\n')}
## Итог
x
## Допущения и неопределённости
x
`;
const OKROWS = ['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7'].map((g) => `| ${g} | PASS | — | — | ok | — |`);

test('valid validation artifact passes', () => {
  writeFileSync(join(artifacts, 'validation.md'), VALIDATION('PASS', OKROWS));
  const r = check('validation.md');
  assert.equal(r.status, 0, r.stdout);
});

test('validation: missing gate, inconsistent result and incomplete FAIL row fail', () => {
  const rows = OKROWS.slice(1);
  rows.push('| G2 | FAIL | budget.md | cost-planner | wrong | |');
  writeFileSync(join(artifacts, 'validation.md'), VALIDATION('PASS', rows.slice(0, 5)));
  let r = check('validation.md');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /gate G1 has no row|gate G6 has no row|gate G7 has no row/);

  writeFileSync(join(artifacts, 'validation.md'), VALIDATION('PASS', rows));
  r = check('validation.md');
  assert.match(r.stdout, /FAIL row needs both a finding and a fix hint/);
  assert.match(r.stdout, /meta\.result is PASS but the table has FAIL rows/);
});
