// Usage: node init-db.mjs <db-path> [--seed <seed.sql>]
// Creates the database from schema.sql; optionally loads a seed file. Replaces nothing that already exists
// unless --reset is given.
import { existsSync, rmSync, readFileSync } from 'node:fs';
import { openDb, resolveDbPath } from './db.mjs';

const args = process.argv.slice(2);
const dbArg = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--seed');
const seedIdx = args.indexOf('--seed');
const seed = seedIdx >= 0 ? args[seedIdx + 1] : null;
const reset = args.includes('--reset');

if (!dbArg) {
  console.error('Usage: node init-db.mjs <db-path> [--seed <seed.sql>] [--reset]');
  process.exit(1);
}

const path = resolveDbPath(dbArg);
if (reset && existsSync(path)) rmSync(path);
const existed = existsSync(path);
const db = openDb(path);
if (seed) {
  if (existed) {
    console.error(`Refusing to seed existing database ${path} (use --reset)`);
    process.exit(1);
  }
  db.exec(readFileSync(seed, 'utf8'));
}
db.close();
console.log(`${existed ? 'Schema ensured' : 'Created'}: ${path}${seed ? ` (seeded from ${seed})` : ''}`);
