/* RO1 deploy: inspect dev DB + 0021 sql + revenue.ts measurements dependency */
const fs = require('fs');
const D = require('B:/AgenticOS/server/node_modules/better-sqlite3');
const db = new D('B:/AgenticOS/server/data/agentic-os.db', { readonly: true });
console.log('DEV DB revenue tables:', db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'revenue%' ORDER BY name").all().map(t => t.name));
db.close();
console.log('--- 0021 sql:');
console.log(fs.readFileSync('B:/AgenticOS/server/drizzle/0021_add_revenue_metrics.sql', 'utf-8'));
const rev = fs.readFileSync('B:/AgenticOS/server/src/routers/revenue.ts', 'utf-8');
const idx = rev.indexOf("router.get('/measurements'");
console.log('--- revenue.ts measurements section:');
console.log(rev.slice(idx - 200, idx + 2000));
console.log('--- revenueMetrics imports in revenue.ts:', (rev.match(/revenueMetrics/g) || []).length);
const schema = fs.readFileSync('B:/AgenticOS/server/src/db/schema.ts', 'utf-8');
const sIdx = schema.indexOf("revenue_metrics");
console.log('--- schema revenue_metrics block:');
console.log(schema.slice(sIdx - 100, sIdx + 900));
