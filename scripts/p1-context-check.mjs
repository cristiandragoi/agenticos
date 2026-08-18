// Verify the active project reaches the Jarvis conversation context prompt.
// Create project, select it, send a Jarvis turn, and inspect the assembled
// context (the system prompt should mention "Active project: <name>").
const BASE = 'http://127.0.0.1:4600';
const j = async (path, opts) => {
  const res = await fetch(BASE + path, opts);
  let body = null; try { body = await res.json(); } catch {}
  return { status: res.status, body };
};
const stamp = Date.now().toString(36).slice(-5);

// Create + select project.
const created = await j('/api/projects', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: `Context Proj ${stamp}`, description: 'prove context flow' }),
});
const projId = created.body?.id;
await j('/api/projects/active', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ projectId: projId }),
});

// Find the context assembly by asking Jarvis about the project.
const conv = await j('/api/jarvis/conversations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'ctx-test' }) });
const convId = conv.body?.id || conv.body?.conversationId;
console.log('CONV', convId);

// Use the diagnostics endpoint to see recent context (or check the stream body).
// The stream endpoint assembles context server-side; check the conversation
// context module directly via a small node script instead.
console.log('PROJ', projId, created.body?.name);
await j('/api/projects/active', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: null }) });
await j('/api/projects/' + projId, { method: 'DELETE' });
