const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const dbPaths = [
  'D:/AgenticOS/server/data/agentic-os.db',
  process.env.APPDATA + '/agenticos/data/agentic-os.db',
];

for (const dbPath of dbPaths) {
  if (!fs.existsSync(dbPath)) continue;
  console.log(`\n=== Checking DB: ${dbPath} ===`);
  const db = new Database(dbPath);

  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='repair_incidents'").all();
  if (tables.length === 0) {
    console.log('No repair_incidents table in this DB. Skipping.');
    continue;
  }

  // 1. Ensure goal_id column exists
  const pragma = db.prepare('PRAGMA table_info(repair_incidents)').all();
  const cols = new Set(pragma.map(c => c.name));
  if (!cols.has('goal_id')) {
    console.log('Adding column goal_id to repair_incidents...');
    db.exec('ALTER TABLE repair_incidents ADD COLUMN goal_id TEXT;');
  } else {
    console.log('Column goal_id already exists.');
  }

  // 2. Migrate SELFHEAL-2136
  const inc2136 = db.prepare("SELECT * FROM repair_incidents WHERE id = 'SELFHEAL-2136'").get();
  if (inc2136) {
    let meta = {};
    try { meta = typeof inc2136.metadata === 'string' ? JSON.parse(inc2136.metadata) : (inc2136.metadata || {}); } catch {}
    meta.goalId = 'goal-1790545900080-d92z0';
    meta.restoredAt = new Date().toISOString();
    meta.restorationReason = 'Restored by architectural SelfHeal root-cause fix (defect-based classification & durable GoalRun link).';

    db.prepare(`
      UPDATE repair_incidents
      SET goal_id = 'goal-1790545900080-d92z0',
          status = 'RECOVERABLE',
          metadata = ?
      WHERE id = 'SELFHEAL-2136'
    `).run(JSON.stringify(meta));
    console.log('SELFHEAL-2136 updated to RECOVERABLE with goalId: goal-1790545900080-d92z0');
  }

  // 3. Migrate SELFHEAL-6158
  const inc6158 = db.prepare("SELECT * FROM repair_incidents WHERE id = 'SELFHEAL-6158'").get();
  if (inc6158) {
    let meta = {};
    try { meta = typeof inc6158.metadata === 'string' ? JSON.parse(inc6158.metadata) : (inc6158.metadata || {}); } catch {}
    meta.goalId = 'goal-1790545872590-8rsyl';
    meta.restoredAt = new Date().toISOString();
    meta.restorationReason = 'Restored by architectural SelfHeal root-cause fix (defect-based classification & durable GoalRun link).';

    db.prepare(`
      UPDATE repair_incidents
      SET goal_id = 'goal-1790545872590-8rsyl',
          status = 'RECOVERABLE',
          metadata = ?
      WHERE id = 'SELFHEAL-6158'
    `).run(JSON.stringify(meta));
    console.log('SELFHEAL-6158 updated to RECOVERABLE with goalId: goal-1790545872590-8rsyl');
  }

  // 4. Update originating GoalRuns if goal_runs table exists
  const grTables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='goal_runs'").all();
  if (grTables.length > 0) {
    const now = new Date().toISOString();
    db.prepare(`
      UPDATE goal_runs
      SET status = 'RECOVERABLE',
          updated_at = ?
      WHERE goal_id IN ('goal-1790545900080-d92z0', 'goal-1790545872590-8rsyl')
    `).run(now);
    console.log('Originating goal runs updated to RECOVERABLE.');
  }
}
console.log('\nMigration complete.');
