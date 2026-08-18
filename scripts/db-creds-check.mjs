// Check provider_credentials columns in the deployed DB.
import { createRequire } from 'node:module';
const require = createRequire('B:/AgenticOS/server/package.json');
const Database = require('better-sqlite3');
const db = new Database('C:/Users/Cris/Desktop/desktop/Agentic_OS/Agentic OS/resources/server/data/agentic-os.db', { readonly: true });
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='provider_credentials'").all();
if (tables.length) {
  console.log('CREDS_COLS ' + JSON.stringify(db.prepare('PRAGMA table_info(provider_credentials)').all().map((c) => c.name)));
} else {
  console.log('CREDS_TABLE_MISSING');
}
db.close();
