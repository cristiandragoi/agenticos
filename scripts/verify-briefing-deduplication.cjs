const path = require('path');
const Database = require(path.resolve(__dirname, '../server/node_modules/better-sqlite3'));

console.log('=== BRIEFING DEDUPLICATION & IDEMPOTENCY VERIFIER ===\n');

const { setupIsolatedFixture } = require('./argus-fixture.cjs');
const DB_PATH = setupIsolatedFixture();
const db = new Database(DB_PATH);

const MISSION_ID = 'mission-616808fe-';

function utcWeekKey(now = new Date()) {
  const daysSinceMonday = (now.getUTCDay() + 6) % 7; // Mon=0..Sun=6
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysSinceMonday)).toISOString().slice(0, 10);
}

async function run() {
  const { dispatchScheduledExecution } = await import('../server/dist/services/scheduler/scheduleDispatcher.js');
  const { RevenueBriefingService } = await import('../server/dist/services/revenueOperator/briefingService.js');

  const dateKey = new Date().toISOString().slice(0, 10);
  const weekKey = utcWeekKey();
  const dailyKey = `daily-briefing-${MISSION_ID}-${dateKey}`;
  const weeklyKey = `weekly-briefing-${MISSION_ID}-${weekKey}`;
  console.log(`- Daily idempotency key (today):   ${dailyKey}`);
  console.log(`- Weekly idempotency key (Monday): ${weeklyKey}\n`);

  // Cleanup: remove legacy weekly briefings keyed by a non-Monday date (buggy
  // day-based weekly idempotency from the previous implementation).
  const legacyWeekly = db.prepare("SELECT id, idempotency_key FROM revenue_briefings WHERE type='weekly' AND idempotency_key != ?").all(weeklyKey);
  if (legacyWeekly.length) {
    for (const r of legacyWeekly) {
      db.prepare('DELETE FROM revenue_briefings WHERE id = ?').run(r.id);
      console.log(`- Removed legacy day-based weekly briefing artifact: ${r.id} (${r.idempotency_key})`);
    }
  } else {
    console.log('- No legacy weekly briefing artifacts to clean.');
  }

  function getScheduleFireRecord(scheduleId) {
    const row = db.prepare('SELECT * FROM schedules WHERE id = ?').get(scheduleId);
    return {
      id: row.id, taskId: row.task_id,
      executionType: row.execution_type ?? 'worker_task',
      routineId: row.routine_id ?? null, worker: row.worker ?? 'hermes',
      projectId: row.project_id ?? 'proj-default',
      taskTemplate: row.task_template ? JSON.parse(row.task_template) : null,
      cronExpression: row.cron_expression ?? null, timezone: row.timezone ?? 'UTC',
      misfirePolicy: row.misfire_policy ?? 'run_once', enabled: !!row.enabled,
      createdAt: row.created_at ?? null, lastTriggeredAt: row.last_triggered_at ?? null,
    };
  }

  // ── Daily: same period twice ───────────────────────────────────────────────
  console.log('\n[1/4] Daily briefing — executing the same daily period TWICE via canonical scheduler routine...');
  const dailySched = getScheduleFireRecord('schedule-revenue-daily-briefing');
  const dailyRes1 = await dispatchScheduledExecution(dailySched, 'manual');
  const dailyRes2 = await dispatchScheduledExecution(dailySched, 'manual');
  console.log(`- Daily exec 1: execution=${dailyRes1.provenance.executionId}, task=${dailyRes1.provenance.projectTaskId}, run=${dailyRes1.provenance.runId}, result=${dailyRes1.provenance.resultId}`);
  console.log(`- Daily exec 2: execution=${dailyRes2.provenance.executionId}, task=${dailyRes2.provenance.projectTaskId}, run=${dailyRes2.provenance.runId}, result=${dailyRes2.provenance.resultId}`);

  // ── Weekly: same period twice ──────────────────────────────────────────────
  console.log('\n[2/4] Weekly briefing — executing the same weekly period TWICE via canonical scheduler routine...');
  const weeklySched = getScheduleFireRecord('schedule-revenue-weekly-briefing');
  const weeklyRes1 = await dispatchScheduledExecution(weeklySched, 'manual');
  const weeklyRes2 = await dispatchScheduledExecution(weeklySched, 'manual');
  console.log(`- Weekly exec 1: execution=${weeklyRes1.provenance.executionId}, task=${weeklyRes1.provenance.projectTaskId}, run=${weeklyRes1.provenance.runId}, result=${weeklyRes1.provenance.resultId}`);
  console.log(`- Weekly exec 2: execution=${weeklyRes2.provenance.executionId}, task=${weeklyRes2.provenance.projectTaskId}, run=${weeklyRes2.provenance.runId}, result=${weeklyRes2.provenance.resultId}`);

  // ── Reload service state + reconcile again ─────────────────────────────────
  console.log('\n[3/4] Reloading briefing service state and reconciling a third time...');
  const fresh = new RevenueBriefingService();
  await fresh.generateBriefing(MISSION_ID, 'daily');
  await fresh.generateBriefing(MISSION_ID, 'weekly');
  console.log('- Fresh service instance re-executed daily + weekly.');

  // ── Count queries ──────────────────────────────────────────────────────────
  console.log('\n[4/4] Exact canonical database count queries:');
  const dailyCount = db.prepare("SELECT COUNT(*) c FROM revenue_briefings WHERE idempotency_key = ?").get(dailyKey).c;
  const weeklyCount = db.prepare("SELECT COUNT(*) c FROM revenue_briefings WHERE idempotency_key = ?").get(weeklyKey).c;
  const dailyAll = db.prepare("SELECT COUNT(*) c FROM revenue_briefings WHERE type='daily' AND mission_id = ?").get(MISSION_ID).c;
  const weeklyAll = db.prepare("SELECT COUNT(*) c FROM revenue_briefings WHERE type='weekly' AND mission_id = ?").get(MISSION_ID).c;
  console.log(`  SELECT COUNT(*) FROM revenue_briefings WHERE idempotency_key = '${dailyKey}'  -> ${dailyCount}`);
  console.log(`  SELECT COUNT(*) FROM revenue_briefings WHERE idempotency_key = '${weeklyKey}' -> ${weeklyCount}`);
  console.log(`  (all-time daily=${dailyAll}, all-time weekly=${weeklyAll})`);

  const dailyRow = db.prepare("SELECT id, type, idempotency_key, created_at FROM revenue_briefings WHERE idempotency_key = ?").get(dailyKey);
  const weeklyRow = db.prepare("SELECT id, type, idempotency_key, created_at FROM revenue_briefings WHERE idempotency_key = ?").get(weeklyKey);
  console.log(`- Daily artifact/evidence:   id=${dailyRow?.id}, type=${dailyRow?.type}, key=${dailyRow?.idempotency_key}`);
  console.log(`- Weekly artifact/evidence:  id=${weeklyRow?.id}, type=${weeklyRow?.type}, key=${weeklyRow?.idempotency_key}`);

  const checks = [
    ['Daily briefing count for this period is exactly 1 (after 3 executions)', dailyCount === 1],
    ['Weekly briefing count for this period is exactly 1 (after 3 executions)', weeklyCount === 1],
    ['Daily idempotency key matches day format', dailyKey.startsWith('daily-briefing-') && dailyKey.endsWith(dateKey)],
    ['Weekly idempotency key matches week (Monday) format', weeklyKey.startsWith('weekly-briefing-') && weeklyKey.endsWith(weekKey)],
  ];
  console.log('\nAssertions:');
  for (const [label, ok] of checks) {
    console.log(`- [${ok ? 'PASS' : 'FAIL'}] ${label}`);
    if (!ok) { db.close(); throw new Error(label); }
  }

  db.close();
  console.log('\nBRIEFING DEDUPLICATION VERIFIED: DAILY=1, WEEKLY=1');
  process.exit(0);
}

run().catch(err => { console.error('Briefing dedup verifier error:', err); try { db.close(); } catch {} process.exit(1); });
