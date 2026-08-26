/* RO1 deploy: root-cause why 0021 was skipped — inspect migrator logic + hash table */
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const RES = 'C:/Users/Cris/Desktop/desktop/Agentic_OS/Agentic OS/resources';
const Database = require(path.join(RES, 'server/node_modules/better-sqlite3'));

const db = new Database('C:/Users/Cris/AppData/Roaming/agenticos/data/agentic-os.db', { readonly: true });
const rows = db.prepare('SELECT hash, created_at FROM __drizzle_migrations').all();
db.close();
const hashes = new Set(rows.map(r => r.hash));

for (const f of ['0021_add_revenue_metrics.sql', '0022_argus.sql', '0023_revenue_operator.sql']) {
  const h = crypto.createHash('sha256').update(fs.readFileSync(path.join(RES, 'server/drizzle', f))).digest('hex');
  console.log(f, 'sha256:', h.slice(0, 16), 'already in table:', hashes.has(h));
}
console.log('total rows:', rows.length);

// dump migrator source skip logic
const mig = fs.readFileSync(path.join(RES, 'server/node_modules/drizzle-orm/better-sqlite3/migrator.js'), 'utf-8');
console.log('\n=== packaged drizzle-orm better-sqlite3 migrator.js ===');
console.log(mig.slice(0, 4000));
console.log('\ndrizzle-orm version:', JSON.parse(fs.readFileSync(path.join(RES, 'server/node_modules/drizzle-orm/package.json'), 'utf-8')).version);
