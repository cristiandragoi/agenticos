// Verify turn 10 (and the acceptance batch) persisted complete agent messages.
const API = 'http://127.0.0.1:4000/api';
const CONV = 'conv-e110afce-';
async function main() {
  const res = await fetch(`${API}/jarvis/conversations/${CONV}/messages`, { signal: AbortSignal.timeout(5000) });
  const m = await res.json();
  const arr = Array.isArray(m) ? m : (m.messages || []);
  const tail = arr.slice(-8);
  for (const x of tail) {
    const meta = x.metadata || {};
    console.log(`${x.role || x.messageType || '?'} | ${String(x.content || '').slice(0, 110)} | op=${String(meta.operationId || '').slice(-20)} prov=${meta.provider || ''} model=${meta.model || ''}`);
  }
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
