// Data access layer for the workshop memory. No MCP code here, so it can be tested directly.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, '..', '..');
export const SCHEMA_PATH = resolve(HERE, 'schema.sql');

const PROFILE_FIELDS = [
  'name', 'city', 'country', 'currency', 'units', 'voltage', 'garage_size_m2',
  'garage_notes', 'power_notes', 'dust_extraction', 'skill_level', 'preferences', 'tone',
];
const INVENTORY_FIELDS = [
  'kind', 'name', 'brand', 'model', 'category', 'specs', 'quantity', 'unit',
  'condition', 'location', 'notes',
];

export function resolveDbPath(p = process.env.GARAGE_DB || 'data/garage.db') {
  return isAbsolute(p) ? p : resolve(REPO_ROOT, p);
}

export function openDb(path = resolveDbPath()) {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(readFileSync(SCHEMA_PATH, 'utf8'));
  return db;
}

function pick(obj, fields) {
  const out = {};
  for (const f of fields) if (obj[f] !== undefined) out[f] = obj[f];
  return out;
}

// ---------- profile ----------

export function getProfile(db) {
  const row = db.prepare('SELECT * FROM profile WHERE id = 1').get();
  return row ? { ...row } : null;
}

export function updateProfile(db, fields) {
  const data = pick(fields, PROFILE_FIELDS);
  const keys = Object.keys(data);
  if (keys.length === 0) throw new Error('No profile fields provided');
  const exists = db.prepare('SELECT 1 FROM profile WHERE id = 1').get();
  if (!exists) db.prepare('INSERT INTO profile (id) VALUES (1)').run();
  const set = keys.map((k) => `${k} = ?`).join(', ');
  db.prepare(`UPDATE profile SET ${set}, updated_at = datetime('now') WHERE id = 1`)
    .run(...keys.map((k) => data[k]));
  return getProfile(db);
}

// ---------- inventory ----------

export function listInventory(db, { kind, category, query } = {}) {
  const rows = db.prepare('SELECT * FROM inventory ORDER BY kind, name').all().map((r) => ({ ...r }));
  const q = query?.trim().toLowerCase();
  return rows.filter((r) => {
    if (kind && r.kind !== kind) return false;
    if (category && (r.category || '').toLowerCase() !== category.toLowerCase()) return false;
    if (q && !haystack(r).includes(q)) return false;
    return true;
  });
}

function haystack(r) {
  return [r.name, r.brand, r.model, r.category, r.specs, r.notes]
    .filter(Boolean).join(' ').toLowerCase();
}

// Every whitespace-separated token of the query must occur in the item's text.
export function checkOwned(db, items) {
  const all = db.prepare('SELECT * FROM inventory').all().map((r) => ({ ...r }));
  return items.map((item) => {
    const tokens = item.toLowerCase().split(/\s+/).filter(Boolean);
    const matches = all.filter((r) => {
      const h = haystack(r);
      return tokens.length > 0 && tokens.every((t) => h.includes(t));
    });
    return { query: item, owned: matches.length > 0, matches };
  });
}

export function addInventoryItem(db, fields) {
  const data = pick(fields, INVENTORY_FIELDS);
  if (!data.kind || !data.name) throw new Error('kind and name are required');
  const keys = Object.keys(data);
  const res = db.prepare(
    `INSERT INTO inventory (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`,
  ).run(...keys.map((k) => data[k]));
  return db.prepare('SELECT * FROM inventory WHERE id = ?').get(res.lastInsertRowid);
}

export function updateInventoryItem(db, id, fields) {
  const data = pick(fields, INVENTORY_FIELDS);
  const keys = Object.keys(data);
  if (keys.length === 0) throw new Error('No inventory fields provided');
  const res = db.prepare(
    `UPDATE inventory SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`,
  ).run(...keys.map((k) => data[k]), id);
  if (res.changes === 0) throw new Error(`Inventory item ${id} not found`);
  return db.prepare('SELECT * FROM inventory WHERE id = ?').get(id);
}

// ---------- purchases ----------

export function recordPurchase(db, p) {
  if (!p.item_name) throw new Error('item_name is required');
  const res = db.prepare(
    `INSERT INTO purchases (item_name, inventory_id, shop, price, currency, quantity, purchased_at, run_id, notes)
     VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, date('now')), ?, ?)`,
  ).run(
    p.item_name, p.inventory_id ?? null, p.shop ?? null, p.price ?? null, p.currency ?? null,
    p.quantity ?? 1, p.purchased_at ?? null, p.run_id ?? null, p.notes ?? null,
  );
  return db.prepare('SELECT * FROM purchases WHERE id = ?').get(res.lastInsertRowid);
}

// ---------- projects ----------

export function listProjects(db, { status } = {}) {
  const rows = status
    ? db.prepare('SELECT * FROM projects WHERE status = ? ORDER BY updated_at DESC').all(status)
    : db.prepare('SELECT * FROM projects ORDER BY updated_at DESC').all();
  return rows.map((r) => ({ ...r }));
}

// Upsert by run_id when given, otherwise by id, otherwise insert.
export function upsertProject(db, p) {
  const cols = ['title', 'workflow_type', 'status', 'run_id', 'budget', 'currency', 'summary'];
  const data = pick(p, cols);
  let existing = null;
  if (p.id) existing = db.prepare('SELECT * FROM projects WHERE id = ?').get(p.id);
  else if (p.run_id) existing = db.prepare('SELECT * FROM projects WHERE run_id = ?').get(p.run_id);

  if (existing) {
    const keys = Object.keys(data);
    if (keys.length > 0) {
      db.prepare(
        `UPDATE projects SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`,
      ).run(...keys.map((k) => data[k]), existing.id);
    }
    return { ...db.prepare('SELECT * FROM projects WHERE id = ?').get(existing.id) };
  }
  if (!data.title) throw new Error('title is required for a new project');
  const keys = Object.keys(data);
  const res = db.prepare(
    `INSERT INTO projects (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`,
  ).run(...keys.map((k) => data[k]));
  return { ...db.prepare('SELECT * FROM projects WHERE id = ?').get(res.lastInsertRowid) };
}
