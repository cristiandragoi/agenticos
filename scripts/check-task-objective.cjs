// check-task-objective.cjs — dump objective/originalRequest + run detectsCodexDelegation-equivalent
const http = require('http');
function get(u){return new Promise((res)=>{http.get(u,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>{try{res(JSON.parse(d))}catch{res({raw:d})}})})})}
(async()=>{
  const id = process.argv[2];
  const t = await get(`http://127.0.0.1:4000/api/background-tasks/${id}`);
  console.log('worker:', t.worker);
  console.log('objective:', JSON.stringify(t.objective));
  console.log('originalRequest:', JSON.stringify(t.originalRequest));
  const o = t.objective || t.originalRequest || '';
  const mentionsCodex = /\bcodex\b/i.test(o);
  const hasWorkVerb = /\b(implement|edit|modify|change|fix|refactor|add|write|build|test|inspect|analy[sz]e|read|search|run)\b/i.test(o);
  console.log('detectsCodexDelegation-equivalent =>', { mentionsCodex, hasWorkVerb, result: mentionsCodex && hasWorkVerb });
})();
