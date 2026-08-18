// Deterministic single-shot provider-failure injector (GAP 1 closeout).
// Wraps global.fetch: the FIRST /api/chat request whose body contains
// RETRYFLAG42 throws a transient network error (simulated connection reset).
// The gateway's real retry chain then re-issues the SAME request — the
// recovered execution is a REAL Ollama call. One-shot (flag consumed).
const origFetch = global.fetch;
let armed = false;
let fired = false;

global.fetch = async (...args) => {
  const url = String(args[0] || '');
  let bodyText = '';
  try {
    bodyText = typeof args[1]?.body === 'string' ? args[1].body : '';
  } catch { /* ignore */ }
  if (url.includes('/api/chat') && bodyText.includes('RETRYFLAG42')) {
    if (!armed) { armed = true; console.log(JSON.stringify({ diagnostic: 'injector: armed for RETRYFLAG42' })); }
    if (armed && !fired) {
      fired = true;
      console.log(JSON.stringify({ diagnostic: 'injector: fired transient provider failure on /api/chat', url }));
      throw new TypeError('fetch failed: simulated transient provider failure (GAP1 closeout)');
    }
  }
  return origFetch(...args);
};
