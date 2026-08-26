// dump-goal-objective.cjs — show the codex goal's stored objective + the Hermes structured output
const http = require('http');
function getJSON(url){return new Promise((res,rej)=>{http.get(url,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>{try{res(JSON.parse(d))}catch(e){rej(e)}}) }).on('error',rej)})}
(async()=>{
  const task = await getJSON('http://127.0.0.1:4000/api/background-tasks/bgtask-c16cf4614');
  console.log('=== TASK status:', task.status, '===');
  console.log('objective:', task.objective);
  console.log('originalRequest:', task.originalRequest);
  console.log('metadata.hermesResultId:', task.metadata?.hermesResultId);
  console.log('metadata.codexGoalId:', task.metadata?.codexGoalId);
  console.log('resultText:', (task.resultText||'').slice(0,400));

  // try to get the codex goal's objective
  const goalId = task.metadata?.codexGoalId;
  if (goalId) {
    try {
      const g = await getJSON('http://127.0.0.1:4000/api/chat/goals/' + goalId);
      console.log('\n=== GOAL objective/instruction ===');
      console.log(JSON.stringify({ objective: g.objective, prompt: g.prompt, instruction: g.instruction, title: g.title, goal: g.goal }, null, 2).slice(0, 1500));
    } catch(e) { console.log('goal fetch err:', e.message); }
  }

  // dump the hermes structured output
  const rid = task.metadata?.hermesResultId;
  if (rid) {
    try {
      const r = await getJSON('http://127.0.0.1:4000/api/runs/results/' + rid);
      console.log('\n=== HERMES RESULT structuredOutput ===');
      console.log(JSON.stringify(r.structuredOutput || r, null, 2).slice(0, 2500));
    } catch(e) { console.log('result fetch err:', e.message); }
  }
})().catch(e=>console.log('ERR',e.message));
