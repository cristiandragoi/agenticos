// dump-goal.cjs — full goal finalAnswer + tool events
const http = require('http');
function getJSON(url){return new Promise((res,rej)=>{http.get(url,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>{try{res(JSON.parse(d))}catch(e){rej(e)}}) }).on('error',rej)})}
const goalId = process.argv[2] || 'goal-0f18a54e-';
(async()=>{
  try {
    const g = await getJSON('http://127.0.0.1:4000/api/chat/goals/' + goalId);
    console.log('=== status:', g.status, '===');
    console.log('=== FULL finalAnswer ===');
    console.log(g.runSummary?.finalAnswer || g.finalAnswer || '(none)');
    console.log('\n=== runSummary ===');
    console.log(JSON.stringify(g.runSummary || g.summary || {}, null, 2).slice(0, 2000));
    console.log('\n=== history/tool events (first 40) ===');
    const h = g.history || g.events || [];
    h.slice(0, 40).forEach((e, i) => {
      console.log(i, JSON.stringify(e).slice(0, 300));
    });
  } catch(e) {
    console.log('ERR:', e.message);
  }
})().catch(e=>console.log('ERR',e.message));
