import Database from 'better-sqlite3';

const db = new Database('C:/Users/cd-pr/AppData/Roaming/agenticos/data/agentic-os.db', { readonly: true });

console.log('=== REPAIR INCIDENTS ===');
const incs = db.prepare("SELECT id, status, component, goal_id, resolved_at FROM repair_incidents WHERE id IN ('SELFHEAL-2136', 'SELFHEAL-6158')").all();
console.log(JSON.stringify(incs, null, 2));

console.log('\n=== ARGUS VERIFICATIONS (recent 5) ===');
const argus = db.prepare("SELECT * FROM argus_verifications ORDER BY created_at DESC LIMIT 5").all();
console.log(JSON.stringify(argus, null, 2));
