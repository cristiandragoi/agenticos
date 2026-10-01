import db from 'better-sqlite3';

try {
  const databasePath = 'D:/AgenticOS/server/database.sqlite';
  const dbInstance = db(databasePath);
  
  // Search for opportunities with "Cash" or "Finance" in the title
  const cashOpps = dbInstance.prepare('SELECT id, title, stage FROM revenue_opportunities WHERE lower(title) LIKE ?').get('%cash%');
  console.log("Opportunities containing 'cash':", cashOpps || "none");
  
  // List all opportunity IDs with free/full names
  const allIds = dbInstance.prepare('SELECT id FROM revenue_opportunities').all();
  console.log("\nAll opportunity IDs:", JSON.stringify(allIds, null, 2));
  
} catch (e) {
  console.error("Error:", e.message);
}
