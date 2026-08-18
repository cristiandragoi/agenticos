// F/G/H setup — create three per-minute hermes routines, then stop the app.
// F = restoration proof (default run_once, will be re-verified after restart)
// G = misfire run_once
// H = misfire skip (set via direct SQL on the schedule, since createRoutine
//      hardcodes run_once; the schema + scheduler already honor the column)
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const API = 'http://127.0.0.1:4000/api';
async function post(path, body) { const r = await fetch(`${API}${path}`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) }); return await r.json().catch(()=>({})); }

const Database = require('B:/AgenticOS/server/node_modules/better-sqlite3');
const db = new Database('C:/Users/Cris/AppData/Roaming/agenticos/data/agentic-os.db');

const proj = await post('/projects', { name: `Restart/Misfire ${Date.now()}`, tags: ['acceptance'] });
const projectId = proj.id;
const objective = 'Answer in one word: what is 2+2?';

async function makeRoutine(name, misfirePolicy) {
  const r = await post('/routines', { projectId, name, objective, worker: 'hermes', cronExpression: '* * * * *', enabled: true });
  if (misfirePolicy === 'skip') {
    db.prepare('UPDATE schedules SET misfire_policy=? WHERE id=?').run('skip', r.scheduleId);
  }
  return r;
}

const F = await makeRoutine('Restart Smoke F', 'run_once');
const G = await makeRoutine('Misfire RunOnce G', 'run_once');
const H = await makeRoutine('Misfire Skip H', 'skip');

console.log('F_ROUTINE=' + F.routineId + ' F_SCHEDULE=' + F.scheduleId);
console.log('G_ROUTINE=' + G.routineId + ' G_SCHEDULE=' + G.scheduleId);
console.log('H_ROUTINE=' + H.routineId + ' H_SCHEDULE=' + H.scheduleId);
console.log('H_MISFIRE_POLICY=' + db.prepare('SELECT misfire_policy FROM schedules WHERE id=?').get(H.scheduleId).misfire_policy);
db.close();
