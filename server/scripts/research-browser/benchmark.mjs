import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire('/opt/tools/package.json');
const { chromium } = require('playwright');
const exec = promisify(execFile);
const cli = '/opt/tools/node_modules/agent-browser/bin/agent-browser.js';
const server = createServer((req, res) => {
  const token = new URL(req.url, 'http://localhost').searchParams.get('token');
  res.setHeader('Content-Type', 'text/html');
  res.end(`<h1>Browser evaluation</h1><p id="result">before-${token}</p><button id="confirm" onclick="document.querySelector('#result').textContent='after-${token}'">Confirm</button>`);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const trials = [];
let session;
async function candidate(args) {
  const { stdout } = await exec('node', [cli, '--session', session, '--executable-path', '/usr/bin/chromium', '--args', '--no-sandbox,--disable-dev-shm-usage', ...args], { timeout: 25000, maxBuffer: 100000 });
  return stdout;
}
try {
  for (let round = 0; round < 3; round++) {
    for (const backend of round % 2 ? ['agent-browser', 'playwright'] : ['playwright', 'agent-browser']) {
      const token = randomUUID();
      session = token;
      const url = `http://127.0.0.1:${server.address().port}/?token=${token}`;
      const start = performance.now();
      let before, after;
      if (backend === 'playwright') {
        const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
        try {
          const page = await browser.newPage(); await page.goto(url);
          before = await page.locator('#result').innerText();
          await page.locator('#confirm').click();
          after = await page.locator('#result').innerText();
        } finally { await browser.close(); }
      } else {
        try {
          await candidate(['open', url]);
          before = await candidate(['get', 'text', '#result']);
          await candidate(['click', '#confirm']);
          after = await candidate(['get', 'text', '#result']);
        } finally { await candidate(['close']).catch(() => {}); }
      }
      const verified = before.includes(`before-${token}`) && after.includes(`after-${token}`);
      trials.push({ backend, round, elapsedMs: Math.round(performance.now() - start), verified, readVerified: before.includes(`before-${token}`), clickOutcomeVerified: after.includes(`after-${token}`) });
      console.log(JSON.stringify({ type: 'trial', ...trials.at(-1) }));
      if (!verified) throw new Error('Independent DOM postcondition failed');
    }
  }
  console.log(JSON.stringify({ type: 'result', verified: trials.length === 6 && trials.every(t => t.verified), trials,
    repository: 'vercel-labs/agent-browser', packageVersion: '0.38.2', baseline: 'Playwright 1.61.1 primitive operations, same Chromium and fixture; not full AgenticOS/CDP latency',
    scope: 'Isolated fixture reading, clicking and DOM postcondition. No external websites, authenticated profile, production integration or voice latency validated.' }));
} finally { server.close(); }
