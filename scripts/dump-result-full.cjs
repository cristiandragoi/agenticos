// dump-result-full.cjs — full conversation result + task record + codex goal
const http = require('http');
function get(u){return new Promise((res)=>{http.get(u,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>{try{res(JSON.parse(d))}catch{res({raw:d})}})})})}
(async()=>{
  const id = process.argv[2];
  const m = await get(`http://127.0.0.1:4000/api/jarvis/conversations/${id}/messages`);
  const a = Array.isArray(m) ? m : (m.messages || []);
  const resultMsg = a.find(x => x.metadata?.resultReturn === true);
  if (resultMsg) {
    console.log('=== FULL RESULT-RETURN CONTENT ===');
    console.log(resultMsg.content);
    console.log('--- end ---');
  }
  const taskId = resultMsg?.metadata?.taskId;
  if (taskId) {
    const t = await get(`http://127.0.0.1:4000/api/background-tasks/${taskId}`);
    console.log('=== TASK ===');
    console.log('status:', t.status, '| worker:', t.worker, '| verificationState:', t.verificationState);
    console.log('resultText:', String(t.resultText || '').slice(0, 500));
    console.log('codexGoalId:', t.metadata?.codexGoalId, '| hermesPlanRunId:', t.metadata?.hermesPlanRunId, '| delegatedBy:', t.metadata?.delegatedBy);
    const gid = t.metadata?.codexGoalId;
    if (gid) {
      const g = await get(`http://127.0.0.1:4000/api/chat/agents/goal/${gid}`);
      console.log('=== CODEX GOAL ===');
      console.log('status:', g.status);
      console.log('finalAnswer:', String((g.runSummary?.finalAnswer) || '(none)').slice(0, 500));
      console.log('summary:', String((g.runSummary?.summary) || '(none)').slice(0, 200));
    }
  }
})();
