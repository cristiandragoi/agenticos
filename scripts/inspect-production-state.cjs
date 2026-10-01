const Database = require('better-sqlite3');
const path = require('node:path');

const dbPath = path.resolve(__dirname, '../server/data/agentic-os.db');
console.log('Inspecting DB at:', dbPath);
const db = new Database(dbPath);

const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
console.log('Tables:', tables.map(t => t.name).join(', '));

if (tables.some(t => t.name === 'repairIncidents')) {
  const counts = db.prepare('SELECT status, count(*) as count FROM repairIncidents GROUP BY status').all();
  console.log('\n--- repairIncidents by status ---');
  console.table(counts);

  const sample = db.prepare('SELECT id, status, failureCategory, createdAt, resolvedAt FROM repairIncidents ORDER BY createdAt DESC LIMIT 15').all();
  console.log('\n--- Recent 15 incidents ---');
  console.table(sample);
}

if (tables.some(t => t.name === 'approvals')) {
  const approvalCounts = db.prepare('SELECT status, count(*) as count FROM approvals GROUP BY status').all();
  console.log('\n--- Approvals by status ---');
  console.table(approvalCounts);
  const sample = db.prepare('SELECT id, runId, status, createdAt FROM approvals LIMIT 10').all();
  console.table(sample);
}

if (tables.some(t => t.name === 'goals')) {
  const goalCounts = db.prepare('SELECT status, count(*) as count FROM goals GROUP BY status').all();
  console.log('\n--- Goals by status ---');
  console.table(goalCounts);
}
