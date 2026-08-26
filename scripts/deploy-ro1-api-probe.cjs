/* RO1 deploy: packaged API verification against :4000 — read-only probes only */
const BASE = 'http://localhost:4000';
async function probe(name, path, opts) {
  try {
    const r = await fetch(BASE + path, opts);
    const text = await r.text();
    let body;
    try { body = JSON.parse(text); } catch { body = text.slice(0, 200); }
    const summary = typeof body === 'string' ? body : JSON.stringify(body).slice(0, 220);
    console.log(`[${r.status}] ${name}: ${summary}`);
    return r.status;
  } catch (e) {
    console.log(`[ERR] ${name}: ${e.message}`);
    return -1;
  }
}
(async () => {
  await probe('health', '/api/health');
  await probe('ro missions', '/api/revenue-operator/missions');
  await probe('ro experiments', '/api/revenue-operator/experiments');
  await probe('ro ledger', '/api/revenue-operator/ledger');
  await probe('ro gates', '/api/revenue-operator/gates');
  await probe('ro compliance', '/api/revenue-operator/compliance');
  await probe('re distribution', '/api/revenue-engine/distribution');
  await probe('rev measurements', '/api/revenue/measurements');
  await probe('rev opportunities', '/api/revenue/opportunities');
  await probe('argus contracts', '/api/argus/contracts');
  await probe('argus assignment', '/api/argus/assignment');
})();
