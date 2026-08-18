const Database = require('better-sqlite3');
const dbPath = 'C:/Users/Cris/Desktop/desktop/Agentic_OS/Agentic OS/resources/server/data/agentic-os.db';
const db = new Database(dbPath);

const goalsWithProof = db.prepare("SELECT * FROM goals WHERE run_summary LIKE '%FILE CREATED%' OR original_goal LIKE '%FILE CREATED%'").all();
console.log('Goals matching FILE CREATED in packaged DB:', goalsWithProof.map(g => ({ id: g.id, status: g.status, run_summary: g.run_summary })));

const eventsWithProof = db.prepare("SELECT * FROM goal_events WHERE message LIKE '%FILE CREATED%' OR payload LIKE '%FILE CREATED%'").all();
console.log('Events matching FILE CREATED in packaged DB:', eventsWithProof.map(e => ({ goalId: e.goal_id, seq: e.sequence, msg: e.message?.slice(0, 100) })));
