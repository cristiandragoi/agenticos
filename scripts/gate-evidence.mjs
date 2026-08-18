// Dump full gate evidence for bgtask-2c554fb1f.
const t = await (await fetch('http://localhost:4000/api/background-tasks/bgtask-2c554fb1f')).json();
const gates = (t.metadata?.gateResults || []);
for (const g of gates) {
  console.log('=== ' + g.gateId + ' (' + g.status + ') ===');
  console.log('reason: ' + g.reason);
  console.log('evidence:');
  for (const e of (g.evidence || [])) console.log('  ' + String(e).slice(0, 400));
}
console.log('filesChanged: ' + JSON.stringify(t.filesChanged));
console.log('result_text head: ' + String(t.resultText || '').slice(0, 300));
