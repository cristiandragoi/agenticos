// register-phase2d-contract.cjs — registers the Phase 2D ARGUS contract
// (goal + contract + deterministic command checks) in DEV + Roaming DB.
// Checks are deterministic (no real LLM); the real Hermes/CodeX acceptance
// evidence is read from the persisted trace by verify-phase2d-acceptance-evidence.cjs.
const path = require('path');
const Database = require(path.resolve(__dirname, '../server/node_modules/better-sqlite3'));
const crypto = require('crypto');
const fs = require('fs');

console.log('=== REGISTERING ARGUS PHASE 2D TASK CONTRACT ===\n');

const DB_PATH = path.resolve(__dirname, '../server/data/agentic-os.db');
const db = new Database(DB_PATH);

const goalId = 'goal-revenue-phase2d-';
const contractId = 'argus-revenue-phase2d-';
const title = 'Revenue Operator Phase 2D — Real Execution Bridge (master)';
const originalSpec = fs.readFileSync('B:/AgenticOS/docs/argus-contracts/revenue-operator-phase2d.md', 'utf8');

const criteria = [
  { type: 'file-exists', path: 'docs/argus-contracts/revenue-operator-phase2d.md' },
  { type: 'file-exists', path: 'server/src/services/revenueOperator/executorSelection.ts' },
  { type: 'file-exists', path: 'server/src/services/revenueOperator/actionResolver.ts' },
  { type: 'file-exists', path: 'server/src/services/revenueOperator/branchScheduler.ts' },
  { type: 'file-exists', path: 'server/src/services/revenueOperator/revenueActionExecutor.ts' },
  {
    type: 'command',
    command: 'node',
    args: ['scripts/verify-phase2d-wiring.cjs'],
    timeoutMs: 120000,
    expectExit: 0,
    evidenceLevel: 'L4',
  },
  {
    type: 'command',
    command: 'node',
    args: ['scripts/verify-phase2d-acceptance-evidence.cjs'],
    timeoutMs: 120000,
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

function register(targetDb, label) {
  targetDb.prepare('DELETE FROM argus_contracts WHERE id = ? OR goal_id = ?').run(contractId, goalId);
  const existingGoal = targetDb.prepare('SELECT id FROM project_goals WHERE id = ?').get(goalId);
  if (!existingGoal) {
    targetDb.prepare(`
      INSERT INTO project_goals (id, project_id, title, objective, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(goalId, 'proj-default', title, originalSpec, 'in_progress', now, now);
  }
  targetDb.prepare(`
    INSERT INTO argus_contracts (id, goal_id, workspace_path, title, original_spec, acceptance_criteria, spec_hash, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(contractId, goalId, 'B:/AgenticOS', title, originalSpec, JSON.stringify(criteria), specHash, 'implementation_ready', now, now);
  console.log(`- Registered ${contractId} in ${label} (specHash ${specHash.slice(0, 16)}...)`);
}

register(db, 'DEV');
db.close();

const ROAMING_DB_PATH = 'C:/Users/Cris/AppData/Roaming/agenticos/data/agentic-os.db';
if (fs.existsSync(ROAMING_DB_PATH)) {
  const db2 = new Database(ROAMING_DB_PATH);
  register(db2, 'Roaming');
  db2.close();
}

console.log('\nCONTRACT REGISTRATION COMPLETE');
