import Database from 'better-sqlite3';
import path from 'node:path';

const roamingDataDir = path.join(process.env.APPDATA, 'agenticos', 'data');
const dbPath = path.join(roamingDataDir, 'agentic-os.db');
const db = new Database(dbPath);

console.log('--- RECONCILER DRAFT TEST ---');

// 1. Reconcile repair_incidents
const incidents = db.prepare('SELECT id, status, component, failure_domain, symptom, detected_at FROM repair_incidents').all();
console.log(`Total incidents to evaluate: ${incidents.length}`);

let resolvedCount = 0;
let supersededCount = 0;
let staleCount = 0;
let escalatedCount = 0;
let activeCount = 0;

const now = Date.now();
const ONE_HOUR_MS = 60 * 60 * 1000;

for (const inc of incidents) {
  const detectedMs = new Date(inc.detected_at).getTime();
  const ageMs = now - detectedMs;
  const isOld = ageMs > ONE_HOUR_MS;

  if (['COMPLETED', 'resolved', 'closed', 'MONITORING'].includes(inc.status)) {
    resolvedCount++;
  } else if (['BLOCKED_MODEL_UNAVAILABLE', 'BLOCKED_TEST_FAILURE', 'INVALID_MISCLASSIFIED', 'unresolved'].includes(inc.status)) {
    escalatedCount++;
  } else if (isOld) {
    staleCount++;
  } else {
    activeCount++;
  }
}

console.log(`Projected reconciliation:`);
console.log(`  RESOLVED: ${resolvedCount}`);
console.log(`  FAILED_ESCALATED: ${escalatedCount}`);
console.log(`  STALE / SUPERSEDED: ${staleCount}`);
console.log(`  ACTIVE / RECOVERING: ${activeCount}`);

// 2. Reconcile legacy goals
const staleGoals = db.prepare("SELECT id, status, original_goal FROM goals WHERE status = 'waiting_for_approval'").all();
console.log(`Stale waiting_for_approval goals: ${staleGoals.length}`);

// 3. Reconcile blocked background tasks
const deadBgTasks = db.prepare("SELECT task_id, status, blocker FROM background_tasks WHERE status = 'blocked' AND (blocker LIKE '%restart%' OR blocker LIKE '%run no longer exists%')").all();
console.log(`Dead restart-blocked background tasks: ${deadBgTasks.length}`);
