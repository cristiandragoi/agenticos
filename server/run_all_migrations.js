import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const db = new Database('./data/agentic_os.db');

const files = fs.readdirSync('./drizzle').filter(f => f.endsWith('.sql')).sort();

for (const file of files) {
  console.log(`Applying ${file}...`);
  const sql = fs.readFileSync(path.join('./drizzle', file), 'utf8');
  const commands = sql.split('--> statement-breakpoint');
  
  db.transaction(() => {
    for (const cmd of commands) {
      if (cmd.trim()) {
        try {
          db.exec(cmd);
        } catch (e) {
          if (e.message.includes('already exists') || e.message.includes('duplicate column')) {
             console.log(`Skipping existing structure in ${file}`);
          } else {
             throw e;
          }
        }
      }
    }
  })();
}
console.log('Done migrating');
