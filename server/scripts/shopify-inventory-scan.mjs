/**
 * shopify-channel-verification-scan.mjs — read-only inventory scan of both runtime DBs.
 * Usage: node .tmp/shopify-scan.mjs
 */
import Database from 'better-sqlite3';

const DBS = {
  live: 'C:/Users/cd-pr/AppData/Roaming/agenticos/data/agentic-os.db',
  repoLegacy: 'D:/AgenticOS/server/data/agentic-os.db',
};

const out = { scannedAt: new Date().toISOString() };
for (const [label, file] of Object.entries(DBS)) {
  const db = new Database(file, { readonly: true, fileMustExist: true });
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table'")
    .all()
    .map((r) => r.name);
  const rec = { file, sizeBytes: null, tables: tables.length };

  const has = (t) => tables.includes(t);
  const count = (t) => (has(t) ? db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n : null);
  const cols = (t) => (has(t) ? db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name) : []);

  rec.revenue_distribution_channels = count('revenue_distribution_channels');
  rec.revenue_human_gates = count('revenue_human_gates');
  rec.revenue_experiments = count('revenue_experiments');
  rec.revenue_ledger_entries = count('revenue_ledger_entries');
  if (has('revenue_distribution_channels')) {
    rec.channelRows = db
      .prepare('SELECT channel, status, human_gate_required FROM revenue_distribution_channels')
      .all();
  }
  if (has('revenue_human_gates')) {
    rec.shopifyGates = db
      .prepare(
        "SELECT status, COUNT(*) n FROM revenue_human_gates WHERE gate_type LIKE '%SHOPIFY%' GROUP BY status"
      )
      .all();
  }
  if (has('revenue_experiments')) {
    const c = cols('revenue_experiments');
    rec.revenue_experiments_columns = c;
    rec.experimentsAssignedToChannel = c.includes('channel')
      ? db.prepare('SELECT COUNT(*) n FROM revenue_experiments WHERE channel IS NOT NULL').get().n
      : 'column absent in this schema';
    rec.experimentsWithSales = c.includes('sales')
      ? db.prepare('SELECT COUNT(*) n FROM revenue_experiments WHERE COALESCE(sales,0) > 0').get().n
      : 'column absent in this schema';
    rec.verifiedRevenueSum = c.includes('verified_revenue')
      ? db.prepare('SELECT COALESCE(SUM(verified_revenue),0) s FROM revenue_experiments').get().s
      : 'column absent in this schema';
  }
  if (has('projects')) {
    rec.shopifyProject = db
      .prepare("SELECT id, name, status, workspace_path, revenue_vertical FROM projects WHERE id LIKE '%shopify%' OR name LIKE '%Shopify%'")
      .all();
  }
  // bounded credential/domain scan: any text column containing a shopify host or token-ish key
  const needles = ['myshopify', 'shopify.com', 'shpat_', 'shpca_', 'X-Shopify-Access-Token'];
  const hits = [];
  for (const t of tables) {
    const cols = db.prepare(`PRAGMA table_info(${t})`).all().filter((c) => /TEXT|CHAR|CLOB|BLOB/i.test(c.type || '') || c.type === '');
    for (const c of cols) {
      for (const n of needles) {
        try {
          const r = db
            .prepare(`SELECT COUNT(*) n FROM "${t}" WHERE "${c.name}" LIKE ?`)
            .get(`%${n}%`);
          if (r.n > 0) hits.push({ table: t, column: c.name, needle: n.startsWith('shp') ? '[token-like]' : n, rows: r.n });
        } catch { /* non-text column */ }
      }
    }
  }
  rec.shopifyHostOrCredentialHits = hits;
  if (has('background_tasks')) {
    rec.shopifyTasks = db
      .prepare(
        "SELECT task_id, status, verification_state, substr(COALESCE(blocker,''),1,60) blocker FROM background_tasks WHERE objective LIKE '%channel verification%' OR objective LIKE '%Shopify%'"
      )
      .all();
  }
  out[label] = rec;
  db.close();
}
console.log(JSON.stringify(out, null, 2));
