// Shared reading of the price tables in products*.md and budget.md. Used by the artifact checker (G0) and
// by the state script (price-coverage gate), so that both count the same way.

export function sectionOf(md, title) {
  const esc = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`^##\\s+${esc}\\s*$`, 'm').exec(md);
  if (!m) return '';
  const rest = md.slice(m.index + m[0].length);
  const next = rest.search(/^##\s+/m);
  return next === -1 ? rest : rest.slice(0, next);
}

// First Markdown table of a text: { header: string[], rows: string[][] } (separator row dropped).
export function firstTable(text) {
  const lines = text.split('\n').filter((l) => l.trim().startsWith('|'));
  const sep = lines.findIndex((l) => /^\|\s*:?-{2,}/.test(l.trim()));
  if (sep < 1) return { header: [], rows: [] };
  const cells = (l) => l.split('|').slice(1, -1).map((c) => c.trim());
  const rows = [];
  for (const l of lines.slice(sep + 1)) {
    const c = cells(l);
    if (c.every((x) => x === '' || x === '—' || x === '-')) continue;
    rows.push(c);
  }
  return { header: cells(lines[sep - 1]), rows };
}

// A price cell carries a price when it has a digit and does not say that the price was not found.
export function hasPrice(cell) {
  if (!/\d/.test(cell || '')) return false;
  return !/не найден|не указан|не использ|нет цены|цены нет|после входа/i.test(cell);
}

// products*.md: the rows of "Кандидаты" that carry a price.
export function productsPriced(md) {
  const { header, rows } = firstTable(sectionOf(md, 'Кандидаты'));
  const col = header.findIndex((h) => /^цена(\s|$)/i.test(h)); // no \b: it does not work with Cyrillic
  if (col < 0) return { total: rows.length, priced: 0 };
  return { total: rows.length, priced: rows.filter((r) => hasPrice(r[col])).length };
}

// budget.md: every position of the shopping list is a row; a row is priced when its average price is a number.
export function budgetCoverage(md) {
  const { header, rows } = firstTable(sectionOf(md, 'Список покупок'));
  const avg = header.findIndex((h) => /^средн/i.test(h));
  if (avg < 0) return { total: 0, priced: 0, unpriced: [] };
  const own = rows.filter((r) => !/уже есть/i.test(r.join(' ')));
  const unpriced = own.filter((r) => !hasPrice(r[avg])).map((r) => r[0]);
  return { total: own.length, priced: own.length - unpriced.length, unpriced };
}
