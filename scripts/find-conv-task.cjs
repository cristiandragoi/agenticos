// find-conv-task.cjs — find a background task by conversationId and dump routing
const http = require('http');
function get(u){return new Promise((res)=>{http.get({host:'127.0.0.1',port:4000,path:u},r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>{try{res(JSON.parse(d));}catch{res({raw:d});}});}).on('error',e=>res({error:e.message}));});}
(async()=>{
  const convId = process.argv[2];
  const tasks = await get('/api/background-tasks?limit=100');
  const list = Array.isArray(tasks) ? tasks : (tasks.tasks||[]);
  const mine = list.filter(t => t.conversationId === convId);
  console.log('tasks for conv:', mine.length);
  for (const t of mine.slice(-3)) {
    console.log(JSON.stringify({ taskId: t.taskId, status: t.status, worker: t.worker, route: t.route, codexGoalId: (t.metadata||{}).codexGoalId, hermesPlanRunId: (t.metadata||{}).hermesPlanRunId, delegatedBy: (t.metadata||{}).delegatedBy, verificationState: t.verificationState, resultText: String(t.resultText||'').slice(0,300) }));
  }
})();
