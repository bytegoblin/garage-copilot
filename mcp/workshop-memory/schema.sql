-- Garage Copilot workshop memory schema.
-- Single master per database. Applied idempotently by db.mjs.

CREATE TABLE IF NOT EXISTS profile (
  id              INTEGER PRIMARY KEY CHECK (id = 1),
  name            TEXT,
  city            TEXT,
  country         TEXT,
  currency        TEXT,              -- ISO 4217, e.g. PLN
  units           TEXT DEFAULT 'metric',
  voltage         TEXT,              -- e.g. 230V
  garage_size_m2  REAL,
  garage_notes    TEXT,
  power_notes     TEXT,
  dust_extraction TEXT,
  skill_level     TEXT,
  preferences     TEXT,
  tone            TEXT DEFAULT 'restrained',
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS inventory (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  kind       TEXT NOT NULL CHECK (kind IN ('tool','material','consumable','hardware')),
  name       TEXT NOT NULL,
  brand      TEXT,
  model      TEXT,
  category   TEXT,
  specs      TEXT,                   -- free text, e.g. "collet 8 mm, 1200 W"
  quantity   REAL NOT NULL DEFAULT 1,
  unit       TEXT NOT NULL DEFAULT 'pcs',
  condition  TEXT,
  location   TEXT,
  notes      TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_inventory_kind ON inventory(kind);
CREATE INDEX IF NOT EXISTS idx_inventory_name ON inventory(name);

CREATE TABLE IF NOT EXISTS purchases (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  item_name    TEXT NOT NULL,
  inventory_id INTEGER REFERENCES inventory(id) ON DELETE SET NULL,
  shop         TEXT,
  price        REAL,
  currency     TEXT,
  quantity     REAL NOT NULL DEFAULT 1,
  purchased_at TEXT NOT NULL DEFAULT (date('now')),
  run_id       TEXT,
  notes        TEXT
);

CREATE TABLE IF NOT EXISTS projects (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  title         TEXT NOT NULL,
  workflow_type TEXT,
  status        TEXT NOT NULL DEFAULT 'idea'
                CHECK (status IN ('idea','planned','in_progress','done','abandoned')),
  run_id        TEXT UNIQUE,
  budget        REAL,
  currency      TEXT,
  summary       TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
