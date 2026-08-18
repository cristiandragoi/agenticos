// Run jarvisTrace test with a fresh DB and list the message fields logged.
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const db = path.join(os.tmpdir(), 'srv_trace_msg.sqlite');
if (fs.existsSync(db)) fs.rmSync(db);
const out = execSync(
  `cd /d B:\\AgenticOS\\server && set AGENT_TEAMS_DB_PATH=${db}&& npx vitest run src/__tests__/jarvisTrace.test.ts 2>&1`,
  { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
);
// find LOGS_DEBUG payloads
const re = /LOGS_DEBUG (\[.*\])(?=\n|$)/g;
let m;
const msgs = new Set();
while ((m = re.exec(out)) !== null) {
  const payload = m[1];
  const entries = JSON.parse(payload);
  for (const e of entries) {
    try {
      const j = JSON.parse(e);
      msgs.add(`${j.message} :: ${String(j.meta || '').slice(0, 90)}`);
    } catch {
      msgs.add(String(e).slice(0, 140));
    }
  }
}
console.log('LOGS_LIST');
for (const s of msgs) console.log(s);
