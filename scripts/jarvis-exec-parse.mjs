// Properly parse /api/execution/current: current slot + top of history.
const res = await fetch('http://127.0.0.1:4000/api/execution/current');
const d = await res.json();
console.log('CURRENT:', d.current ? JSON.stringify({ op: d.current.operationId, status: d.current.status, endedAt: d.current.endedAt, worker: d.current.worker }) : 'null');
console.log('HISTORY[0]:', d.history[0] ? JSON.stringify({ op: d.history[0].operationId, status: d.history[0].status, endedAt: d.history[0].endedAt }) : '-');
console.log('HISTORY[1]:', d.history[1] ? JSON.stringify({ op: d.history[1].operationId, status: d.history[1].status, endedAt: d.history[1].endedAt }) : '-');
