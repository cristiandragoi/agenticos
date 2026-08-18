import Database from 'better-sqlite3';
import fs from 'fs';

const db = new Database('./data/agentic_os.db');

const sql = fs.readFileSync('./drizzle/0004_mature_shriek.sql', 'utf8');

const commands = sql.split('--> statement-breakpoint');

db.transaction(() => {
  for (const command of commands) {
    if (command.trim()) {
      db.exec(command);
    }
  }
})();

console.log('Migration applied.');
