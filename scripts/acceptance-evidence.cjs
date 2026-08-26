// acceptance-evidence.cjs — DB evidence extraction for the live acceptance report.
// Reads .acceptance-state.json, then (read-only) pulls from the DEPLOYED DB:
//   - exact delegated CodeX prompt (goals.original_goal)
//   - message/verdict evidence
//   - duplicate worker-result count
const fs = require('fs');
const Database = require('B:/AgenticOS/server/node_modules/better-sqlite3');
const DB = process.argv[2] || 'C:/Users/Cris/AppData/Roaming/agenticos/data/agentic-os.db';
const STATE = 'B:/AgenticOS/scripts/.acceptance-state.json';

const state = JSON.parse(fs.readFileSync(STATE, 'utf8'));
const convId = state.convId;
const step1GoalId = state.step1?.goalId || null;
const step2GoalId = state.step2?.verificationGoalId || null;
console.log('CONV_ID:', convId);
console.log('step1 goalId:', step1GoalId, '| step2 (verification) goalId:', step2GoalId);

const db = new Database(DB, { readonly: true, fileMustExist: true });
try {
  // Goals for this conversation (original_goal = exact delegated CodeX prompt).
  const goals = db.prepare('SELECT id, status, original_goal, created_at FROM goals WHERE conversation_id = ? ORDER BY created_at ASC').all(convId);
  console.log('\n=== GOALS in conversation (', goals.length, ') ===');
  for (const g of goals) {
    console.log(`\n--- goal ${g.id} [${g.status}] ---`);
    console.log('original_goal (exact delegated CodeX prompt):\n' + g.original_goal);
  }

  // Messages.
  const msgs = db.prepare('SELECT id, role, routed_agent, goal_id, metadata, created_at, length(content) AS clen, substr(content,1,250) AS preview FROM conversation_messages WHERE conversation_id = ? ORDER BY created_at ASC').all(convId);
  console.log('\n=== MESSAGES (', msgs.length, ') ===');
  for (const m of msgs) {
    let meta = {};
    try { meta = JSON.parse(m.metadata || '{}'); } catch {}
    console.log(JSON.stringify({
      id: m.id, role: m.role, routed_agent: m.routed_agent, goal_id: m.goal_id,
      category: meta.category, workerResult: !!meta.workerResult, groundedEvidence: !!meta.groundedEvidence,
      referencedGoalId: meta.referencedGoalId, findingsCount: meta.findingsCount, intentType: meta.intent?.type,
      clen: m.clen, preview: m.preview,
    }));
  }

  // Duplicate worker-result count.
  const dups = db.prepare("SELECT COUNT(*) AS n FROM conversation_messages WHERE conversation_id = ? AND metadata LIKE '%\"workerResult\":true%'").get(convId).n;
  const grounded = db.prepare("SELECT COUNT(*) AS n FROM conversation_messages WHERE conversation_id = ? AND metadata LIKE '%\"groundedEvidence\":true%'").get(convId).n;
  console.log('\n=== DUPLICATE-CHECK ===');
  console.log('messages with workerResult=true:', dups);
  console.log('messages with groundedEvidence=true:', grounded);
} finally {
  db.close();
}
