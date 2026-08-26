// reproduce-jarvis-result.cjs — send the exact prompt through the live Jarvis
// stream path, wait for the worker task to reach terminal, then dump the
// conversation messages + task resultText to prove what Jarvis actually returns.
const http = require('http');
const BASE = 'http://127.0.0.1:4000';
function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const u = new URL(BASE + path);
    const r = http.request({ method, hostname: u.hostname, port: u.port, path: u.pathname + u.search, headers: { 'Content-Type': 'application/json', ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) } }, (res) => {
      let d = '';
      res.on('data', (c) => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d || '{}')); } catch { resolve({ raw: d, http: res.statusCode }); } });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}
function sse(method, path, body) {
  return new Promise((resolve) => {
    const data = JSON.stringify(body);
    const u = new URL(BASE + path);
    const r = http.request({ method, hostname: u.hostname, port: u.port, path: u.pathname, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }, (res) => {
      let buf = '';
      res.on('data', (c) => buf += c.toString());
      res.on('end', () => resolve(buf));
    });
    r.on('error', () => resolve(''));
    r.write(data); r.end();
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const prompt = 'Ask Hermes to inspect the current Agentic OS repository, choose one small safe code-quality improvement, delegate the implementation to CodeX, have CodeX run the relevant targeted test, and return the real result to me.';
  const conv = await req('POST', '/api/jarvis/conversations', { title: 'repro-result' });
  const convId = conv.id || conv.conversationId;
  console.log('CONV', convId);

  const stream = await sse('POST', `/api/jarvis/conversations/${convId}/message/stream`, { prompt, workspacePath: 'B:/AgenticOS' });
  console.log('=== STREAM (SSE) ===');
  // extract chunk deltas + done
  for (const line of stream.split('\n')) {
    if (line.startsWith('data:')) {
      try {
        const ev = JSON.parse(line.slice(5).trim());
        if (ev.type === 'chunk') console.log('  CHUNK:', ev.delta?.slice(0, 200));
        else if (ev.type === 'done') console.log('  DONE:', JSON.stringify({ status: ev.status, taskId: ev.taskId, category: ev.category }));
        else if (ev.type === 'intent') console.log('  INTENT:', JSON.stringify({ type: ev.type, route: ev.route, worker: ev.worker, intentType: ev.intentType }));
      } catch {}
    }
  }

  // Wait for the worker task to reach terminal (poll the conversation messages for resultReturn).
  let taskId = null;
  let done = false;
  const deadline = Date.now() + 360000;
  while (Date.now() < deadline && !done) {
    await sleep(8000);
    const msgs = await req('GET', `/api/jarvis/conversations/${convId}/messages`);
    const arr = Array.isArray(msgs) ? msgs : (msgs.messages || []);
    const resultMsg = arr.find((m) => m.metadata?.resultReturn === true || (m.metadata?.taskId && /Completed — here is what I found/.test(m.content)));
    const queuedMsg = arr.find((m) => /I started task|QUEUED behind/.test(m.content));
    if (resultMsg) {
      done = true;
      taskId = resultMsg.metadata?.taskId;
      console.log('=== RESULT RETURNED TO CONVERSATION ===');
      console.log('  taskId:', taskId);
      console.log('  content:', resultMsg.content.slice(0, 600));
    } else if (queuedMsg) {
      console.log('  (queued ack present, waiting for result...)');
    }
  }

  if (!done) {
    console.log('=== NO RESULT MESSAGE after wait — dumping conversation ===');
    const msgs = await req('GET', `/api/jarvis/conversations/${convId}/messages`);
    const arr = Array.isArray(msgs) ? msgs : (msgs.messages || []);
    for (const m of arr) console.log(`  [${m.role}] ${String(m.content).slice(0, 200)}`);
  }

  if (taskId) {
    const task = await req('GET', `/api/background-tasks/${taskId}`);
    console.log('=== TASK RECORD ===');
    console.log('  status:', task.status, '| resultText:', String(task.resultText || '').slice(0, 300));
  }
})();
