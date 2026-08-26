// Inspect persisted traces for the two QA-passed products + one SME branch
const fs = require('fs');
const T = process.env.LOCALAPPDATA + '\\Temp\\';
function load(f) { try { return JSON.parse(fs.readFileSync(T + f, 'utf8')); } catch { return null; } }
for (const [name, f] of [['VAT-TOOLKIT', 'ro-trace-vat.json'], ['SOP-PACK', 'ro-trace-sop.json'], ['SME-1', 'ro-trace-sme1.json']]) {
  const d = load(f);
  if (!d) { console.log(name, 'PARSE FAIL'); continue; }
  console.log('=====', name, '=====');
  console.log('keys:', Object.keys(d));
  const exp = d.experiment;
  if (exp) console.log('exp:', exp.id, '|', exp.status, '| score:', exp.score, '| decision:', exp.decision, '| nextAction:', exp.nextAction);
  for (const ev of (d.evidence || []).slice(0, 8)) {
    console.log('EVIDENCE:', ev.classification || ev.type, '|', String(ev.summary || ev.description || ev.title || '').slice(0, 110), '|', ev.artifactPath || ev.uri || ev.url || '');
  }
  for (const r of (d.runs || d.canonicalRuns || []).slice(0, 6)) {
    console.log('RUN:', r.id || r.runId, '|', r.status, '|', r.executor, '|', r.providerModel || r.provider);
  }
  for (const g of (d.gates || []).slice(0, 4)) {
    console.log('GATE:', g.id, '|', g.gateType, '|', g.status, '|', String(g.description || '').slice(0, 90));
  }
  for (const l of (d.ledger || []).slice(0, 5)) {
    console.log('LEDGER:', l.type || l.category, '|', l.amount, '|', l.classification || '');
  }
  console.log('');
}
