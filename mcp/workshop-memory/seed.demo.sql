-- Fictional demo master used for committed demo runs. Not real personal data.

INSERT OR REPLACE INTO profile
  (id, name, city, country, currency, units, voltage, garage_size_m2, garage_notes,
   power_notes, dust_extraction, skill_level, preferences, tone)
VALUES
  (1, 'Marek', 'Wrocław', 'Poland', 'PLN', 'metric', '230V', 24,
   'Detached garage, concrete floor, one window, unheated',
   'Two 230V sockets on one 16A circuit, no 400V',
   'None yet; shop vac only',
   'intermediate',
   'Prefers doing it himself; compares cost of ready-made before buying; new tools, used allowed for large machines',
   'restrained');

INSERT INTO inventory (kind, name, brand, model, category, specs, quantity, unit, condition, notes) VALUES
  ('tool', 'Cordless drill/driver', 'Makita', 'DDF484', 'drilling', '18V LXT, 13 mm chuck', 1, 'pcs', 'good', NULL),
  ('tool', 'Orbital sander', 'Bosch', 'GEX 125', 'sanding', '125 mm, 250 W', 1, 'pcs', 'good', NULL),
  ('tool', 'Circular saw', 'Makita', 'HS7601', 'sawing', '190 mm blade, 1200 W', 1, 'pcs', 'good', NULL),
  ('tool', 'Router', 'Bosch', 'POF 1200 AE', 'routing', '1200 W, collet 8 mm only, no 6 mm reducer', 1, 'pcs', 'good', 'Reducer sleeve 6 mm not included'),
  ('tool', 'Spirit level', NULL, NULL, 'measuring', '120 cm', 1, 'pcs', 'good', NULL),
  ('tool', 'Notched trowel', NULL, NULL, 'tiling', '10 mm notch', 1, 'pcs', 'good', NULL),
  ('material', 'Floor tiles', NULL, NULL, 'tiling', 'Porcelain 60x60 cm, R10, rectified', 28, 'm2', 'new', 'Already bought for garage floor'),
  ('consumable', 'Tile spacers', NULL, NULL, 'tiling', '3 mm', 100, 'pcs', 'new', NULL);

INSERT INTO projects (title, workflow_type, status, summary) VALUES
  ('Garage floor tiles', 'project-plan', 'idea', 'Tiles bought, installation not yet planned');
