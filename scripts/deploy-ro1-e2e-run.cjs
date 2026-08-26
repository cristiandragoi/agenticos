/* RO1 deploy: bounded runtime verification — POST /api/revenue-engine/e2e/run on :4000 */
const BASE = 'http://localhost:4000';
(async () => {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 560000);
  try {
    const r = await fetch(`${BASE}/api/revenue-engine/e2e/run`, { method: 'POST', signal: ctrl.signal });
    const body = await r.json();
    console.log('HTTP', r.status);
    console.log(JSON.stringify(body, null, 2));
  } catch (e) {
    console.log('E2E REQUEST FAILED:', e.message);
  } finally {
    clearTimeout(t);
  }
})();
