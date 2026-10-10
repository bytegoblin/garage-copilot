// Smoke test: starts the real server over stdio against a throwaway seeded DB and exercises every tool.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const tmp = mkdtempSync(join(tmpdir(), 'garage-smoke-'));
const dbFile = join(tmp, 'smoke.db');

execFileSync('node', [join(ROOT, 'init-db.mjs'), dbFile, '--seed', join(ROOT, 'seed.demo.sql')], { stdio: 'inherit' });

const client = new Client({ name: 'smoke', version: '0.0.0' });
await client.connect(new StdioClientTransport({
  command: 'node',
  args: [join(ROOT, 'server.mjs')],
  env: { ...process.env, GARAGE_DB: dbFile },
  stderr: 'pipe',
}));

const call = async (name, args = {}) => {
  const res = await client.callTool({ name, arguments: args });
  const data = JSON.parse(res.content[0].text.replace(/^Error: /, '{"error":"') + (res.isError ? '"}' : ''));
  return { isError: !!res.isError, data };
};

try {
  const tools = (await client.listTools()).tools.map((t) => t.name).sort();
  assert.deepEqual(tools, [
    'add_inventory_item', 'check_owned', 'get_profile', 'list_inventory', 'list_projects',
    'record_purchase', 'update_inventory_item', 'update_profile', 'upsert_project',
  ]);

  const profile = (await call('get_profile')).data.profile;
  assert.equal(profile.city, 'Wrocław');
  assert.equal(profile.currency, 'PLN');

  const upd = (await call('update_profile', { skill_level: 'advanced' })).data.profile;
  assert.equal(upd.skill_level, 'advanced');
  assert.equal(upd.city, 'Wrocław');

  const tools1 = (await call('list_inventory', { kind: 'tool' })).data.items;
  assert.ok(tools1.length >= 5 && tools1.every((i) => i.kind === 'tool'));

  const owned = (await call('check_owned', { items: ['router', 'tile adhesive', 'floor tiles'] })).data.results;
  assert.equal(owned[0].owned, true);
  assert.equal(owned[1].owned, false);
  assert.equal(owned[2].owned, true);

  const added = (await call('add_inventory_item', { kind: 'consumable', name: 'Tile adhesive C2', quantity: 25, unit: 'kg' })).data.item;
  assert.equal(added.name, 'Tile adhesive C2');
  assert.equal((await call('check_owned', { items: ['tile adhesive'] })).data.results[0].owned, true);

  const upItem = (await call('update_inventory_item', { id: added.id, quantity: 10 })).data.item;
  assert.equal(upItem.quantity, 10);

  const bad = await call('update_inventory_item', { id: 99999, quantity: 1 });
  assert.equal(bad.isError, true);

  const purchase = (await call('record_purchase', { item_name: 'Tile adhesive C2', shop: 'Castorama', price: 79.9, currency: 'PLN', run_id: 'smoke-run' })).data.purchase;
  assert.equal(purchase.run_id, 'smoke-run');

  const proj = (await call('upsert_project', { title: 'Hallway shelf', workflow_type: 'project-plan', status: 'planned', run_id: 'smoke-run' })).data.project;
  assert.equal(proj.status, 'planned');
  const proj2 = (await call('upsert_project', { run_id: 'smoke-run', status: 'in_progress' })).data.project;
  assert.equal(proj2.id, proj.id);
  assert.equal(proj2.status, 'in_progress');

  const planned = (await call('list_projects', { status: 'in_progress' })).data.projects;
  assert.equal(planned.length, 1);

  console.log('workshop-memory smoke test: OK');
} finally {
  await client.close();
  rmSync(tmp, { recursive: true, force: true });
}
