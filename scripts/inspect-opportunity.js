const db = require('better-sqlite3');
const databasePath = 'D:/AgenticOS/server/database.sqlite';

try {
  const dbInstance = db(databasePath);
  
  // Check if target opportunity exists
  const opp = db.prepare('SELECT title, stage FROM revenue_opportunities WHERE id = ?').get('opp-45086c0d-');
  
  if (opp) {
    console.log("Opportunity found:");
    console.log(JSON.stringify(opp, null, 2));
  } else {
    console.log("No opportunity with that ID exists.");
    // List all opportunity IDs to see what's there
    const allOpps = db.prepare('SELECT id FROM revenue_opportunities').all();
    console.log("All opportunities:", JSON.stringify(allOpps, null, 2));
  }
} catch (e) {
  console.error("Error:", e.message);
}
