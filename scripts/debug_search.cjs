const Database = require("better-sqlite3");
const db = new Database("C:/Users/Cris/AppData/Roaming/agenticos/data/agentic-os.db");
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(t => t.name);
for (const table of tables) {
  try {
    const rows = db.prepare("SELECT * FROM " + table).all();
    for (const r of rows) {
      const str = JSON.stringify(r);
      if (str.includes("1807") || str.includes("1807A3") || str.includes("T-1807A3")) {
        console.log("Found in table " + table + ":\n" + JSON.stringify(r, null, 2));
      }
    }
  } catch (e) {}
}
