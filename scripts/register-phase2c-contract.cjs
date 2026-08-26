const path = require('path');
const Database = require(path.resolve(__dirname, '../server/node_modules/better-sqlite3'));
const crypto = require('crypto');
const fs = require('fs');

console.log('=== REGISTERING EXPANDED ARGUS PHASE 2C TASK CONTRACT ===\n');

const DB_PATH = path.resolve(__dirname, '../server/data/agentic-os.db');
const db = new Database(DB_PATH);

const goalId = 'goal-revenue-phase2c-';
const contractId = 'argus-revenue-phase2c-';
const title = 'Revenue Operator Phase 2C — Expanded ARGUS Task Contract (master)';
const originalSpec = fs.readFileSync('B:/AgenticOS/docs/argus-contracts/revenue-operator-phase2c.md', 'utf8');

const criteria = [
  {
    type: 'file-exists',
    path: 'docs/argus-contracts/revenue-operator-phase2c.md',
  },
  {
    type: 'command',
    command: 'node',
    args: ['scripts/verify-capability-routing.cjs'],
    timeoutMs: 120000,
    expectExit: 0,
    evidenceLevel: 'L4',
  },
  {
    type: 'command',
    command: 'node',
    args: ['scripts/verify-natural-scheduler.cjs'],
    timeoutMs: 120000,
    expectExit: 0,
    evidenceLevel: 'L5',
  },
  {
    type: 'command',
    command: 'node',
    args: ['scripts/verify-gate-autoresume.cjs'],
    timeoutMs: 120000,
    expectExit: 0,
    evidenceLevel: 'L5',
  },
  {
    type: 'command',
    command: 'node',
    args: ['scripts/verify-briefing-deduplication.cjs'],
    timeoutMs: 180000,
    expectExit: 0,
    evidenceLevel: 'L5',
  },
  {
    type: 'command',
    command: 'node',
    args: ['scripts/verify-supervisor-controls.cjs'],
    timeoutMs: 120000,
    expectExit: 0,
    evidenceLevel: 'L5',
  },
  {
    type: 'command',
    command: 'node',
    args: ['scripts/verify-codex-dom-click.cjs'],
    timeoutMs: 180000,
    expectExit: 0,
    evidenceLevel: 'L5',
  },
  {
    type: 'command',
    command: 'node',
    args: ['scripts/revenue-operator-verify.cjs'],
    timeoutMs: 420000,
    expectExit: 0,
    evidenceLevel: 'L5',
  },
];

const specHash = crypto.createHash('sha256')
  .update(originalSpec)
  .update('\u0000')
  .update(JSON.stringify(criteria))
  .digest('hex');

const now = new Date().toISOString();

// 1. Insert/Update Project Goal
const existingGoal = db.prepare('SELECT id FROM project_goals WHERE id = ?').get(goalId);
if (!existingGoal) {
  db.prepare(`
    INSERT INTO project_goals (id, project_id, title, objective, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(goalId, 'proj-default', title, originalSpec, 'in_progress', now, now);
  console.log(`- Created project_goal: ${goalId}`);
}

// 2. Insert/Update ARGUS Contract
db.prepare('DELETE FROM argus_contracts WHERE id = ? OR goal_id = ?').run(contractId, goalId);
db.prepare(`
  INSERT INTO argus_contracts (id, goal_id, workspace_path, title, original_spec, acceptance_criteria, spec_hash, status, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`).run(contractId, goalId, 'B:/AgenticOS', title, originalSpec, JSON.stringify(criteria), specHash, 'implementation_ready', now, now);

console.log(`- Registered expanded ARGUS contract: ${contractId} (specHash: ${specHash.slice(0, 16)}...)`);

// Also sync to Roaming DB
const ROAMING_DB_PATH = 'C:/Users/Cris/AppData/Roaming/agenticos/data/agentic-os.db';
if (fs.existsSync(ROAMING_DB_PATH)) {
  const db2 = new Database(ROAMING_DB_PATH);
  db2.prepare('DELETE FROM argus_contracts WHERE id = ? OR goal_id = ?').run(contractId, goalId);
  db2.prepare(`
    INSERT INTO argus_contracts (id, goal_id, workspace_path, title, original_spec, acceptance_criteria, spec_hash, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(contractId, goalId, 'B:/AgenticOS', title, originalSpec, JSON.stringify(criteria), specHash, 'implementation_ready', now, now);
  console.log(`- Synced to Roaming DB: ${contractId}`);
  db2.close();
}

db.close();
console.log('\nCONTRACT REGISTRATION COMPLETE');
