// dump-goal-errors.cjs — show full error/payload fields of failed/retrying goal events
const http = require('http');
function getJSON(url){return new Promise((res,rej)=>{http.get(url,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>{try{res(JSON.parse(d))}catch(e){rej(e)}}) }).on('error',rej)})}
(async()=>{
  const goalId = process.argv[2] || 'goal-64532735-';
  const g = await getJSON('http://127.0.0.1:4000/api/chat/goals/' + goalId);
  const h = g.history || g.events || [];
  console.log('total events:', h.length, '| status:', g.status);
  // print retrying + failed events with full error details
  h.forEach((e, i) => {
    const s = e.state || e.eventType;
    if (s === 'retrying' || s === 'failed' || (e.error)) {
      console.log('\n--- event', i, '| state:', s, '| step:', e.step);
      console.log('message:', (e.message||'').slice(0, 300));
      if (e.error) console.log('error:', JSON.stringify(e.error).slice(0, 500));
      if (e.payload) console.log('payload:', JSON.stringify(e.payload).slice(0, 500));
    }
  });
})().catch(e=>console.log('ERR',e.message));
