// Inspect schema state of the deployed DB: columns of the assignment +
// circuit-breaker tables and applied drizzle migrations.
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.join(__dirname, '..', 'server');
const require = createRequire(path.join(serverDir, 'package.json'));
const Database = require('better-sqlite3');
const dbPath = process.argv[2];

const db = new Database(dbPath, { readonly: true });
const out = {};
out.tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('agent_provider_assignments','provider_circuit_breakers','gateway_configuration','__drizzle_migrations') ORDER BY name").all().map((r) => r.name);
for (const t of ['agent_provider_assignments', 'provider_circuit_breakers', 'gateway_configuration']) {
  out[`cols_${t}`] = db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
}
out.drizzleMigrations = db.prepare('SELECT id, hash, created_at FROM __drizzle_migrations ORDER BY created_at').all().map((r) => ({ id: r.id, hash: (r.hash || '').slice(0, 10) }));
db.close();
console.log('SCHEMA ' + JSON.stringify(out));
