import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const historyPath = 'C:\\Users\\cd-pr\\AppData\\Local\\Google\\Chrome\\User Data\\Default\\History';
const tempHistory = 'C:\\Users\\cd-pr\\AppData\\Local\\Temp\\chrome_history_copy';

try {
  fs.copyFileSync(historyPath, tempHistory);
  const db = new Database(tempHistory, { readonly: true });
  const rows = db.prepare("SELECT url, title, datetime(last_visit_time/1000000-11644473600,'unixepoch') as visited FROM urls WHERE url LIKE '%freecash%' ORDER BY last_visit_time DESC LIMIT 10").all();
  console.log('Recent Freecash visits in default Chrome profile:');
  console.log(rows);
  db.close();
} catch (e: any) {
  console.log('Error reading History:', e.message);
}
