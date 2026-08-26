// check-conv.cjs — dump the messages for a conversation id passed as argv[2]
const http = require('http');
function get(u){return new Promise((res)=>{http.get(u,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>{try{res(JSON.parse(d))}catch{res({raw:d})}})})})}
(async()=>{
  const id = process.argv[2];
  const m = await get(`http://127.0.0.1:4000/api/jarvis/conversations/${id}/messages`);
  const a = Array.isArray(m) ? m : (m.messages || []);
  console.log('messages:', a.length);
  for (const x of a) {
    const meta = x.metadata || {};
    console.log(`[${x.role}]${meta.resultReturn ? ' (RESULT-RETURN)' : ''}${meta.taskId ? ' task=' + meta.taskId : ''}: ${String(x.content).slice(0, 220)}`);
  }
})();
