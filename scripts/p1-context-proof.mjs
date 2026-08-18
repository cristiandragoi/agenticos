// PROOF: active project reaches Jarvis conversation context.
// Uses the REAL backend endpoints: create project → select → assemble context
// via the actual server module (conversationContext) against the live DB.
process.chdir('B:/AgenticOS/server');
const BASE = 'http://127.0.0.1:4600';
const j = async (path, opts) => {
  const res = await fetch(BASE + path, opts);
  let body = null; try { body = await res.json(); } catch {}
  return { status: res.status, body };
};
const stamp = Date.now().toString(36).slice(-5);

// 1. Create + select project.
const created = await j('/api/projects', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: `JarvisContext ${stamp}`, description: 'proves context flow to Jarvis' }),
});
const projId = created.body?.id;
await j('/api/projects/active', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ projectId: projId }),
});
console.log('PROJECT', projId, created.body?.name);

// 2. Assemble context the exact way the stream handler does.
const { assembleConversationContext, contextToSystemPrompt } = await import('file:///B:/AgenticOS/server/dist/domains/jarvis/conversationContext.js');
const ctx = await assembleConversationContext('conv-context-test', 'What are we working on?', { approvalMode: 'manual' });
console.log('CTX_ACTIVE_PROJECT', JSON.stringify(ctx.activeProject));
const prompt = contextToSystemPrompt(ctx);
const hasProject = prompt.includes('Active project:');
console.log('PROMPT_HAS_ACTIVE_PROJECT', hasProject);
console.log('PROMPT_ACTIVE_PROJECT_LINE', prompt.split('\n').find((l) => l.startsWith('Active project')) || 'NOT FOUND');
const lineIdx = prompt.split('\n').findIndex((l) => l.startsWith('Active project'));
console.log('LINE', lineIdx >= 0 ? prompt.split('\n')[lineIdx] : 'NONE');

// 3. Switch project → context changes.
const created2 = await j('/api/projects', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: `JarvisContext2 ${stamp}`, description: 'second project' }),
});
const proj2 = created2.body?.id;
await j('/api/projects/active', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ projectId: proj2 }),
});
const ctx2 = await assembleConversationContext('conv-context-test', 'What are we working on?', { approvalMode: 'manual' });
console.log('CTX2_ACTIVE_PROJECT', JSON.stringify(ctx2.activeProject));
console.log('SWITCH_CHANGES_CONTEXT', ctx2.activeProject?.id === proj2 && ctx2.activeProject?.id !== projId);

// Cleanup.
await j('/api/projects/active', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: null }) });
await j('/api/projects/' + projId, { method: 'DELETE' });
await j('/api/projects/' + proj2, { method: 'DELETE' });
console.log('DONE');
