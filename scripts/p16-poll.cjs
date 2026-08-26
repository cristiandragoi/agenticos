// Poll the decisive task + its CodeX goal until terminal or timeout.
const http = require('http');
const TASK = 'bgtask-23d51e1e5';
const GOAL = 'goal-f882a4b2-';

function get(path) {
  return new Promise((resolve) => {
    http.get(`http://127.0.0.1:4000${path}`, (res) => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(null); } });
    }).on('error', () => resolve(null));
  });
}

(async () => {
  const start = Date.now();
  const deadline = start + 240000; // 4 min
  let lastGoal = null, lastTask = null;
  while (Date.now() < deadline) {
    const task = await get(`/api/background-tasks/${TASK}`);
    const goal = await get(`/api/chat/goals/${GOAL}`);
    const taskStatus = task?.status; const goalStatus = goal?.status;
    if (taskStatus !== lastTask || goalStatus !== lastGoal) {
      const ts = new Date().toISOString().slice(11, 19);
      console.log(`[${ts}] task=${taskStatus} (stage=${task?.currentStage}) goal=${goalStatus} progress="${(task?.progressMessage||'').slice(0,80)}"`);
      lastTask = taskStatus; lastGoal = goalStatus;
    }
    const terminal = ['completed','failed','cancelled','blocked'].includes(taskStatus);
    if (terminal) {
      console.log('\n=== TERMINAL ===');
      console.log('task status:', taskStatus);
      console.log('resultText:', (task?.resultText || '(none)').slice(0, 800));
      console.log('filesChanged:', JSON.stringify(task?.filesChanged || []));
      console.log('testState:', task?.testState, 'buildState:', task?.buildState);
      process.exit(0);
    }
    await new Promise(r => setTimeout(r, 5000));
  }
  console.log('\nTIMEOUT — still not terminal');
  console.log('last task:', lastTask, 'goal:', lastGoal);
  process.exit(1);
})();
