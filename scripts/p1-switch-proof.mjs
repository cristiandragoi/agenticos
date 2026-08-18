// PROOF v2: switching projects changes Jarvis context — verified against the
// LIVE backend singleton (fresh module import after each switch).
const BASE = 'http://127.0.0.1:4600';
const j = async (path, opts) => {
  const res = await fetch(BASE + path, opts);
  let body = null; try { body = await res.json(); } catch {}
  return { status: res.status, body };
};
const stamp = Date.now().toString(36).slice(-5);
const loadCtx = async () => {
  const { assembleConversationContext, contextToSystemPrompt } = await import('file:///B:/AgenticOS/server/dist/domains/jarvis/conversationContext.js?t=' + Date.now());
  const ctx = await assembleConversationContext('conv-switch-test', 'What are we working on?', { approvalMode: 'manual' });
  const prompt = contextToSystemPrompt(ctx);
  const line = prompt.split('\n').find((l) => l.startsWith('Active project')) || 'Active project: NONE';
  return { project: ctx.activeProject, line };
};

const p1 = await j('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: `SwitchA ${stamp}` }) });
const p2 = await j('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: `SwitchB ${stamp}` }) });
await j('/api/projects/active', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: p1.body.id }) });
const c1 = await loadCtx();
await j('/api/projects/active', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: p2.body.id }) });
const c2 = await loadCtx();
await j('/api/projects/active', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: null }) });
await j('/api/projects/' + p1.body.id, { method: 'DELETE' });
await j('/api/projects/' + p2.body.id, { method: 'DELETE' });
console.log(JSON.stringify({
  first: { project: c1.project?.name, line: c1.line },
  second: { project: c2.project?.name, line: c2.line },
  switchChangesContext: c2.project?.id === p2.body.id && c1.project?.id === p1.body.id,
}, null, 1));
