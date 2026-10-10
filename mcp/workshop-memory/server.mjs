// Garage Copilot MCP server: persistent workshop memory over stdio.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import * as store from './db.mjs';

const dbPath = store.resolveDbPath();
const db = store.openDb(dbPath);

const server = new McpServer({ name: 'workshop-memory', version: '0.1.0' });

const ok = (data) => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] });
const fail = (e) => ({ isError: true, content: [{ type: 'text', text: `Error: ${e.message}` }] });
const handle = (fn) => async (args) => {
  try {
    return ok(fn(args));
  } catch (e) {
    return fail(e);
  }
};

const runId = z.string().optional()
  .describe('Workflow run id this write belongs to. Required for updates derived from a run; the memory-write-guard hook blocks it until the run is approved.');

const itemKind = z.enum(['tool', 'material', 'consumable', 'hardware']);

// ----- profile -----

server.registerTool('get_profile', {
  description: 'Get the master profile (name, city, currency, voltage, garage, skill level, preferences, tone). Returns null when onboarding has not happened yet.',
  inputSchema: {},
}, handle(() => ({ profile: store.getProfile(db) })));

server.registerTool('update_profile', {
  description: 'Create or update the master profile. Only provided fields change.',
  inputSchema: {
    name: z.string().optional(),
    city: z.string().optional(),
    country: z.string().optional(),
    currency: z.string().optional().describe('ISO 4217 code, e.g. PLN'),
    units: z.string().optional(),
    voltage: z.string().optional(),
    garage_size_m2: z.number().optional(),
    garage_notes: z.string().optional(),
    power_notes: z.string().optional(),
    dust_extraction: z.string().optional(),
    skill_level: z.string().optional(),
    preferences: z.string().optional(),
    tone: z.string().optional().describe('restrained (default) or another tone label'),
  },
}, handle((args) => ({ profile: store.updateProfile(db, args) })));

// ----- inventory -----

server.registerTool('list_inventory', {
  description: 'List tools, materials, consumables and hardware the master owns. Optional filters; query matches name, brand, model, category, specs and notes.',
  inputSchema: {
    kind: itemKind.optional(),
    category: z.string().optional(),
    query: z.string().optional(),
  },
}, handle((args) => ({ items: store.listInventory(db, args) })));

server.registerTool('check_owned', {
  description: 'For each requested item name, report whether something matching it is already in the inventory (all words must match). Use before recommending any purchase.',
  inputSchema: {
    items: z.array(z.string()).min(1).describe('Item names or descriptions, e.g. "router", "tile adhesive"'),
  },
}, handle(({ items }) => ({ results: store.checkOwned(db, items) })));

server.registerTool('add_inventory_item', {
  description: 'Add a tool, material, consumable or hardware item to the inventory.',
  inputSchema: {
    kind: itemKind,
    name: z.string(),
    brand: z.string().optional(),
    model: z.string().optional(),
    category: z.string().optional(),
    specs: z.string().optional().describe('Free text, e.g. "collet 8 mm, 1200 W"'),
    quantity: z.number().optional(),
    unit: z.string().optional(),
    condition: z.string().optional(),
    location: z.string().optional(),
    notes: z.string().optional(),
    run_id: runId,
  },
}, handle(({ run_id: _run, ...fields }) => ({ item: store.addInventoryItem(db, fields) })));

server.registerTool('update_inventory_item', {
  description: 'Update fields of an existing inventory item by id (e.g. consumed quantity).',
  inputSchema: {
    id: z.number().int(),
    name: z.string().optional(),
    brand: z.string().optional(),
    model: z.string().optional(),
    category: z.string().optional(),
    specs: z.string().optional(),
    quantity: z.number().optional(),
    unit: z.string().optional(),
    condition: z.string().optional(),
    location: z.string().optional(),
    notes: z.string().optional(),
    run_id: runId,
  },
}, handle(({ id, run_id: _run, ...fields }) => ({ item: store.updateInventoryItem(db, id, fields) })));

// ----- purchases -----

server.registerTool('record_purchase', {
  description: 'Record that the master bought something. Pass run_id when the purchase comes from an approved plan.',
  inputSchema: {
    item_name: z.string(),
    inventory_id: z.number().int().optional(),
    shop: z.string().optional(),
    price: z.number().optional(),
    currency: z.string().optional(),
    quantity: z.number().optional(),
    purchased_at: z.string().optional().describe('YYYY-MM-DD; defaults to today'),
    notes: z.string().optional(),
    run_id: runId,
  },
}, handle((args) => ({ purchase: store.recordPurchase(db, args) })));

// ----- projects -----

server.registerTool('list_projects', {
  description: 'List the master projects, newest first. Optional status filter.',
  inputSchema: {
    status: z.enum(['idea', 'planned', 'in_progress', 'done', 'abandoned']).optional(),
  },
}, handle((args) => ({ projects: store.listProjects(db, args) })));

server.registerTool('upsert_project', {
  description: 'Create or update a project. Matches by id, otherwise by run_id; creates when neither exists (title required).',
  inputSchema: {
    id: z.number().int().optional(),
    title: z.string().optional(),
    workflow_type: z.enum(['project-plan', 'purchase-decision', 'how-to']).optional(),
    status: z.enum(['idea', 'planned', 'in_progress', 'done', 'abandoned']).optional(),
    budget: z.number().optional(),
    currency: z.string().optional(),
    summary: z.string().optional(),
    run_id: runId,
  },
}, handle((args) => ({ project: store.upsertProject(db, args) })));

await server.connect(new StdioServerTransport());
console.error(`workshop-memory ready, db: ${dbPath}`);
