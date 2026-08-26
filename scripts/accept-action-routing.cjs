// accept-action-routing.cjs — live acceptance: the action+context prompt must NOT
// classify as current_work_context; it must route Hermes → in-repo CodeX and
// return real execution evidence.
const http = require('http');
const PROMPT = 'What is the highest-priority issue in AgenticOS right now? Have Hermes analyze it, choose the next concrete fix, delegate implementation to CodeX, make CodeX run the relevant test, and return the real result.';

function req(method, path, body) {
  return new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request({ host: '127.0.0.1', port: 4000, path, method, headers: { 'Content-Type': 'application/json', ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) } }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({ raw: d, httpStatus: res.statusCode }); } });
    });
    r.on('error', (e) => resolve({ error: e.message }));
    if (data) r.write(data);
    r.end();
  });
}
function getJSON(path) { return new Promise((resolve) => { http.get({ host: '127.0.0.1', port: 4000, path }, (r) => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>{try{resolve(JSON.parse(d));}catch{resolve({raw:d});}}); }).on('error',(e)=>resolve({error:e.message})); }); }

// Read SSE body manually to capture intent + done
function postStream(path, body) {
  return new Promise((resolve) => {
    const data = JSON.stringify(body);
    const r = http.request({ host: '127.0.0.1', port: 4000, path, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }, (res) => {
      let buf = '';
      res.on('data', (c) => (buf += c));
      res.on('end', () => resolve(buf));
    });
    r.on('error', (e) => resolve('ERR ' + e.message));
    r.write(data); r.end();
  });
}

(async () => {
  const conv = await req('POST', '/api/jarvis/conversations', { title: 'action-routing-accept' });
  const convId = conv.id || conv.conversationId || 'conv-accept';
  console.log('CONV', convId);

  const sse = await postStream(`/api/jarvis/conversations/${convId}/message/stream`, { prompt: PROMPT, workspacePath: 'B:/AgenticOS' });
  const intents = [...sse.matchAll(/data: (\{.*?"type":"(intent|done)".*?\})/g)].map((m) => { try { return JSON.parse(m[1]); } catch { return null; } }).filter(Boolean);
  console.log('INTENTS:', JSON.stringify(intents.map((i) => ({ type: i.type, route: i.route || i.intent?.type || i.intent?.route, category: i.category }))));
  const done = intents.find((i) => i.type === 'done');
  console.log('DONE:', JSON.stringify(done ? { route: done.route, category: done.category, provider: done.provider, model: done.model } : null));

  // Poll conversation for the result (worker task runs async).
  let result = null; let taskId = null;
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const msgs = await getJSON(`/api/jarvis/conversations/${convId}/messages`);
    const list = Array.isArray(msgs) ? msgs : (msgs.messages || []);
    const resMsg = list.find((m) => /completed — here is what i found/i.test(String(m.content)) || /completed/i.test(String(m.content)));
    if (resMsg) { result = resMsg; break; }
    const tasks = await getJSON('/api/background-tasks?limit=5');
    const tlist = Array.isArray(tasks) ? tasks : (tasks.tasks || []);
    const mine = tlist.find((t) => t.conversationId === convId);
    if (mine && mine.status !== 'running' && mine.status !== 'queued' && mine.status !== 'planning' && mine.status !== 'verifying' && mine.status !== 'waiting_approval') { taskId = mine.taskId; break; }
  }

  if (taskId) {
    const t = await getJSON(`/api/background-tasks/${taskId}`);
    console.log('TASK:', JSON.stringify({ taskId: t.taskId || taskId, status: t.status, worker: t.worker, route: t.route, codexGoalId: (t.metadata||{}).codexGoalId, delegatedBy: (t.metadata||{}).delegatedBy, resultText: String(t.resultText||'').slice(0,400) }));
  }
  if (result) {
    console.log('RESULT_MSG:', String(result.content).slice(0, 800));
  }
})();
