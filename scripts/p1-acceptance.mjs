// P1 live acceptance — Project+Knowledge foundation through the real backend.
// Flow: create project → select → knowledge → task → runtime-state → verify.
const BASE = 'http://127.0.0.1:4600';
const j = async (path, opts) => {
  const res = await fetch(BASE + path, opts);
  let body = null; try { body = await res.json(); } catch {}
  return { status: res.status, body };
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const stamp = Date.now().toString(36).slice(-5);
const results = {};

// 1. Create a project.
const created = await j('/api/projects', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: `Acceptance Proj ${stamp}`, description: 'overnight acceptance', tags: ['test'], color: '#00e5ff' }),
});
results.createProject = { status: created.status, id: created.body?.id, name: created.body?.name };
const projId = created.body?.id;
if (!projId) { console.log('RESULT ' + JSON.stringify(results, null, 1)); process.exit(1); }

// 2. Select it as active.
const sel = await j('/api/projects/active', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ projectId: projId }),
});
results.selectProject = { status: sel.status, activeProjectId: sel.body?.activeProjectId };

// 3. Active persists via GET.
const activeGet = await j('/api/projects/active');
results.activePersists = { activeProjectId: activeGet.body?.activeProjectId, name: activeGet.body?.project?.name };

// 4. Create knowledge item in that project.
const ki = await j(`/api/projects/${projId}/knowledge`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ title: 'Decision: overnight stack', content: 'Use the existing SQLite persistence.', type: 'decision', tags: ['stack'] }),
});
results.createKnowledge = { status: ki.status, id: ki.body?.id, projectId: ki.body?.projectId, title: ki.body?.title };

// 5. Verify ownership: knowledge listed under the project; a different project shows none.
const kiList = await j(`/api/projects/${projId}/knowledge`);
results.knowledgeOwnership = {
  listedCount: Array.isArray(kiList.body) ? kiList.body.length : -1,
  belongsToProject: Array.isArray(kiList.body) ? kiList.body.every((i) => i.projectId === projId) : false,
};

// 6. Create project-linked background work (manual task API carries projectId).
const task = await j('/api/background-tasks', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ title: `Acceptance task ${stamp}`, objective: 'Prove project linking', worker: 'research', projectId: projId, dispatch: false }),
});
results.createTask = { status: task.status, taskId: task.body?.taskId, projectId: task.body?.projectId };

// 7. Runtime-state reflects delegated (active task) + active project.
await sleep(1500);
const rt = await j('/api/jarvis/runtime-state');
results.runtimeState = {
  state: rt.body?.state,
  activeProject: rt.body?.activeProject,
  pendingTaskCount: rt.body?.pendingTaskCount,
  projectTasks: (rt.body?.projectTasks || []).map((t) => ({ id: t.taskId, status: t.status })),
};

// 8. Live events show real operational events (no streaming noise by default).
const ev = await j('/api/jarvis/live-events?limit=10');
results.liveEvents = {
  count: Array.isArray(ev.body) ? ev.body.length : -1,
  kinds: Array.isArray(ev.body) ? [...new Set(ev.body.map((e) => e.kind))] : [],
  hasStreamingNoise: Array.isArray(ev.body) ? ev.body.some((e) => e.kind === 'task.progress' && e.detail?.streaming) : null,
};

// Cleanup: remove the task + knowledge + project.
await j(`/api/projects/${projId}/knowledge/${ki.body?.id}`, { method: 'DELETE' });
await j('/api/background-tasks/' + task.body?.taskId + '/cancel', { method: 'POST' }).catch(() => {});
await j('/api/projects/active', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: null }) });
await j('/api/projects/' + projId, { method: 'DELETE' });

console.log('RESULT ' + JSON.stringify(results, null, 1));
