import Database from 'better-sqlite3';
const db = new Database('B:/AgenticOS/.agentos/runtime-tests/ui-real/test.db');
const results = db.prepare(`SELECT message, error, tool FROM goal_events WHERE agent_id = 'builder-1' ORDER BY timestamp DESC LIMIT 5`).all();
console.log(JSON.stringify(results, null, 2));
