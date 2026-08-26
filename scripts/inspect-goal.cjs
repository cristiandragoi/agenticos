// inspect-goal.cjs — query a codex goal's status + final answer
const http = require('http');
function getJSON(url){return new Promise((res,rej)=>{http.get(url,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>{try{res(JSON.parse(d))}catch(e){rej(e)}}) }).on('error',rej)})}
const goalId = process.argv[2] || 'goal-0f18a54e-';
(async()=>{
  try {
    const g = await getJSON('http://127.0.0.1:4000/api/chat/goals/' + goalId);
    console.log('status:', g.status);
    console.log('provider/model:', g.provider, '/', g.model);
    console.log('workspaceRoot:', g.workspaceRoot || g.workspace);
    console.log('workerInstanceId:', g.workerInstanceId || g.id);
    console.log('finalAnswer:', (g.runSummary?.finalAnswer || g.finalAnswer || '(none)').slice(0, 800));
  } catch(e) {
    console.log('ERR (goal endpoint):', e.message);
    // fallback: check background task
    const t = await getJSON('http://127.0.0.1:4000/api/background-tasks/bgtask-c16cf4614');
    console.log('task status:', t.status, '| goal:', t.metadata?.delegatedCodexGoalId);
    console.log('resultText:', (t.resultText||'').slice(0,500));
  }
})().catch(e=>console.log('ERR',e.message));
