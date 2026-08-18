// Check the live backend's active-project state after switching.
const BASE = 'http://127.0.0.1:4600';
const j = async (path, opts) => {
  const res = await fetch(BASE + path, opts);
  let body = null; try { body = await res.json(); } catch {}
  return { status: res.status, body };
};
const p1 = await j('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'SwitchX1' }) });
const p2 = await j('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'SwitchX2' }) });
const set1 = await j('/api/projects/active', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: p1.body.id }) });
const get1 = await j('/api/projects/active');
const set2 = await j('/api/projects/active', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: p2.body.id }) });
const get2 = await j('/api/projects/active');
console.log(JSON.stringify({
  set1: { status: set1.status, activeProjectId: set1.body?.activeProjectId },
  get1: { status: get1.status, activeProjectId: get1.body?.activeProjectId, name: get1.body?.project?.name },
  set2: { status: set2.status, activeProjectId: set2.body?.activeProjectId, returnedProject: set2.body?.project?.name },
  get2: { status: get2.status, activeProjectId: get2.body?.activeProjectId, name: get2.body?.project?.name },
}, null, 1));
await j('/api/projects/active', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: null }) });
await j('/api/projects/' + p1.body.id, { method: 'DELETE' });
await j('/api/projects/' + p2.body.id, { method: 'DELETE' });
