#!/usr/bin/env node
// Deterministic renderer: approved final-plan.md -> standalone output/garage-plan.html.
// Usage: node scripts/render-html.mjs <run-id>
// Refuses unless approval.json says "approved" for the exact current hash of final-plan.md.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { approvalStatus } from '../.claude/hooks/lib/common.mjs';
import { findLeaks } from '../.claude/hooks/lib/leaks.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG = JSON.parse(readFileSync(join(ROOT, 'config', 'workflow.json'), 'utf8'));
const RUN_ID_RE = new RegExp(CONFIG.run_id_pattern);
const TEMPLATE = join(ROOT, '.claude', 'skills', 'garage-html-theme', 'template.html');

const die = (msg) => {
  console.error(`render-html: ${msg}`);
  process.exit(1);
};

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Inline: escape first, then re-introduce the supported constructs.
export function inline(text) {
  const links = [];
  let t = esc(text);
  const keep = (html) => {
    links.push(html);
    return `\u0000${links.length - 1}\u0000`;
  };
  t = t.replace(/`([^`]+)`/g, (_, c) => keep(`<code>${c}</code>`));
  t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, label, url) => keep(`<a href="${url}">${label}</a>`));
  t = t.replace(/(^|[\s(>])(https?:\/\/[^\s<)]+[^\s<).,;:])/g, (_, pre, url) => `${pre}${keep(`<a href="${url}">${url}</a>`)}`);
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/(^|[\s(])\*([^*\s][^*]*?)\*(?=[\s).,;:]|$)/g, '$1<em>$2</em>');
  return t.replace(/\u0000(\d+)\u0000/g, (_, i) => links[Number(i)]);
}

export function renderMarkdown(md) {
  const lines = md.replace(/<!--[\s\S]*?-->/g, '').replace(/\r\n/g, '\n').split('\n');
  const out = [];
  const toc = [];
  let title = '';
  let sectionOpen = false;
  let para = [];
  let list = null;
  let table = null;
  let quote = [];

  const flushPara = () => {
    if (para.length) out.push(`<p>${inline(para.join(' '))}</p>`);
    para = [];
  };
  const flushList = () => {
    if (!list) return;
    const cls = list.checklist ? ' class="checklist"' : '';
    out.push(`<${list.tag}${cls}>\n${list.items.map((i) => `<li>${i}</li>`).join('\n')}\n</${list.tag}>`);
    list = null;
  };
  const flushTable = () => {
    if (!table) return;
    const [head, ...rows] = table;
    const cells = (r) => r.split('|').slice(1, -1).map((c) => c.trim());
    const bodyRows = rows.filter((r) => !/^\|\s*:?-{2,}/.test(r.trim()));
    let html = '<div class="table-wrap"><table>\n<thead><tr>' + cells(head).map((c) => `<th>${inline(c)}</th>`).join('') + '</tr></thead>\n<tbody>\n';
    html += bodyRows.map((r) => '<tr>' + cells(r).map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>').join('\n');
    html += '\n</tbody>\n</table></div>';
    out.push(html);
    table = null;
  };
  const flushQuote = () => {
    if (quote.length) out.push(`<blockquote>${inline(quote.join(' '))}</blockquote>`);
    quote = [];
  };
  const flushAll = () => {
    flushPara();
    flushList();
    flushTable();
    flushQuote();
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    let m;
    if (line.trim() === '') {
      flushAll();
    } else if ((m = line.match(/^#\s+(.+)$/))) {
      flushAll();
      if (!title) title = m[1].trim();
    } else if ((m = line.match(/^##\s+(.+)$/))) {
      flushAll();
      if (sectionOpen) out.push('</section>');
      toc.push(m[1].trim());
      out.push(`<section id="s${toc.length}">`, `<h2>${inline(m[1].trim())}</h2>`);
      sectionOpen = true;
    } else if ((m = line.match(/^###\s+(.+)$/))) {
      flushAll();
      out.push(`<h3>${inline(m[1].trim())}</h3>`);
    } else if (line.trim().startsWith('|')) {
      flushPara();
      flushList();
      flushQuote();
      (table ||= []).push(line.trim());
    } else if ((m = line.match(/^\s*[-*]\s+\[( |x|X)\]\s+(.+)$/))) {
      flushPara();
      flushTable();
      flushQuote();
      if (!list || list.tag !== 'ul' || !list.checklist) {
        flushList();
        list = { tag: 'ul', checklist: true, items: [] };
      }
      list.items.push(`${m[1] === ' ' ? '☐' : '☑'} ${inline(m[2])}`);
    } else if ((m = line.match(/^\s*[-*]\s+(.+)$/))) {
      flushPara();
      flushTable();
      flushQuote();
      if (!list || list.tag !== 'ul' || list.checklist) {
        flushList();
        list = { tag: 'ul', checklist: false, items: [] };
      }
      list.items.push(inline(m[1]));
    } else if ((m = line.match(/^\s*\d+[.)]\s+(.+)$/))) {
      flushPara();
      flushTable();
      flushQuote();
      if (!list || list.tag !== 'ol') {
        flushList();
        list = { tag: 'ol', checklist: false, items: [] };
      }
      list.items.push(inline(m[1]));
    } else if ((m = line.match(/^>\s?(.*)$/))) {
      flushPara();
      flushList();
      flushTable();
      quote.push(m[1]);
    } else {
      flushList();
      flushTable();
      flushQuote();
      para.push(line.trim());
    }
  }
  flushAll();
  if (sectionOpen) out.push('</section>');
  return { title, toc, body: out.join('\n') };
}

function main() {
  const runId = process.argv[2];
  if (!RUN_ID_RE.test(runId || '')) die(`invalid run id: ${runId}`);
  const input = { cwd: ROOT };
  const a = approvalStatus(input, runId);
  if (!a.ok) die(`refusing to render: ${a.reason}`);

  const wf = process.env.GARAGE_WORKFLOWS_DIR ? resolve(process.env.GARAGE_WORKFLOWS_DIR) : join(ROOT, 'workflows');
  const dir = join(wf, runId);
  const planFile = join(dir, 'artifacts', 'final-plan.md');
  if (!existsSync(planFile)) die('final-plan.md does not exist');
  const md = readFileSync(planFile, 'utf8');
  const { title, toc, body } = renderMarkdown(md);
  if (toc.length === 0) die('the plan has no sections');

  const approval = JSON.parse(readFileSync(join(dir, 'approval.json'), 'utf8'));
  const date = String(approval.approved_at || '').slice(0, 10);
  const subtitle = 'Составлено твоим помощником по мастерской';
  const footer = date ? `План одобрен ${date}. Цены ориентировочные, смотри даты рядом с ними.` : 'Цены ориентировочные, смотри даты рядом с ними.';
  const tocHtml = toc.map((t, i) => `<li><a href="#s${i + 1}">${inline(t)}</a></li>`).join('\n');

  let html = readFileSync(TEMPLATE, 'utf8');
  html = html
    .replace(/\{\{TITLE\}\}/g, esc(title || 'План'))
    .replace('{{SUBTITLE}}', esc(subtitle))
    .replace('{{TOC}}', tocHtml)
    .replace('{{FOOTER}}', esc(footer))
    .replace('{{CONTENT}}', () => body);

  const leaks = findLeaks(html.replace(/<[^>]+>/g, ' '));
  if (leaks.length) die(`internal names in the plan text: ${leaks.join(', ')}`);

  const outDir = join(dir, 'output');
  mkdirSync(outDir, { recursive: true });
  const outFile = join(outDir, 'garage-plan.html');
  writeFileSync(outFile, html);
  console.log(`rendered ${outFile}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
