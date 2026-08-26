// dump-task-meta.cjs — show a task's status + concurrency metadata
const http = require('http');
function getJSON(url){return new Promise((res,rej)=>{http.get(url,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>{try{res(JSON.parse(d))}catch(e){rej(e)}}) }).on('error',rej)})}
(async()=>{
  const id = process.argv[2] || 'bgtask-001a3f765';
  const t = await getJSON('http://127.0.0.1:4000/api/background-tasks/' + id);
  console.log('status:', t.status, '| worker:', t.worker, '| route:', t.route);
  console.log('concurrency meta:', JSON.stringify(t.metadata?.concurrency));
  console.log('codexGoalId:', t.metadata?.codexGoalId);
  console.log('progressMessage:', t.progressMessage);
  // also list ALL active/queued
  const all = await getJSON('http://127.0.0.1:4000/api/background-tasks?limit=200');
  const non = all.filter(x=>!['completed','failed','blocked','cancelled'].includes(x.status));
  console.log('--- non-terminal tasks ---');
  non.forEach(x=>console.log(x.taskId, x.status, x.worker, '| blocked:', x.metadata?.concurrency?.blocked, '|', x.createdAt));
})().catch(e=>console.log('ERR',e.message));
