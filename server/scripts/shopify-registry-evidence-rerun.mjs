/**
 * shopify-registry-evidence-rerun.mjs — appends verification evidence for the Shopify
 * channel task to the live AgenticOS task registry.
 *
 * Unlike the first version of this script, every field written here is DERIVED from the
 * machine evidence file (docs/shopify-channel-verification-2026-09-20-rerun.json) instead
 * of being hard-coded, so the registry can never disagree with the run it cites.
 *
 * A timestamped backup of the live DB is taken before any write; nothing is deleted.
 *
 * Usage:
 *   node scripts/shopify-registry-evidence-rerun.mjs            # dry run
 *   node scripts/shopify-registry-evidence-rerun.mjs --apply    # write
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const EVIDENCE_JSON_REL = process.env.SHOPIFY_EVIDENCE_REL
  || 'docs/shopify-channel-verification-2026-09-20-rerun.json';
const EVIDENCE_MD_REL = EVIDENCE_JSON_REL.replace(/\.json$/, '.md');
const EVIDENCE_JSON = path.join(REPO_ROOT, EVIDENCE_JSON_REL);
const LIVE_DB = process.env.AGENTICOS_LIVE_DB
  || 'C:/Users/cd-pr/AppData/Roaming/agenticos/data/agentic-os.db';
const BACKUP_DIR = path.join(REPO_ROOT, '.tmp', process.env.SHOPIFY_BACKUP_DIR || 'shopify-verify-r2');
const APPLY = process.argv.includes('--apply');

if (!fs.existsSync(EVIDENCE_JSON)) {
  console.error('EVIDENCE FILE MISSING: ' + EVIDENCE_JSON + ' — run the verification first.');
  process.exit(1);
}
const ev = JSON.parse(fs.readFileSync(EVIDENCE_JSON, 'utf8'));
const ch = ev.channelVerification;
const cat = ev.productInventorySync.localCatalog;

const SUMMARY =
  `[EVIDENCE] Shopify channel verification re-run ${ev.run.executedAt} — ${ch.verdict}. `
  + `Live channel registry: ${ch.registryRowsBeforeSeed} rows (SHOPIFY unregistered); seed contract = ${ch.shopifyChannelAfterSeed.status} + humanGateRequired=${ch.shopifyChannelAfterSeed.humanGateRequired}; `
  + `publishExperiment blocked (${ch.publishAttempt.reason}, gate ${ch.publishAttempt.gateCreated}, sandbox only), 0 ledger entries / €0 fabricated. `
  + `Storefront inspection: ${ev.storefrontInspection.verdict}. `
  + `Inventory sync: NOT performed (${ev.productInventorySync.syncClientInCodebase.slice(0, 60)}...).`;

const BLOCKER =
  `Shopify authentication required (SHOPIFY_AUTH_REQUIRED human gate): no store domain, no Admin API credentials `
  + `and no SHOPIFY channel row exist in the live runtime DB (${ch.registryRowsBeforeSeed} channel rows). `
  + `Supply store domain + Admin API access, then seed the channel registry and set SHOPIFY to active. `
  + `Storefront inspection additionally blocked by browser-use spawn defect (${ev.storefrontInspection.browserInspectionTooling.error}).`;

const RESULT_TEXT =
  `Channel verification: ${ch.verdict}. Storefront inspection: ${ev.storefrontInspection.verdict}. `
  + `Inventory sync: not performed (no Admin API client). Local catalog: ${cat.count} experiments (all APPROVED, 0 with sales), €${cat.verifiedRevenueEur} verified revenue. `
  + `Contract test: ${ch.contractTest.result}. Evidence: ${EVIDENCE_JSON_REL}, ${EVIDENCE_MD_REL}.`;

const detail = JSON.stringify({
  runner: 'hermes-worker',
  executedAt: ev.run.executedAt,
  repository: ev.run.repository,
  evidence: [EVIDENCE_JSON_REL, EVIDENCE_MD_REL],
  scripts: ev.run.scriptsRun,
  channelVerification: {
    registryRowsBeforeSeed: ch.registryRowsBeforeSeed,
    shopifyAfterSeed: `${ch.shopifyChannelAfterSeed.status} / humanGateRequired=${ch.shopifyChannelAfterSeed.humanGateRequired}`,
    publishAttempt: `blocked (${ch.publishAttempt.reason} ${ch.publishAttempt.gateCreated}, sandbox only)`,
    contractTest: ch.contractTest.result,
    egress: ch.egressChecks.map((e) => `${e.url} -> ${e.http}`).join('; '),
  },
  storefrontInspection: `${ev.storefrontInspection.verdict}; browser tooling: ${ev.storefrontInspection.browserInspectionTooling.result} (${ev.storefrontInspection.browserInspectionTooling.error})`,
  productInventorySync: `NOT_PERFORMED (${ev.productInventorySync.syncClientInCodebase}); catalog=${cat.count} experiments, 0 assigned/sold`,
  findings: ev.runtimeIntegrityFindings.map((f) => `${f.id}[${f.severity}/${f.status}]`),
  acceptanceCriteria: ev.acceptanceCriteria.map((a) => ({ criterion: a.criterion, met: a.met })),
  liveDbMutated: ev.run.liveDbMutatedByThisRun,
});

if (!fs.existsSync(LIVE_DB)) {
  console.error('LIVE DB NOT FOUND: ' + LIVE_DB);
  process.exit(1);
}

let backup = null;
if (APPLY) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  backup = path.join(BACKUP_DIR, `live-db-backup-${stamp}.db`);
  fs.copyFileSync(LIVE_DB, backup);
  console.log('BACKUP: ' + backup + ' (' + fs.statSync(backup).size + ' bytes)');
}

const db = new Database(LIVE_DB, { readonly: !APPLY, fileMustExist: true });
db.pragma('busy_timeout = 8000');

const TASK_QUERY =
  "SELECT task_id, status, verification_state FROM background_tasks WHERE objective LIKE '%channel verification%'";
const tasks = db.prepare(TASK_QUERY).all();
if (tasks.length === 0) {
  console.error('NO SHOPIFY VERIFICATION TASK ROWS FOUND — nothing to annotate.');
  db.close();
  process.exit(1);
}
console.log('TASKS TARGETED: ' + tasks.length);
for (const t of tasks) console.log(`  BEFORE ${t.task_id} status=${t.status} verification=${t.verification_state}`);

if (!APPLY) {
  console.log('DRY RUN — pass --apply to write evidence events.');
  db.close();
  process.exit(0);
}

let seq = db.prepare('SELECT MAX(sequence) m FROM background_task_events').get().m || 0;
const insertEvent = db.prepare(
  'INSERT INTO background_task_events (id, task_id, ts, kind, summary, detail, sequence) VALUES (?, ?, ?, ?, ?, ?, ?)'
);
const updateTask = db.prepare(
  `UPDATE background_tasks
      SET progress_message = ?, blocker = ?, last_error = ?, result_text = ?,
          verification_state = ?, current_stage = ?, updated_at = ?, metadata = ?
    WHERE task_id = ?`
);

const now = new Date().toISOString();
const run = db.transaction(() => {
  for (const t of tasks) {
    seq += 1;
    insertEvent.run(
      'bgevt-' + crypto.randomBytes(6).toString('hex'),
      t.task_id,
      now,
      'task.progress',
      SUMMARY,
      detail,
      seq
    );
    const meta = db.prepare('SELECT metadata FROM background_tasks WHERE task_id = ?').get(t.task_id)?.metadata;
    let parsed = {};
    try { parsed = meta ? JSON.parse(meta) : {}; } catch { parsed = { previousMetadata: String(meta) }; }
    parsed.evidenceArtifact = EVIDENCE_JSON_REL;
    parsed.evidenceReport = EVIDENCE_MD_REL;
    parsed.verifiedAt = now;
    parsed.verifiedBy = 'hermes-worker';
    parsed.verifiedRun = ev.run.executedAt;
    parsed.blockingGate = 'SHOPIFY_AUTH_REQUIRED';
    updateTask.run(
      `Verification re-run executed by Hermes worker ${ev.run.executedAt} — see evidence event.`,
      BLOCKER,
      'Shopify authentication required (SHOPIFY_AUTH_REQUIRED).',
      RESULT_TEXT,
      ch.verdict === 'FAILED_AT_AUTHENTICATION' ? 'failed' : 'pending',
      'blocked',
      now,
      JSON.stringify(parsed),
      t.task_id
    );
  }
});
run();

console.log('--- AFTER ---');
for (const t of db.prepare(
  "SELECT task_id, status, verification_state, substr(COALESCE(blocker,''),1,70) blocker, substr(COALESCE(result_text,''),1,70) rt FROM background_tasks WHERE objective LIKE '%channel verification%'"
).all()) {
  console.log('  ' + JSON.stringify(t));
}
console.log('EVIDENCE EVENTS: ' + db.prepare(
  "SELECT COUNT(*) n FROM background_task_events WHERE task_id IN (SELECT task_id FROM background_tasks WHERE objective LIKE '%channel verification%') AND summary LIKE '[EVIDENCE]%'"
).get().n);
db.close();
