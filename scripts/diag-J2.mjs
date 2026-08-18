import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const Database = require('B:/AgenticOS/server/node_modules/better-sqlite3');
const db = new Database('C:/Users/Cris/AppData/Roaming/agenticos/data/agentic-os.db', { readonly: true });
console.log('--- schedule_executions columns ---');
console.log(db.prepare('PRAGMA table_info(schedule_executions)').all().map(c => c.name).join(', '));
console.log('--- background_tasks columns ---');
console.log(db.prepare('PRAGMA table_info(background_tasks)').all().map(c => c.name).join(', '));
