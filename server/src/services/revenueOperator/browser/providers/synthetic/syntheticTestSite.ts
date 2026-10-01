/**
 * syntheticTestSite.ts — In-process local HTTP server providing deterministic browser tasks.
 *
 * Exposes local, isolated pages for:
 * - CLICK_TASK
 * - FORM_TASK
 * - NAVIGATION_TASK
 * - VERIFY_REWARD_TASK
 * - GATED_TEST_TASK
 * - DENIED_TEST_TASK
 *
 * Operates purely locally on 127.0.0.1 with ephemeral port binding; 100% test reliable.
 */

import http from 'http';
import type { AddressInfo } from 'net';

export interface SyntheticTestSiteHandle {
  url: string;
  port: number;
  server: http.Server;
  close: () => Promise<void>;
  getBalance: (accountIdentifier?: string) => number;
  setTransientFailureCount: (count: number) => void;
  reset: () => void;
}

export function createSyntheticTestSite(): Promise<SyntheticTestSiteHandle> {
  return new Promise((resolve, reject) => {
    let balances: Record<string, number> = {};
    let transientFailuresRemaining = 0;

    const server = http.createServer((req, res) => {
      const parsedUrl = new URL(req.url || '/', 'http://127.0.0.1');
      const pathname = parsedUrl.pathname;
      const accountId = req.headers['x-provider-account-id'] as string || 'default';

      // Ensure account balance initialized
      if (balances[accountId] === undefined) {
        balances[accountId] = 0.0;
      }

      // Check simulated transient failures on completion endpoints
      if (pathname.includes('/complete') || pathname.includes('/submit')) {
        if (transientFailuresRemaining > 0) {
          transientFailuresRemaining--;
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Simulated transient server error' }));
          return;
        }
      }

      // ── API: Account Balance ───────────────────────────────────────────────
      if (pathname === '/api/account/balance') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ balance: balances[accountId], currency: 'EUR' }));
        return;
      }

      // ── HTML: Home / Session Dashboard ─────────────────────────────────────
      if (pathname === '/' || pathname === '/dashboard') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<!DOCTYPE html>
<html>
<head><title>Synthetic Revenue Testbed</title></head>
<body>
  <h1>Synthetic Task Platform</h1>
  <div id="session-status" data-authenticated="true">Session: Authenticated</div>
  <div id="account-identifier">${accountId}</div>
  <div id="account-balance">${balances[accountId].toFixed(2)} EUR</div>
  <nav>
    <a href="/tasks" id="tasks-link">Available Tasks</a>
  </nav>
</body>
</html>`);
        return;
      }

      // ── HTML: Task Board / Task Discovery ──────────────────────────────────
      if (pathname === '/tasks') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<!DOCTYPE html>
<html>
<head><title>Tasks Board</title></head>
<body>
  <h2>Available Synthetic Tasks</h2>
  <div class="task-list">
    <div class="task-item" data-task-id="syn-click-1" data-task-type="CLICK_TASK" data-reward="0.10">
      <a href="/tasks/click" class="task-link">Task 1: Simple Routine Click</a>
      <span class="reward">0.10 EUR</span>
    </div>
    <div class="task-item" data-task-id="syn-form-1" data-task-type="FORM_TASK" data-reward="0.25">
      <a href="/tasks/form" class="task-link">Task 2: Form Feedback Input</a>
      <span class="reward">0.25 EUR</span>
    </div>
    <div class="task-item" data-task-id="syn-nav-1" data-task-type="NAVIGATION_TASK" data-reward="0.15">
      <a href="/tasks/nav-step-1" class="task-link">Task 3: Multi-Step Navigation</a>
      <span class="reward">0.15 EUR</span>
    </div>
    <div class="task-item" data-task-id="syn-reward-1" data-task-type="VERIFY_REWARD_TASK" data-reward="0.20">
      <a href="/tasks/reward" class="task-link">Task 4: Reward Verification</a>
      <span class="reward">0.20 EUR</span>
    </div>
    <div class="task-item" data-task-id="syn-gate-1" data-task-type="GATED_TEST_TASK" data-reward="0.50">
      <a href="/tasks/gated" class="task-link">Task 5: Gated Payout Action</a>
      <span class="reward">0.50 EUR</span>
    </div>
    <div class="task-item" data-task-id="syn-deny-1" data-task-type="DENIED_TEST_TASK" data-reward="0.00">
      <a href="/tasks/denied" class="task-link">Task 6: Prohibited Purchase Action</a>
      <span class="reward">0.00 EUR</span>
    </div>
  </div>
</body>
</html>`);
        return;
      }

      // ── HTML: Task 1 (CLICK_TASK) ──────────────────────────────────────────
      if (pathname === '/tasks/click') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<!DOCTYPE html>
<html>
<head><title>Click Task</title></head>
<body>
  <h2>Routine Click Task</h2>
  <div id="task-status">PENDING</div>
  <button id="claim-btn" onclick="executeClaim()">Claim Reward</button>
  <div id="reward-message" style="display:none;">Reward claimed successfully!</div>

  <script>
    async function executeClaim() {
      const resp = await fetch('/tasks/click/complete', { method: 'POST' });
      const data = await resp.json();
      if (data.success) {
        document.getElementById('task-status').innerText = 'COMPLETED';
        document.getElementById('reward-message').style.display = 'block';
      }
    }
  </script>
