import Database from 'better-sqlite3';

const dbPath = 'C:/Users/cd-pr/AppData/Roaming/AgenticOS/data/agentic-os.db';
const db = new Database(dbPath);

console.log('=== TABLES IN DB ===');
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
console.log(tables.map(t => t.name).join(', '));

console.log('\n=== PROJECTS ===');
console.log(db.prepare("SELECT id, name, priority, status, revenue_vertical FROM projects").all());

console.log('\n=== ACTIVE PROJECT FILE ===');
import fs from 'fs';
const apf = 'C:/Users/cd-pr/AppData/Roaming/AgenticOS/data/active-project.json';
if (fs.existsSync(apf)) {
  console.log('active-project.json content:', fs.readFileSync(apf, 'utf-8'));
}

console.log('\n=== REVENUE MISSIONS ===');
try {
  console.log(db.prepare("SELECT id, title, status, project_id FROM revenue_missions LIMIT 10").all());
} catch(e) { console.log('no revenue_missions or error:', e.message); }

console.log('\n=== REVENUE OPPORTUNITIES ===');
try {
  console.log(db.prepare("SELECT id, title, stage, overall_score FROM revenue_opportunities LIMIT 10").all());
} catch(e) { console.log('no revenue_opportunities or error:', e.message); }

console.log('\n=== REVENUE HUMAN GATES ===');
try {
  console.log(db.prepare("SELECT * FROM revenue_human_gates LIMIT 10").all());
} catch(e) { console.log('no revenue_human_gates or error:', e.message); }
