import Database from 'better-sqlite3';

const dbPath = 'C:/Users/cd-pr/AppData/Roaming/agenticos/data/agentic-os.db';
const db = new Database(dbPath);

console.log('argus_verifications table info:');
console.log(db.prepare("PRAGMA table_info(argus_verifications)").all());

console.log('sample row from argus_verifications:');
console.log(db.prepare("SELECT * FROM argus_verifications LIMIT 3").all());
