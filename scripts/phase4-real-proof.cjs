// phase4-real-proof.cjs — read-only extraction of the real-LLM acceptance proof
// from the Roaming (live) DB. No mutations.
const Database = require('B:/AgenticOS/server/node_modules/better-sqlite3');
const ROAMING = 'C:/Users/Cris/AppData/Roaming/agenticos/data/agentic-os.db';
const db = new Database(ROAMING, { readonly: true });

function tables() { return db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(r => r.name); }
const t = tables();

console.log('=== maintenance_change_sets (recent) ===');
const mcs = db.prepare("SELECT * FROM maintenance_change_sets ORDER BY updated_at DESC LIMIT 3").all();
for (const r of mcs) console.log(JSON.stringify(r, null, 2));

console.log('\n=== goals (recent, codex repair) ===');
const goals = db.prepare("SELECT id,status,workspace_path,created_at,updated_at FROM goals ORDER BY rowid DESC LIMIT 5").all();
for (const g of goals) console.log(JSON.stringify(g));

console.log('\n=== execution_runs (recent hermes) ===');
try {
  const cols = db.prepare("PRAGMA table_info(execution_runs)").all().map(c=>c.name);
  console.log('cols:', cols.join(','));
  const runs = db.prepare("SELECT * FROM execution_runs ORDER BY rowid DESC LIMIT 6").all();
  for (const r of runs) {
    console.log(JSON.stringify({id:r.id, status:r.status, workerType:r.worker_type||r.workerType, taskId:r.task_id||r.taskId, goalId:r.goal_id||r.goalId, finalResultId:r.final_result_id||r.finalResultId, provider:r.provider, model:r.model, startTime:r.start_time||r.startTime, endTime:r.end_time||r.endTime}));
  }
} catch(e) { console.log('runs err', e.message); }

console.log('\n=== execution_results (recent) ===');
try {
  const cols = db.prepare("PRAGMA table_info(execution_results)").all().map(c=>c.name);
  console.log('cols:', cols.join(','));
  const res = db.prepare("SELECT * FROM execution_results ORDER BY rowid DESC LIMIT 6").all();
  for (const r of res) {
    const so = r.structured_output || r.structuredOutput || '';
    let summary = r.summary || '';
    console.log(JSON.stringify({id:r.id, status:r.status, runId:r.run_id||r.runId, taskId:r.task_id||r.taskId, summary: String(summary).slice(0,180), structuredKeys: (()=>{try{return Object.keys(JSON.parse(so))}catch{return '(unparsed)'}})()}));
  }
} catch(e) { console.log('results err', e.message); }

console.log('\n=== conversation messages (conv-fcf6c9a8-) ===');
try {
  const rows = db.prepare("SELECT id, role, message_type, content, metadata FROM conversation_messages WHERE conversation_id = ? ORDER BY rowid ASC").all('conv-fcf6c9a8-');
  for (const r of rows) {
    console.log('\n---', r.role, r.message_type || '', '---');
    console.log(String(r.content || '').slice(0, 600));
    if (r.metadata) console.log('meta:', String(r.metadata).slice(0, 500));
  }
} catch(e) { console.log('conv err', e.message); }

db.close();
console.log('\nDONE (read-only)');
