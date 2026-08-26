// check-orphans.cjs — read-only orphan check on the Roaming canonical DB.
const Database = require('B:/AgenticOS/server/node_modules/better-sqlite3');
const db = new Database('C:/Users/Cris/AppData/Roaming/agenticos/data/agentic-os.db', { readonly: true });

const runningRuns = db.prepare("SELECT COUNT(*) n FROM execution_runs WHERE status = 'running'").get().n;
const runningRunsRows = db.prepare("SELECT id, task_id FROM execution_runs WHERE status = 'running' LIMIT 10").all();

// Codex goals that are mid-flight (not terminal, not waiting_for_approval).
const inFlightGoals = db.prepare("SELECT id, status, updated_at FROM goals WHERE status IN ('running','executing','queued','planning','reasoning','retrying') ORDER BY updated_at DESC LIMIT 10").all();

const waitingGoals = db.prepare("SELECT id, status, updated_at FROM goals WHERE status = 'waiting_for_approval' ORDER BY updated_at DESC LIMIT 10").all();

console.log('running execution_runs:', runningRuns);
if (runningRunsRows.length) console.log(JSON.stringify(runningRunsRows, null, 2));
console.log('in-flight goals:', inFlightGoals.length, inFlightGoals.length ? JSON.stringify(inFlightGoals) : '(none)');
console.log('waiting_for_approval goals:', waitingGoals.length, waitingGoals.length ? JSON.stringify(waitingGoals) : '(none)');

const ok = runningRuns === 0 && inFlightGoals.length === 0;
console.log('\n=== ORPHAN CHECK', ok ? 'PASS' : 'FAIL', '===');
db.close();
process.exit(ok ? 0 : 2);
