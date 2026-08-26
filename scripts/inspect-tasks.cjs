// inspect-tasks.cjs — list non-terminal background tasks
const http = require('http');
function getJSON(url){return new Promise((res,rej)=>{http.get(url,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>{try{res(JSON.parse(d))}catch(e){rej(e)}}) }).on('error',rej)})}
(async()=>{
  const t = await getJSON('http://127.0.0.1:4000/api/background-tasks?limit=200');
  const non = t.filter(x=>!['completed','failed','blocked','cancelled'].includes(x.status));
  console.log('total:', t.length, '| non-terminal:', non.length);
  non.forEach(x=>console.log(x.taskId, '|', x.status, '|', x.worker, '|', x.route, '|', x.createdAt, '|', x.metadata?.delegatedCodexGoalId || x.metadata?.codexGoalId || ''));
})().catch(e=>console.log('ERR',e.message));
