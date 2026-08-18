// Summarize the execution store snapshot: current + history ops.
import fs from 'node:fs';
const d = JSON.parse(fs.readFileSync(process.argv[2] || 'exec_current.json', 'utf8'));
const c = d.current;
console.log('CURRENT:', c ? `${c.operationId} | ${c.status} | ${c.currentAction} | started ${new Date(c.startedAt).toISOString()} | ended ${c.endedAt ? new Date(c.endedAt).toISOString() : 'null'} | note ${c.note}` : 'null');
for (const h of (d.history || []).slice(0, 10)) {
  console.log('HIST:', `${h.operationId} | ${h.status} | ${new Date(h.startedAt).toISOString()} | ${h.result ? JSON.stringify(h.result).slice(0, 40) : ''}`);
}
