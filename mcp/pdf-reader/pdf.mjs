// PDF reading for the pdf-reader MCP server: download with limits, text per page, page ranges, keyword search.
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { getDocumentProxy, extractText } from 'unpdf';

export const LIMITS = {
  max_bytes: 25 * 1024 * 1024,
  timeout_ms: 25_000,
  default_chars: 8000,
  max_chars: 20000,
  snippet_radius: 260,
  max_snippets: 10,
  cache_documents: 8,
};

// ---- address policy: this is a research tool for public web pages, not a way to reach the local network ----

function isPrivateAddress(ip) {
  if (ip === '::1' || ip === '::') return true;
  if (ip.startsWith('fe80:') || ip.startsWith('fc') || ip.startsWith('fd')) return true;
  const v4 = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  const m = v4.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

export async function assertPublicUrl(raw, env = process.env) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    throw new Error('not a valid URL');
  }
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('only http and https URLs are read');
  if (env.PDF_READER_ALLOW_PRIVATE === '1') return u;
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const addrs = isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address);
  if (addrs.some(isPrivateAddress)) throw new Error('private or local addresses are not read');
  return u;
}

// ---- page selection ----

// "1-3,7" -> [1,2,3,7] limited to 1..count; throws on nonsense.
export function parsePages(spec, count) {
  if (!spec) return [];
  const out = new Set();
  for (const part of String(spec).split(',')) {
    const m = part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!m) throw new Error(`bad pages specification: "${spec}" (use e.g. 1-3,7)`);
    const from = Number(m[1]);
    const to = m[2] ? Number(m[2]) : from;
    if (from < 1 || to < from) throw new Error(`bad page range: "${part.trim()}"`);
    for (let p = from; p <= Math.min(to, count); p++) out.add(p);
  }
  return [...out].sort((a, b) => a - b);
}

const clean = (t) => t.replace(/[ \t ]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();

// Words or alternatives separated by "|" (case-insensitive, literal): "temperatura|czas otwarty".
export function searchPages(pages, query, { radius = LIMITS.snippet_radius, max = LIMITS.max_snippets } = {}) {
  const terms = String(query).split('|').map((t) => t.trim()).filter(Boolean);
  if (terms.length === 0) throw new Error('query is empty');
  const re = new RegExp(terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'gi');
  const hits = [];
  pages.forEach((text, i) => {
    let last = -Infinity;
    for (const m of text.matchAll(re)) {
      if (m.index < last + radius) continue; // one snippet per neighbourhood
      last = m.index;
      const from = Math.max(0, m.index - radius);
      const to = Math.min(text.length, m.index + m[0].length + radius);
      hits.push({ page: i + 1, term: m[0], text: `${from > 0 ? '…' : ''}${text.slice(from, to).replace(/\n/g, ' ')}${to < text.length ? '…' : ''}` });
    }
  });
  return { hits: hits.slice(0, max), total_hits: hits.length };
}

// ---- download and extraction ----

const cache = new Map();

async function download(url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), LIMITS.timeout_ms);
  try {
    const res = await fetch(url, {
      signal: ctl.signal,
      redirect: 'follow',
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; GarageCopilot/0.1; +data-sheet-reader)', accept: 'application/pdf,*/*;q=0.5' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const declared = Number(res.headers.get('content-length') || 0);
    if (declared > LIMITS.max_bytes) throw new Error(`document is ${Math.round(declared / 1e6)} MB, the limit is ${LIMITS.max_bytes / 1e6} MB`);
    const chunks = [];
    let size = 0;
    for await (const c of res.body) {
      size += c.length;
      if (size > LIMITS.max_bytes) throw new Error(`document is larger than ${LIMITS.max_bytes / 1e6} MB`);
      chunks.push(c);
    }
    return Buffer.concat(chunks);
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(`timeout after ${LIMITS.timeout_ms / 1000} s`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export async function loadPdf(rawUrl, env = process.env) {
  const u = await assertPublicUrl(rawUrl, env);
  const key = u.href;
  if (cache.has(key)) return cache.get(key);
  const buf = await download(u.href);
  if (buf.subarray(0, 1024).toString('latin1').indexOf('%PDF-') === -1) throw new Error('the response is not a PDF document');
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const { text } = await extractText(pdf, { mergePages: false });
  const pages = text.map(clean);
  let title = null;
  try {
    const meta = await pdf.getMetadata();
    title = meta?.info?.Title ? String(meta.info.Title).slice(0, 200) : null;
  } catch { /* metadata is optional */ }
  const doc = { url: key, title, pages, bytes: buf.length };
  cache.set(key, doc);
  while (cache.size > LIMITS.cache_documents) cache.delete(cache.keys().next().value);
  return doc;
}

// Builds the answer of the read_pdf tool from a loaded document.
export function answer(doc, { pages, query, max_chars } = {}) {
  const cap = Math.min(Math.max(Number(max_chars) || LIMITS.default_chars, 500), LIMITS.max_chars);
  const base = { url: doc.url, title: doc.title, page_count: doc.pages.length, bytes: doc.bytes };
  const chars = doc.pages.reduce((n, p) => n + p.length, 0);
  if (chars < 40 * Math.max(1, doc.pages.length) && chars < 200) {
    return { ...base, mode: 'empty', note: 'the document has no extractable text (a scan or images only); treat its facts as unknown' };
  }
  if (query) {
    const { hits, total_hits: total } = searchPages(doc.pages, query);
    const note = total === 0 ? 'no page contains these words; try other spellings or the language of the document' : undefined;
    return { ...base, mode: 'search', query, total_hits: total, hits, ...(note ? { note } : {}) };
  }
  const wanted = pages ? parsePages(pages, doc.pages.length) : [];
  if (pages && wanted.length === 0) return { ...base, mode: 'pages', note: `the document has ${doc.pages.length} pages` };
  const chosen = wanted.length ? wanted : doc.pages.slice(0, 2).map((_, i) => i + 1);
  let used = 0;
  const parts = [];
  const returned = [];
  for (const p of chosen) {
    const t = doc.pages[p - 1];
    if (used + t.length > cap && returned.length > 0) break;
    const piece = used + t.length > cap ? `${t.slice(0, cap - used)}…` : t;
    parts.push(`[стр. ${p}]\n${piece}`);
    returned.push(p);
    used += piece.length;
  }
  const rest = chosen.filter((p) => !returned.includes(p));
  return {
    ...base,
    mode: wanted.length ? 'pages' : 'overview',
    pages_returned: returned,
    ...(rest.length ? { truncated_pages: rest, note: 'the character cap was reached; ask for these pages separately or use query' } : {}),
    text: parts.join('\n\n'),
  };
}
