import Database from 'better-sqlite3';

const dbPaths = [
  'C:\\Users\\cd-pr\\AppData\\Roaming\\AgenticOS\\data\\agentic-os.db',
  'D:\\AgenticOS\\server\\data\\agentic-os.db'
];

for (const p of dbPaths) {
  try {
    const db = new Database(p, { readonly: true });
    console.log(`\n=================== DB: ${p} ===================`);
    
    console.log('--- PROJECT: proj-free-cash ---');
    try {
      const proj = db.prepare('SELECT * FROM projects WHERE id = ?').get('proj-free-cash');
      console.log(proj);
    } catch (e: any) {
      console.log('projects table error:', e.message);
    }

    console.log('--- MISSIONS: proj-free-cash ---');
    try {
      const missions = db.prepare('SELECT * FROM revenue_missions WHERE project_id = ?').all('proj-free-cash');
      console.log(missions);
    } catch (e: any) {
      console.log('revenue_missions error:', e.message);
    }

    console.log('--- HUMAN GATES: proj-free-cash ---');
    try {
      const gates = db.prepare('SELECT * FROM revenue_human_gates WHERE project_id = ?').all('proj-free-cash');
      console.log(gates);
    } catch (e: any) {
      console.log('revenue_human_gates error:', e.message);
    }

    console.log('--- RUNS: proj-free-cash ---');
    try {
      const runs = db.prepare("SELECT * FROM execution_runs WHERE project_id = 'proj-free-cash' ORDER BY created_at DESC LIMIT 5").all();
      console.log(runs);
    } catch (e: any) {
      console.log('execution_runs error:', e.message);
    }

    console.log('--- REVENUE OPPORTUNITIES ---');
    try {
      const opps = db.prepare("SELECT * FROM revenue_opportunities WHERE title LIKE '%free%' OR title LIKE '%Free%' OR id LIKE '%free%'").all();
      console.log(opps);
    } catch (e: any) {
      console.log('revenue_opportunities error:', e.message);
    }

    db.close();
  } catch (err: any) {
    console.log(`Could not open ${p}: ${err.message}`);
  }
}
