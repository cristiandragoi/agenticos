// List WHICH secret keys exist in system_secrets (names only — never values).
import Database from 'better-sqlite3';
const db = new Database('C:/Users/Cris/AppData/Roaming/agenticos/data/agentic-os.db', { readonly: true });
const has = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='system_secrets'`).get();
if (!has) { console.log('NO system_secrets table'); db.close(); process.exit(0); }
const rows = db.prepare(`SELECT key, length(encrypted_value) AS len FROM system_secrets ORDER BY key`).all();
console.log('SECRET_KEYS', rows.map((r) => `${r.key}(len ${r.len})`).join(', '));
db.close();
