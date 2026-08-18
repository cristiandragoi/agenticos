// PROOF: active-project switching in the LIVE backend singleton, shown via
// /api/jarvis/runtime-state (the same store the Jarvis context assembly uses).
const BASE = 'http://127.0.0.1:4600';
const j = async (path, opts) => {
  const res = await fetch(BASE + path, opts);
  let body = null; try { body = await res.json(); } catch {}
  return { status: res.status, body };
};
const p1 = await j('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'LiveSwitchA' }) });
const p2 = await j('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'LiveSwitchB' }) });
await j('/api/projects/active', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: p1.body.id }) });
const rt1 = await j('/api/jarvis/runtime-state');
await j('/api/projects/active', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: p2.body.id }) });
const rt2 = await j('/api/jarvis/runtime-state');
console.log(JSON.stringify({
  afterSelectA: rt1.body?.activeProject?.name,
  afterSelectB: rt2.body?.activeProject?.name,
  switchChangesContext: rt2.body?.activeProject?.id === p2.body.id && rt1.body?.activeProject?.id === p1.body.id,
}, null, 1));
await j('/api/projects/active', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: null }) });
await j('/api/projects/' + p1.body.id, { method: 'DELETE' });
await j('/api/projects/' + p2.body.id, { method: 'DELETE' });