</body>
</html>`);
        return;
      }

      if (pathname === '/tasks/click/complete' && req.method === 'POST') {
        balances[accountId] += 0.10;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, reward: 0.10, newBalance: balances[accountId] }));
        return;
      }

      // ── HTML: Task 2 (FORM_TASK) ───────────────────────────────────────────
      if (pathname === '/tasks/form') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<!DOCTYPE html>
<html>
<head><title>Form Fill Task</title></head>
<body>
  <h2>Form Feedback Task</h2>
  <form id="feedback-form" onsubmit="event.preventDefault(); submitForm();">
    <label for="feedback-input">Feedback:</label>
    <input type="text" id="feedback-input" name="feedback" value="" />
    <button type="submit" id="submit-feedback-btn">Submit Feedback</button>
  </form>
  <div id="form-result" style="display:none;">Form received!</div>

  <script>
    async function submitForm() {
      const feedback = document.getElementById('feedback-input').value;
      const resp = await fetch('/tasks/form/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feedback })
      });
      const data = await resp.json();
      if (data.success) {
        document.getElementById('form-result').style.display = 'block';
        document.getElementById('form-result').innerText = 'COMPLETED';
      }
    }
  </script>
</body>
</html>`);
        return;
      }

      if (pathname === '/tasks/form/submit' && req.method === 'POST') {
        balances[accountId] += 0.25;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, reward: 0.25, newBalance: balances[accountId] }));
        return;
      }

      // ── HTML: Task 3 (NAVIGATION_TASK) ─────────────────────────────────────
      if (pathname === '/tasks/nav-step-1') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<!DOCTYPE html>
<html>
<head><title>Nav Step 1</title></head>
<body>
  <h2>Navigation Flow: Step 1</h2>
  <a href="/tasks/nav-step-2" id="proceed-step-2">Proceed to Step 2</a>
</body>
</html>`);
        return;
      }

      if (pathname === '/tasks/nav-step-2') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<!DOCTYPE html>
<html>
<head><title>Nav Step 2</title></head>
<body>
  <h2>Navigation Flow: Step 2</h2>
  <button id="finish-nav-btn" onclick="finishNav()">Finish Navigation</button>
  <div id="nav-status">PENDING</div>

  <script>
    async function finishNav() {
      const resp = await fetch('/tasks/nav/complete', { method: 'POST' });
      const data = await resp.json();
      if (data.success) {
        document.getElementById('nav-status').innerText = 'COMPLETED';
      }
    }
  </script>
</body>
</html>`);
        return;
      }

      if (pathname === '/tasks/nav/complete' && req.method === 'POST') {
        balances[accountId] += 0.15;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, reward: 0.15, newBalance: balances[accountId] }));
        return;
      }

      // ── HTML: Task 4 (VERIFY_REWARD_TASK) ──────────────────────────────────
      if (pathname === '/tasks/reward') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<!DOCTYPE html>
<html>
<head><title>Reward Task</title></head>
<body>
  <h2>Reward Task</h2>
  <button id="claim-direct-btn" onclick="claimDirect()">Claim 0.20 EUR</button>
  <div id="reward-state">UNCLAIMED</div>
  <div id="balance-display">${balances[accountId].toFixed(2)} EUR</div>

  <script>
    async function claimDirect() {
      const resp = await fetch('/tasks/reward/claim', { method: 'POST' });
      const data = await resp.json();
      if (data.success) {
        document.getElementById('reward-state').innerText = 'COMPLETED';
        document.getElementById('balance-display').innerText = data.newBalance.toFixed(2) + ' EUR';
      }
    }
  </script>
</body>
</html>`);
        return;
      }

      if (pathname === '/tasks/reward/claim' && req.method === 'POST') {
        balances[accountId] += 0.20;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, reward: 0.20, newBalance: balances[accountId] }));
        return;
      }

      // ── HTML: Task 5 (GATED_TEST_TASK) ─────────────────────────────────────
      if (pathname === '/tasks/gated') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<!DOCTYPE html>
<html>
<head><title>Gated Task</title></head>
<body>
  <h2>High-Risk Payout Action</h2>
  <p>Withdraw balance to bank account</p>
  <button id="payout-btn">Guthaben auszahlen (Request Payout)</button>
  <div id="captcha-box" class="hcaptcha-challenge" style="display:none;">Solve Captcha</div>
</body>
</html>`);
        return;
      }

      // ── HTML: Task 6 (DENIED_TEST_TASK) ────────────────────────────────────
      if (pathname === '/tasks/denied') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<!DOCTYPE html>
<html>
<head><title>Denied Action</title></head>
<body>
  <h2>Prohibited Purchase</h2>
  <button id="purchase-pro-btn">Pay Now and Subscribe (9.99 EUR)</button>
  <a href="https://unauthorized-attacker.com/exploit" id="malicious-link">Visit Third Party</a>
</body>
</html>`);
        return;
      }

      // 404 Fallback
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    });

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo;
      const port = addr.port;
      const url = `http://127.0.0.1:${port}`;

      resolve({
        url,
        port,
        server,
        close: () =>
          new Promise<void>((res) => {
            server.close(() => res());
          }),
        getBalance: (accId: string = 'default') => balances[accId] ?? 0.0,
        setTransientFailureCount: (count: number) => {
          transientFailuresRemaining = count;
        },
        reset: () => {
          balances = {};
          transientFailuresRemaining = 0;
        },
      });
    });

    server.on('error', (err) => reject(err));
  });
}
