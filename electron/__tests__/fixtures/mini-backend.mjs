/**
 * Mini backend fixture for lifecycle E2E tests. Plain Node, no deps.
 * Behavior selected via E2E_MODE; PORT taken from env (explicit).
 *
 *   healthy        200 on /api/health, stays alive
 *   unhealthy      500 on every route (reachable but never healthy)
 *   exit-fast      prints stderr, exits 1 immediately (crash simulation)
 *   exit-once      first start crashes, later starts are healthy (uses
 *                  E2E_STATE_FILE marker) — crash-then-recover simulation
 *   crash-after    healthy, then exits 1 after E2E_CRASH_AFTER_MS
 *   never-ready    stays alive but never listens (readiness timeout)
 */
import fs from 'node:fs';
import http from 'node:http';

const mode = process.env.E2E_MODE || 'healthy';
const port = parseInt(process.env.PORT || '0', 10);

if (mode === 'exit-fast') {
  // Secret-looking value assembled from parts so no tooling layer mangles it.
  console.error('fixture: ' + ['api', 'key'].join('_') + '=' + ['ab', 'cd123'].join(''));
  console.error('fixture: simulated startup crash');
  process.exit(1);
}

if (mode === 'exit-once') {
  const marker = process.env.E2E_STATE_FILE;
  if (marker && !fs.existsSync(marker)) {
    fs.writeFileSync(marker, 'crashed-once');
    console.error('fixture: first-run simulated crash');
    process.exit(1);
  }
  // Fall through: marker present → healthy listen below.
}

if (mode === 'never-ready') {
  console.log('fixture: alive but will never listen');
  setInterval(() => {}, 60_000); // keep alive, no listener
} else {
  const server = http.createServer((req, res) => {
    if (mode === 'unhealthy') {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'fixture unhealthy' }));
      return;
    }
    if (req.url === '/api/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, service: 'fixture-backend', pid: process.pid }));
      return;
    }
    res.writeHead(404).end();
  });
  server.listen(port, '127.0.0.1', () => {
    console.log(`fixture: listening on ${port} (mode=${mode})`);
  });
  if (mode === 'crash-after') {
    const delay = parseInt(process.env.E2E_CRASH_AFTER_MS || '500', 10);
    setTimeout(() => {
      console.error('fixture: simulated delayed crash');
      process.exit(1);
    }, delay);
  }
}
