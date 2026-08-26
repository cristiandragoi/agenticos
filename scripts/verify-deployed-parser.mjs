// verify-deployed-parser.mjs — run the DEPLOYED parseFindingsFromText against the
// EXACT Step-1 analysis content (msg-e71edd29-), proving the deployed parser now
// extracts the 5 headline === FINDING N === findings and excludes the bullets.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url);
const Database = require('B:/AgenticOS/server/node_modules/better-sqlite3');

const DB = 'C:/Users/Cris/AppData/Roaming/agenticos/data/agentic-os.db';
const db = new Database(DB, { readonly: true, fileMustExist: true });
const row = db.prepare("SELECT content FROM conversation_messages WHERE id = 'msg-e71edd29-'").get();
db.close();
if (!row) { console.error('msg-e71edd29- not found'); process.exit(1); }
const content = row.content;

const mod = await import(pathToFileURL('C:/Users/Cris/Desktop/desktop/Agentic_OS/Agentic OS/resources/server/dist/domains/jarvis/workerContextHandoff.js').href);
const findings = mod.parseFindingsFromText(content);

console.log('=== DEPLOYED parseFindingsFromText on exact Step-1 content ===');
console.log('findings count:', findings.length);
for (const f of findings) {
  console.log(`  ${f.index}. ${f.title}`);
}
const expected = [
  'In-memory conversations store is lost on restart and unbounded',
  "CORS is wide open (origin: '*')",
  'Auth is bypassed',
  'Duplicate route registration',
  'Startup recovery',
];
console.log('\n=== assertions ===');
console.log('count === 5:', findings.length === 5);
console.log('titles match expected:', expected.every((e, i) => findings[i] && findings[i].title.includes(e)));
console.log('no bullet leaked:', findings.every((f) => !/lower confidence|line 205|line 215|line 375|line 412/i.test(f.title)));
