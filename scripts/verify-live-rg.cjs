// verify-live-rg.cjs — dispatch a real CodeX task through the LIVE packaged
// backend (port 4000) and verify it executes `rg` and resolves the repo root.
const http = require('http');
const BASE = 'http://127.0.0.1:4000';

function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request(`${BASE}${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {},
    }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(d); } });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

(async () => {
  const objective = [
    'Search the repository for occurrences of "WebGLRenderer" using ripgrep, and report:',
    '1. the ripgrep version (rg --version)',
    '2. the matches (rg "WebGLRenderer" .)',
    '3. the repository root (git rev-parse --show-toplevel)',
    'Provide the exact command outputs.',
  ].join('\n');

  const task = await req('POST', '/api/background-tasks', {
    title: 'Post-restart CodeX rg readiness probe',
    objective,
    worker: 'codex',
    workspacePath: 'B:\\AgenticOS',
  });
  console.log('[dispatch]', JSON.stringify(task).slice(0, 400));
  const taskId = task.taskId || task.id;
  if (!taskId) { console.error('NO TASK ID'); process.exit(2); }

  const deadline = Date.now() + 180000;
  let st = task;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 5000));
    st = await req('GET', `/api/background-tasks/${taskId}`);
    const s = st.status || st.state || st.lifecycleState;
    console.log('[poll]', s, '|', (st.summary || st.resultSummary || '').toString().slice(0, 120));
    if (['completed', 'failed', 'cancelled', 'error', 'blocked', 'terminated'].includes(s)) break;
  }

  const blob = JSON.stringify(st);
  console.log('\n=== RESULT ===');
  console.log(blob.slice(0, 3000));

  const checks = {
    ripgrepVersion: /ripgrep/i.test(blob),
    webglSearch: /WebGLRenderer/i.test(blob),
    repoRoot: /B:[\\/]AgenticOS/i.test(blob),
    blockedByPolicy: /blocked by policy/i.test(blob),
    status: st.status || st.state,
  };
  console.log('\n=== CHECKS ===', JSON.stringify(checks, null, 2));
  const pass = checks.ripgrepVersion && checks.webglSearch && checks.repoRoot && !checks.blockedByPolicy && checks.status === 'completed';
  console.log(`\n=== LIVE RG VERIFY ${pass ? 'PASS' : 'FAIL'} ===`);
  process.exit(pass ? 0 : 2);
})();
