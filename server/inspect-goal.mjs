import Database from 'better-sqlite3';
const db = new Database('C:/Users/Cris/AppData/Local/Temp/agenticos-devtest3/agentic-os.db', { readonly: true });

const goalId = 'goal-84c1f20e-';
console.log('=== GOAL STEPS (goal-84c1f20e-) ===');
const steps = db.prepare(`SELECT step_number, status, tool_call, tool_result FROM goal_steps WHERE goal_id = ? ORDER BY step_number`).all(goalId);
for (const st of steps) {
  let tc = st.tool_call || '';
  try { const j = JSON.parse(tc); tc = j.tool + ' ' + JSON.stringify(j.arguments || {}); } catch {}
  const tr = (st.tool_result || '').replace(/\s+/g, ' ').slice(0, 160);
  console.log(`step ${st.step_number} [${st.status}] ${tc}\n    -> ${tr}`);
}

console.log('\n=== GOAL SUMMARY ===');
const g = db.prepare(`SELECT status, provider, model, run_summary FROM goals WHERE id = ?`).get(goalId);
console.log('status:', g?.status, '| provider:', g?.provider, '| model:', g?.model);
console.log('run_summary:', (g?.run_summary || '').slice(0, 400));

console.log('\n=== ORPHAN CHECK (non-terminal runs/goals in dev DB) ===');
const runningGoals = db.prepare(`SELECT id, status FROM goals WHERE status IN ('queued','planning','executing','reasoning','validating','tool_started','tool_completed','waiting_for_approval','running')`).all();
console.log('non-terminal goals:', runningGoals.length, runningGoals.map(r => r.id + ':' + r.status).join(', ') || '(none)');
try {
  const runningTasks = db.prepare(`SELECT task_id, status FROM background_tasks WHERE status IN ('queued','planning','running','dispatching','waiting_approval')`).all();
  console.log('non-terminal background_tasks:', runningTasks.length, runningTasks.map(r => r.task_id + ':' + r.status).join(', ') || '(none)');
} catch (e) { console.log('bg tasks table check skipped:', e.message); }
db.close();
