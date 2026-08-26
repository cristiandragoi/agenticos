// resolve-approval.cjs — resolve a waiting_approval codex task via the canonical
// goal approval endpoint (used by the reliability gate for its own test tasks).
const http = require('http');
function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request(`http://127.0.0.1:4000${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {},
      timeout: 30000,
    }, (res) => { let d=''; res.on('data',c=>d+=c); res.on('end',()=>{ try{resolve(JSON.parse(d));}catch{resolve(d);} }); });
    r.on('error', reject); r.on('timeout', () => r.destroy(new Error('timeout')));
    if (data) r.write(data); r.end();
  });
}
(async () => {
  const taskId = process.argv[2];
  const t = await req('GET', `/api/background-tasks/${taskId}`);
  const goalId = t.linkedRunId || t.metadata?.codexGoalId || t.goalId;
  console.log('task', taskId, 'goal', goalId, 'status', t.status);
  if (!goalId) { console.log('NO GOAL'); process.exit(2); }
  const r = await req('POST', `/api/chat/agents/goal/${goalId}/approve`, { action: 'approve' });
  console.log('approve:', JSON.stringify(r).slice(0, 200));
  process.exit(0);
})().catch((e) => { console.error('ERR', e.message); process.exit(2); });
