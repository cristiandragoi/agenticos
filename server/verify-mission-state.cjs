const Database = require('better-sqlite3');
const fs = require('fs');

function check(label, path) {
  if (!fs.existsSync(path)) { console.log(`${label}: FILE NOT FOUND (${path})`); return; }
  const db = new Database(path, { readonly: true });
  const mission = db.prepare("SELECT id, title, status FROM revenue_missions WHERE id LIKE 'mission-616808fe-%'").get();
  if (!mission) { console.log(`${label}: mission not found`); db.close(); return; }
  const counts = db.prepare("SELECT engine, COUNT(*) c FROM revenue_experiments WHERE mission_id = ? GROUP BY engine").all(mission.id);
  const dp = counts.find(r => r.engine === 'digital_products')?.c || 0;
  const sme = counts.find(r => r.engine === 'german_sme')?.c || 0;
  const gates = db.prepare("SELECT COUNT(*) c FROM revenue_human_gates WHERE experiment_id IN (SELECT id FROM revenue_experiments WHERE mission_id = ?)").get(mission.id).c;
  console.log(`${label}:`);
  console.log(`  mission: ${mission.id} (${mission.title})`);
  console.log(`  status: ${mission.status}`);
  console.log(`  Digital: ${dp} | SME: ${sme} | Gates: ${gates}`);
  db.close();
}

check('DEV DB    ', 'B:/AgenticOS/server/data/agentic-os.db');
check('ROAMING DB', 'C:/Users/Cris/AppData/Roaming/agenticos/data/agentic-os.db');
