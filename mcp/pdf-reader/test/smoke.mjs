// Smoke test: serves a generated 3-page PDF from a local HTTP server and exercises the real MCP server over stdio.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createServer } from 'node:http';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { parsePages, searchPages, assertPublicUrl } from '../pdf.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// A minimal valid PDF with one text line per page (standard Helvetica, ASCII only).
function makePdf(lines) {
  const objs = [];
  const add = (body) => { objs.push(body); return objs.length; };
  const catalog = add('');
  const pagesObj = add('');
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const kids = [];
  for (const line of lines) {
    const stream = `BT /F1 14 Tf 50 700 Td (${line.replace(/[()\\]/g, '')}) Tj ET`;
    const content = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 595 842] /Contents ${content} 0 R /Resources << /Font << /F1 ${font} 0 R >> >> >>`));
  }
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  objs[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
  let out = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((b, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${b}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

// ---- unit checks ----
assert.deepEqual(parsePages('1-3,7', 5), [1, 2, 3]);
assert.deepEqual(parsePages('2', 5), [2]);
assert.throws(() => parsePages('x', 5));
const s = searchPages(['alpha beta gamma', 'delta Temperatura epsilon'], 'temperatura|czas');
assert.equal(s.hits.length, 1);
assert.equal(s.hits[0].page, 2);
await assert.rejects(assertPublicUrl('http://127.0.0.1:1/x.pdf', {}), /private or local/);
await assert.rejects(assertPublicUrl('file:///etc/passwd', {}), /only http/);

// ---- server over stdio ----
const pdf = makePdf([
  'Karta techniczna. Klej do plytek CX-100.',
  'Temperatura stosowania od +5 C do +30 C. Czas otwarty 20 minut.',
  'Czas zachowania wlasciwosci roboczych 4 godziny.',
]);
const http = createServer((req, res) => {
  if (req.url === '/doc.pdf') {
    res.writeHead(200, { 'content-type': 'application/pdf' });
    res.end(pdf);
  } else {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<html>not a pdf</html>');
  }
}).listen(0, '127.0.0.1');
await new Promise((r) => http.once('listening', r));
const base = `http://127.0.0.1:${http.address().port}`;

const client = new Client({ name: 'smoke', version: '0.0.0' });
await client.connect(new StdioClientTransport({
  command: 'node',
  args: [join(ROOT, 'server.mjs')],
  env: { ...process.env, PDF_READER_ALLOW_PRIVATE: '1' },
  stderr: 'pipe',
}));
const call = async (args) => {
  const res = await client.callTool({ name: 'read_pdf', arguments: args });
  const text = res.content[0].text;
  return { isError: !!res.isError, text, data: res.isError ? null : JSON.parse(text) };
};

try {
  const tools = (await client.listTools()).tools.map((t) => t.name);
  assert.deepEqual(tools, ['read_pdf']);

  const overview = (await call({ url: `${base}/doc.pdf` })).data;
  assert.equal(overview.page_count, 3);
  assert.equal(overview.mode, 'overview');
  assert.match(overview.text, /\[стр\. 1\]/);
  assert.match(overview.text, /CX-100/);

  const found = (await call({ url: `${base}/doc.pdf`, query: 'temperatura|czas otwarty' })).data;
  assert.equal(found.mode, 'search');
  assert.ok(found.hits.length >= 1);
  assert.equal(found.hits[0].page, 2);
  assert.match(found.hits[0].text, /\+5 C do \+30 C/);

  const page3 = (await call({ url: `${base}/doc.pdf`, pages: '3' })).data;
  assert.deepEqual(page3.pages_returned, [3]);
  assert.match(page3.text, /4 godziny/);

  const none = (await call({ url: `${base}/doc.pdf`, query: 'nieistniejace' })).data;
  assert.equal(none.total_hits, 0);

  const html = await call({ url: `${base}/page.html` });
  assert.equal(html.isError, true);
  assert.match(html.text, /not a PDF/);

  console.log('pdf-reader smoke test: OK');
} finally {
  await client.close();
  http.close();
}
