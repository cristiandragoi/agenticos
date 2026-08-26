import { readFileSync } from 'node:fs';
const d = JSON.parse(readFileSync('B:/AgenticOS/docs/overnight-repair/phase7-raw.json', 'utf8'));
console.log('=== EVENTS ===');
for (const e of (d.events || [])) {
  const s = typeof e.data === 'string' ? e.data : JSON.stringify(e.data);
  console.log(`[${e.ev}] ${s.slice(0, 300)}`);
}
console.log('\n=== MESSAGES (' + (d.messages?.length ?? 0) + ') ===');
for (const m of (d.messages || [])) {
  console.log(`--- role=${m.role} messageType=${m.messageType} contentLen=${(m.content || '').length}`);
  console.log('    keys:', Object.keys(m).join(','));
  console.log('    content:', JSON.stringify((m.content || '').slice(0, 400)));
  if (m.metadata) console.log('    metadata:', JSON.stringify(m.metadata).slice(0, 400));
}
console.log('\n=== convId ===', d.convId);
