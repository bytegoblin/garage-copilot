#!/usr/bin/env node
// Deterministic structural check (stage gate G0) of a workflow artifact.
// Usage: node scripts/check-artifact.mjs <path-to-artifact.md>
// Exit 0 with "PASS", exit 1 with "FAIL" and one finding per line.
import { readFileSync, existsSync } from 'node:fs';
import { basename, dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATES = join(ROOT, '.claude', 'skills', 'artifact-validator', 'templates');
const CONFIG = JSON.parse(readFileSync(join(ROOT, 'config', 'workflow.json'), 'utf8'));
const RUN_ID_RE = new RegExp(CONFIG.run_id_pattern);

const OWNERS = {
  requirements: 'requirements-formalizer',
  research: 'diy-researcher',
  products: 'product-researcher',
  'project-plan': 'project-planner',
  budget: 'cost-planner',
  validation: 'evidence-validator',
  'final-plan': 'synthesizer',
};
const NEEDS_SOURCE_URLS = new Set(['research', 'products']);
const PRICE_SECTIONS = { products: 'Кандидаты', budget: 'Список покупок' };
const COVERAGE_TYPES = new Set(['research', 'products', 'project-plan', 'budget']);

const findings = [];
const add = (msg) => findings.push(msg);

function finish() {
  if (findings.length === 0) {
    console.log('PASS');
    process.exit(0);
  }
  console.log('FAIL');
  for (const f of findings) console.log(`- [G0] ${f}`);
  process.exit(1);
}

const target = process.argv[2];
if (!target) {
  console.error('usage: check-artifact.mjs <artifact.md>');
  process.exit(2);
}
const file = resolve(target);
if (!existsSync(file)) {
  add(`file does not exist: ${target}`);
  finish();
}

const name = basename(file, '.md');
const type = name.replace(/^(research|products)-[a-z0-9-]+$/, '$1');
if (!OWNERS[type]) {
  add(`unknown artifact type for file name: ${basename(file)}`);
  finish();
}
const templateFile = join(TEMPLATES, `${type}.md`);
if (!existsSync(templateFile)) {
  add(`no template for artifact type ${type}`);
  finish();
}

const runId = basename(dirname(dirname(file)));
const text = readFileSync(file, 'utf8');

const headings = (md) => [...md.matchAll(/^##\s+(.+?)\s*$/gm)].map((m) => m[1]);

function section(md, title) {
  const re = new RegExp(`^##\\s+${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'm');
  const m = re.exec(md);
  if (!m) return '';
  const rest = md.slice(m.index + m[0].length);
  const next = rest.search(/^##\s+/m);
  return next === -1 ? rest : rest.slice(0, next);
}

// ----- meta block -----
const metaMatch = text.match(/<!--\s*meta\s*\n([\s\S]*?)-->/);
if (!metaMatch) {
  add('meta block (<!-- meta ... -->) is missing');
} else {
  const meta = Object.fromEntries(
    metaMatch[1].split('\n').map((l) => l.match(/^\s*([a-z_]+):\s*(.*?)\s*$/)).filter(Boolean).map((m) => [m[1], m[2]]),
  );
  if (meta.artifact !== type) add(`meta.artifact is "${meta.artifact}", expected "${type}"`);
  if (meta.owner !== OWNERS[type]) add(`meta.owner is "${meta.owner}", expected "${OWNERS[type]}"`);
  if (RUN_ID_RE.test(runId) && meta.run !== runId) add(`meta.run is "${meta.run}", expected "${runId}"`);
  if (!meta.version || !/^\d+$/.test(meta.version)) add('meta.version must be a number');
  if (type === 'validation' && !['PASS', 'FAIL'].includes(meta.result)) add('meta.result must be PASS or FAIL');
  if (type === 'requirements') {
    if (!['ready', 'needs-answers'].includes(meta.status)) add('meta.status must be ready or needs-answers');
    if (!['project-plan', 'purchase-decision', 'how-to'].includes(meta.workflow_type)) {
      add('meta.workflow_type must be project-plan, purchase-decision or how-to');
    }
  }
}

// ----- headings: exact fixed structure -----
const expected = headings(readFileSync(templateFile, 'utf8'));
const actual = headings(text);
if (JSON.stringify(expected) !== JSON.stringify(actual)) {
  const missing = expected.filter((h) => !actual.includes(h));
  const extra = actual.filter((h) => !expected.includes(h));
  if (missing.length) add(`missing sections: ${missing.join('; ')}`);
  if (extra.length) add(`unexpected sections: ${extra.join('; ')}`);
  if (!missing.length && !extra.length) add(`sections are out of order; expected: ${expected.join(' > ')}`);
}

// ----- requirement coverage -----
if (COVERAGE_TYPES.has(type)) {
  const reqFile = join(dirname(file), 'requirements.md');
  const covered = [...new Set(section(text, 'Покрытие требований').match(/\bR\d+\b/g) || [])];
  if (covered.length === 0) add('"Покрытие требований" references no requirement IDs');
  if (existsSync(reqFile)) {
    const known = new Set(readFileSync(reqFile, 'utf8').match(/^\|\s*(R\d+)\s*\|/gm)?.map((r) => r.replace(/[|\s]/g, '')) || []);
    const unknown = covered.filter((id) => !known.has(id));
    if (unknown.length) add(`"Покрытие требований" references unknown requirement IDs: ${unknown.join(', ')}`);
  }
}

// ----- validation: one gate table covering G1-G7, owner nodes must exist in the plan -----
if (type === 'validation') {
  const rows = section(text, 'Результаты гейтов').split('\n').filter((l) => l.trim().startsWith('|'));
  const sep = rows.findIndex((r) => /^\|\s*:?-{2,}/.test(r.trim()));
  const data = (sep >= 0 ? rows.slice(sep + 1) : []).map((r) => r.split('|').slice(1, -1).map((c) => c.trim()));
  const seen = new Set();
  let anyFail = false;
  const planIds = new Set();
  const stateFile = join(dirname(dirname(file)), 'workflow-state.json');
  if (existsSync(stateFile)) {
    for (const n of JSON.parse(readFileSync(stateFile, 'utf8')).plan?.nodes || []) planIds.add(n.id);
  }
  for (const c of data) {
    if (c.length < 6) {
      add(`gate table row has ${c.length} cells, expected 6: ${c.join(' | ').slice(0, 60)}`);
      continue;
    }
    const [gate, status, , node] = c;
    if (!/^G[1-7]$/.test(gate)) add(`unknown gate id "${gate}"`);
    if (!['PASS', 'FAIL', 'N/A'].includes(status)) add(`${gate}: status must be PASS, FAIL or N/A, got "${status}"`);
    seen.add(gate);
    if (status === 'FAIL') {
      anyFail = true;
      if (planIds.size && !planIds.has(node)) add(`${gate}: owner node "${node}" is not in the plan`);
      if (!c[4] || !c[5]) add(`${gate}: a FAIL row needs both a finding and a fix hint`);
    }
  }
  for (const g of ['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7']) if (!seen.has(g)) add(`gate ${g} has no row`);
  const declared = metaMatch?.[1].match(/^\s*result:\s*(\S+)/m)?.[1];
  if (declared && (declared === 'FAIL') !== anyFail) add(`meta.result is ${declared} but the table has ${anyFail ? 'FAIL' : 'no FAIL'} rows`);
}

// ----- sources -----
if (NEEDS_SOURCE_URLS.has(type)) {
  if (!/https?:\/\/\S+/.test(section(text, 'Источники'))) add('"Источники" contains no URL');
}

// ----- foreign sources are supplementary: at most 2, each needs a reason on the same line -----
const foreign = section(text, 'Источники').split('\n').filter((l) => l.includes('[иностранный источник]'));
if (foreign.length > 2) add(`more than 2 foreign sources (${foreign.length}); foreign sources are supplementary only`);
for (const l of foreign) {
  if (!/\[иностранный источник\][^\n]*[—-]\s*\S+/.test(l) || l.replace(/\[иностранный источник\]/, '').trim().length < 20) {
    add(`foreign source without reason: ${l.trim().slice(0, 60)}`);
  }
}

// ----- price rows need a URL and a retrieval date -----
if (PRICE_SECTIONS[type]) {
  const rows = section(text, PRICE_SECTIONS[type]).split('\n').filter((l) => l.trim().startsWith('|'));
  const sepIdx = rows.findIndex((r) => /^\|\s*:?-{2,}/.test(r.trim()));
  const data = sepIdx >= 0 ? rows.slice(sepIdx + 1) : [];
  data.forEach((row, i) => {
    const cells = row.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.every((c) => c === '' || c === '—' || c === '-')) return;
    if (/уже есть/i.test(row)) return;
    const label = cells[0] || `row ${i + 1}`;
    if (!/https?:\/\/\S+/.test(row)) add(`${PRICE_SECTIONS[type]}: "${label}" has no source URL`);
    if (!/\d{4}-\d{2}-\d{2}/.test(row)) add(`${PRICE_SECTIONS[type]}: "${label}" has no price date (YYYY-MM-DD)`);
  });
}

// ----- size cap: keeps artifacts reviewable and downstream context small -----
const maxChars = CONFIG.artifact_max_chars?.[type];
const chars = [...text].length;
if (maxChars && chars > maxChars) {
  add(`artifact is ${chars} characters, limit for ${type} is ${maxChars}: shorten it (reference upstream artifacts instead of restating them, cut repetition)`);
}

// ----- leftovers -----
for (const re of [/\bTODO\b/, /\bTBD\b/, /lorem ipsum/i, /<run-id>/, /<n>/, /YYYY-MM-DD/]) {
  const body = text.replace(/<!--[\s\S]*?-->/g, (m) => (/<run-id>|<n>/.test(m) ? m : ''));
  if (re.test(body)) add(`unfilled placeholder matching ${re}`);
}

finish();
