// inspect-phase2-goal.cjs — dump goal steps/events + temp file state for a completed goal.
const Database = require('B:/AgenticOS/server/node_modules/better-sqlite3');
const fs = require('fs');

const DEV_DB = 'C:/Users/Cris/AppData/Local/Temp/agenticos-devtest/agentic-os.db';
const goalId = process.argv[2] || 'goal-170a82b7-';

const db = new Database(DEV_DB, { readonly: true });
const goal = db.prepare('SELECT id, status, run_summary, workspace_path FROM goals WHERE id = ?').get(goalId);
console.log('=== goal', goalId, 'status=', goal && goal.status, '===');
if (goal && goal.run_summary) {
  let s = goal.run_summary; try { s = JSON.parse(s); } catch {}
  console.log('--- run_summary.finalAnswer ---');
  console.log((s && (s.finalAnswer || s.message)) || '(none)');
}

console.log('\n=== goal_steps (all rows) ===');
const steps = db.prepare('SELECT step_number, status, tool_call, substr(tool_result,1,80) AS result_head FROM goal_steps WHERE goal_id = ? ORDER BY step_number').all(goalId);
console.log('step count:', steps.length);
for (const st of steps) {
  let tc = st.tool_call; try { tc = typeof tc === 'string' ? JSON.parse(tc) : tc; } catch {}
  const tool = tc && tc.tool; const path = tc && tc.arguments && (tc.arguments.path || tc.arguments.cmd);
  const startLine = tc && tc.arguments && tc.arguments.startLine;
  console.log(`  step ${st.step_number} [${st.status}] tool=${tool} path/cmd=${path} startLine=${startLine} result=${st.result_head}`);
}

console.log('\n=== goal_events (tool events) ===');
const evs = db.prepare('SELECT sequence, state, tool, message, provider, model FROM goal_events WHERE goal_id = ? AND tool IS NOT NULL ORDER BY sequence').all(goalId);
console.log('tool event count:', evs.length);
for (const e of evs) console.log(`  seq ${e.sequence} [${e.state}] ${e.tool}: ${(e.message||'').slice(0,70)}`);

db.close();

console.log('\n=== temp file state ===');
const tmpPath = 'B:/AgenticOS/server/src/__tests__/phase2AcceptanceTmp.test.ts';
console.log('exists:', fs.existsSync(tmpPath), tmpPath);
if (fs.existsSync(tmpPath)) { console.log('--- content ---'); console.log(fs.readFileSync(tmpPath, 'utf-8').slice(0, 500)); }

console.log('\n=== git status (does the repo have unrelated/leftover changes?) ===');
const { execSync } = require('child_process');
try { console.log(execSync('git status --short', { cwd: 'B:/AgenticOS', encoding: 'utf-8' }).slice(0, 1500)); } catch (e) { console.log('git error:', e.message); }
