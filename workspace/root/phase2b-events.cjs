// Find artifact paths + product payloads from persisted traces and DB
const fs = require('fs');
const T = process.env.LOCALAPPDATA + '\\Temp\\';
function load(f) { try { return JSON.parse(fs.readFileSync(T + f, 'utf8')); } catch { return null; } }
for (const [name, f] of [['VAT', 'ro-trace-vat.json'], ['SOP', 'ro-trace-sop.json'], ['SME1', 'ro-trace-sme1.json']]) {
  const d = load(f);
  console.log('=====', name, '=====');
  console.log('nextAction:', JSON.stringify(d.nextAction));
  console.log('argusState:', JSON.stringify(d.argusState));
  console.log('compliance:', JSON.stringify(d.compliance).slice(0, 200));
  for (const ev of (d.events || [])) {
    console.log('EVENT:', ev.type, '|', String(ev.summary || ev.details || '').slice(0, 100), '|', JSON.stringify(ev.metadata || {}).slice(0, 160));
  }
  console.log('');
}
