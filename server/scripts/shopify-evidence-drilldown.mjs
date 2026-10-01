/**
 * shopify-evidence-drilldown.mjs — extracts the concrete Shopify-relevant rows found by
 * shopify-inventory-scan.mjs (read-only on the live runtime DB).
 * Usage: node scripts/shopify-evidence-drilldown.mjs
 */
import Database from 'better-sqlite3';

const LIVE = 'C:/Users/cd-pr/AppData/Roaming/agenticos/data/agentic-os.db';
const db = new Database(LIVE, { readonly: true, fileMustExist: true });
const out = {};

out.executionResultsWithShopifyHost = db
  .prepare(
    `SELECT id, substr(COALESCE(structured_output,''),1,1200) snippet
       FROM execution_results
      WHERE structured_output LIKE '%myshopify%' OR structured_output LIKE '%shopify.com%'
      LIMIT 5`
  )
  .all();

out.repairDiagnosesWithShopify = db
  .prepare(
    `SELECT id, substr(COALESCE(evidence,''),1,300) evidence
       FROM repair_diagnoses
      WHERE evidence LIKE '%shopify.com%'
      LIMIT 5`
  )
  .all();

const taskCols = db.prepare('PRAGMA table_info(background_tasks)').all().map((c) => c.name);
out.backgroundTasksColumns = taskCols;
const want = ['task_id', 'objective', 'status', 'verification_state', 'current_stage', 'blocker', 'result_text', 'created_at', 'updated_at', 'metadata'];
const sel = want.filter((c) => taskCols.includes(c)).join(', ');
out.shopifyTasks = db
  .prepare(`SELECT ${sel} FROM background_tasks WHERE objective LIKE '%channel verification%' OR objective LIKE '%Shopify%'`)
  .all()
  .map((t) => ({
    ...t,
    objective: String(t.objective || '').slice(0, 140),
    result_text: String(t.result_text || '').slice(0, 400),
    blocker: String(t.blocker || '').slice(0, 200),
    metadata: String(t.metadata || '').slice(0, 300),
  }));

out.evidenceEvents = db
  .prepare(
    `SELECT task_id, ts, substr(summary,1,160) summary
       FROM background_task_events
      WHERE summary LIKE '%shopify.com%' OR summary LIKE '%[EVIDENCE]%'
      ORDER BY ts DESC LIMIT 10`
  )
  .all();

out.anyStoreDomainRows = db
  .prepare(
    `SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE '%integration%' OR name LIKE '%connector%' OR name LIKE '%credential%' OR name LIKE '%secret%' OR name LIKE '%oauth%')`
  )
  .all();

console.log(JSON.stringify(out, null, 2));
db.close();
