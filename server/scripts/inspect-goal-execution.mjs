import Database from 'better-sqlite3';

const db = new Database('C:/Users/cd-pr/AppData/Roaming/agenticos/data/agentic-os.db', { readonly: true });

console.log('=== TASK 24 ===');
const task = db.prepare("SELECT * FROM background_tasks WHERE task_id = 'bgtask-24a2c4fa7'").get();
console.log(JSON.stringify(task, null, 2));

console.log('\n=== GOAL 912a85b9- ===');
const goal = db.prepare("SELECT * FROM goals WHERE id = 'goal-912a85b9-'").get();
console.log(JSON.stringify(goal, null, 2));

console.log('\n=== CHECKPOINTS FOR GOAL 912a85b9- ===');
const checkpoints = db.prepare("SELECT id, step_index, goal_status, execution_phase, changed_files, created_at FROM goal_checkpoints WHERE goal_id = 'goal-912a85b9-' ORDER BY step_index ASC").all();
console.log(`Found ${checkpoints.length} checkpoints:`);
console.log(JSON.stringify(checkpoints, null, 2));

console.log('\n=== ALL GOAL_EVENTS FOR goal-912a85b9- ===');
const events = db.prepare("SELECT sequence, timestamp, state, step, tool, file_path, command, message, error FROM goal_events WHERE goal_id = 'goal-912a85b9-' ORDER BY sequence ASC").all();
console.log(`Found ${events.length} events:`);
for (const e of events) {
  console.log(`[seq=${e.sequence} step=${e.step} state=${e.state} time=${e.timestamp}] tool=${e.tool || ''} file=${e.file_path || ''} cmd=${e.command || ''} msg=${(e.message || '').slice(0, 100)} err=${e.error || ''}`);
}

console.log('\n=== SELFHEAL INCIDENTS ===');
const incs = db.prepare("SELECT incident_id, goal_id, state, updated_at FROM selfheal_incidents WHERE incident_id IN ('SELFHEAL-2136', 'SELFHEAL-6158')").all();
console.log(JSON.stringify(incs, null, 2));

console.log('\n=== RECENT GOAL RUNS ===');
const runs = db.prepare("SELECT id, status, updated_at, run_summary FROM goals ORDER BY updated_at DESC LIMIT 5").all();
console.log(JSON.stringify(runs.map(r => ({ id: r.id, status: r.status, updated_at: r.updated_at })), null, 2));
