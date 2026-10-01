/**
 * shopify-registry-evidence.mjs — writes verification evidence for the Shopify
 * channel task into the AgenticOS task registry (the live runtime DB).
 *
 * The AgenticOS backend (default port 4600) was not listening during this run, so
 * the registry is updated directly with the same append-only event shape the
 * background-task store uses (columns mirror src/services/backgroundTasks/store.ts).
 * A timestamped backup of the live DB is taken first; nothing is deleted.
 *
 * Usage:
 *   node scripts/shopify-registry-evidence.mjs --apply
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import Database from 'better-sqlite3';

const LIVE_DB = process.env.AGENTICOS_LIVE_DB
  || 'C:/Users/cd-pr/AppData/Roaming/agenticos/data/agentic-os.db';
const BACKUP_DIR = 'D:/AgenticOS/.tmp/shopify-verify';
const APPLY = process.argv.includes('--apply');

const EVIDENCE_JSON = 'docs/shopify-channel-verification-2026-09-20.json';
const EVIDENCE_MD = 'docs/shopify-channel-verification-2026-09-20.md';

const SUMMARY =
  '[EVIDENCE] Shopify channel verification executed — FAILED at authentication. '
  + 'Channel registry empty in live DB (0 rows, SHOPIFY unregistered); seed contract = auth_required + humanGateRequired; '
  + 'publishExperiment blocked with SHOPIFY_AUTH_REQUIRED gate (nothing fabricated). '
  + 'Storefront inspection BLOCKED (no store domain/session configured). '
  + 'Product inventory sync NOT performed (no Shopify Admin API client, no authenticated store).';

const BLOCKER =
  'Shopify authentication required (SHOPIFY_AUTH_REQUIRED human gate): no store domain, no Admin API credentials '
  + 'and no SHOPIFY channel row exist in the live runtime DB. Supply store domain + Admin API access, then seed the '
  + 'channel registry and set SHOPIFY to active.';

const RESULT_TEXT =
  'Channel verification: FAILED at authentication. Storefront inspection: BLOCKED — no storefront configured. '
  + `Inventory sync: not performed (no Admin API client). Local catalog: 47 experiments (all APPROVED, 0 assigned to a channel), €0 verified revenue. `
  + `Evidence: ${EVIDENCE_JSON}, ${EVIDENCE_MD}.`;

const detail = JSON.stringify({
  runner: 'hermes-worker',
  executedAt: new Date().toISOString(),
  repository: 'D:\\AgenticOS',
  evidence: [EVIDENCE_JSON, EVIDENCE_MD],
  script: 'server/scripts/shopify-channel-verification.mjs',
  channelVerification: {
    registryRowsBeforeSeed: 0,
    shopifyAfterSeed: 'auth_required / humanGateRequired=true',
    publishAttempt: 'blocked (SHOPIFY_AUTH_REQUIRED gate-ec1ed787-, branchPaused=true)',
    contractTest: 'src/__tests__/distributionService.test.ts — 2/2 passed',
  },
  storefrontInspection: 'BLOCKED_NO_TARGET (no store domain, no merchant session; browser tooling unavailable: uv trampoline os error 4551)',
  productInventorySync: 'NOT_PERFORMED (no Shopify Admin API client; 47 APPROVED experiments, 0 assigned to a channel)',
  acceptanceCriteria: [
    { criterion: 'Shopify store configuration and channel connectivity verified.', met: false },
    { criterion: 'Execution leaves evidence in project task registry.', met: true },
  ],
  readOnlyOutsideSandbox: false,
});

if (!fs.existsSync(LIVE_DB)) {
  console.error('LIVE DB NOT FOUND: ' + LIVE_DB);
  process.exit(1);
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
if (APPLY) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const backup = path.join(BACKUP_DIR, `live-db-backup-${stamp}.db`);
  fs.copyFileSync(LIVE_DB, backup);
  console.log('BACKUP: ' + backup + ' (' + fs.statSync(backup).size + ' bytes)');
}

const db = new Database(LIVE_DB, { readonly: !APPLY, fileMustExist: true });
db.pragma('busy_timeout = 8000');

const tasks = db.prepare(
  "SELECT task_id, status, verification_state, blocker, result_text FROM background_tasks WHERE objective LIKE '%channel verification%'"
).all();

if (tasks.length === 0) {
  console.error('NO SHOPIFY TASK ROWS FOUND — nothing to annotate.');
  process.exit(1);
}

console.log('TASKS TARGETED: ' + tasks.length);
for (const t of tasks) console.log('  BEFORE ' + t.task_id + ' status=' + t.status + ' verification=' + t.verification_state);

if (!APPLY) {
  console.log('DRY RUN — pass --apply to write evidence events and update task fields.');
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

const run = db.transaction(() => {
  for (const t of tasks) {
    seq += 1;
    insertEvent.run(
      'bgevt-' + crypto.randomBytes(6).toString('hex'),
      t.task_id,
      new Date().toISOString(),
      'task.progress',
      SUMMARY,
      detail,
      seq
    );

    const meta = db.prepare('SELECT metadata FROM background_tasks WHERE task_id = ?').get(t.task_id)?.metadata;
    let parsed = {};
    try { parsed = meta ? JSON.parse(meta) : {}; } catch { parsed = { previousMetadata: String(meta) }; }
    parsed.evidenceArtifact = EVIDENCE_JSON;
    parsed.evidenceReport = EVIDENCE_MD;
    parsed.verifiedAt = new Date().toISOString();
    parsed.verifiedBy = 'hermes-worker';
    parsed.blockingGate = 'SHOPIFY_AUTH_REQUIRED';

    updateTask.run(
      'Verification executed by Hermes worker — see evidence event.',
      BLOCKER,
      'Shopify authentication required (SHOPIFY_AUTH_REQUIRED).',
      RESULT_TEXT,
      'failed',
      'blocked',
      new Date().toISOString(),
      JSON.stringify(parsed),
      t.task_id
    );
  }
});
run();

console.log('--- AFTER ---');
for (const t of db.prepare(
  "SELECT task_id, status, verification_state, blocker, substr(result_text,1,80) rt, progress_message FROM background_tasks WHERE objective LIKE '%channel verification%'"
).all()) {
  console.log('  ' + JSON.stringify(t));
}
console.log('EVIDENCE EVENTS: ' + db.prepare(
  "SELECT COUNT(*) n FROM background_task_events WHERE task_id IN (SELECT task_id FROM background_tasks WHERE objective LIKE '%channel verification%') AND summary LIKE '[EVIDENCE]%'"
).get().n);
db.close();
