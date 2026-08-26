const http = require('http');

function get(path) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port: 4000, path, timeout: 5000 }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', (e) => resolve({ status: -1, error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ status: -1, error: 'timeout' }); });
  });
}

(async () => {
  const health = await get('/api/health');
  console.log('HEALTH', health.status, health.body);

  const runtimes = await get('/api/dispatch/capability/runtimes');
  console.log('\nRUNTIMES', runtimes.status);
  try {
    const j = JSON.parse(runtimes.body);
    console.log(JSON.stringify(j.runtimes, null, 2));
  } catch (e) {
    console.log(runtimes.body.slice(0, 500));
  }

  const status = await get('/api/revenue-supervisor/status');
  console.log('\nSUPERVISOR STATUS', status.status);
  try {
    const d = JSON.parse(status.body);
    const pick = {
      controlState: d.controlState,
      activeMissionId: d.activeMissionId,
      activeMissionTitle: d.activeMissionTitle,
      cycleCount: d.cycleCount,
      lastCycleAt: d.lastCycleAt,
      activeBranchesCount: d.activeBranchesCount,
      pausedBranchesCount: d.pausedBranchesCount,
      completedBranchesCount: d.completedBranchesCount,
      argusVerificationStatus: d.argusVerificationStatus,
      hasLatestBriefing: !!d.latestBriefing,
    };
    console.log(JSON.stringify(pick, null, 2));
  } catch (e) {
    console.log(status.body.slice(0, 500));
  }
})();
