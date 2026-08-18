// Create G3 (run_once) + H3 (skip) misfire routines, then print IDs + timestamp.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const API = 'http://127.0.0.1:4000/api';
async function post(path, body) { const r = await fetch(`${API}${path}`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) }); return await r.json().catch(()=>({})); }
const Database = require('B:/AgenticOS/server/node_modules/better-sqlite3');
const db = new Database('C:/Users/Cris/AppData/Roaming/agenticos/data/agentic-os.db');

const proj = await post('/projects', { name: `Misfire2 ${Date.now()}`, tags: ['acceptance'] });
const projectId = proj.id;
const G3 = await post('/routines', { projectId, name: 'Misfire RunOnce G3', objective: 'Answer in one word: what is 2+2?', worker: 'hermes', cronExpression: '* * * * *', enabled: true });
const H3 = await post('/routines', { projectId, name: 'Misfire Skip H3', objective: 'Answer in one word: what is 2+3?', worker: 'hermes', cronExpression: '* * * * *', enabled: true });
db.prepare('UPDATE schedules SET misfire_policy=? WHERE id=?').run('skip', H3.scheduleId);
console.log('G3_ROUTINE=' + G3.routineId + ' G3_SCHEDULE=' + G3.scheduleId);
console.log('H3_ROUTINE=' + H3.routineId + ' H3_SCHEDULE=' + H3.scheduleId);
console.log('NOW=' + new Date().toISOString());
console.log('G3_CREATED=' + db.prepare('SELECT created_at FROM schedules WHERE id=?').get(G3.scheduleId).created_at);
db.close();
