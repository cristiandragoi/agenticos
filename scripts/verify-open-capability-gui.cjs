/**
 * scripts/verify-open-capability-gui.cjs
 *
 * Real GUI acceptance test for the "Open [Target]" capability fix across
 * turnRouter and UniversalExecutionController.
 */
'use strict';

const { _electron: electron } = require('playwright');
const path = require('path');
const fs = require('fs');
const http = require('http');

const ROOT = path.resolve(__dirname, '..');
const INSTALLED_EXE_PATH = 'C:\\Users\\cd-pr\\AppData\\Local\\Programs\\AgenticOS\\AgenticOS.exe';
const SCREENSHOT_DIR = path.resolve(ROOT, 'docs', 'acceptance', 'screenshots', 'open_capability');
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

function log(msg, obj) {
  console.log(`[GUI-Open-Test] ${msg}`, obj !== undefined ? (typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2)) : '');
}

async function httpGet(urlPath, port = 4600) {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}${urlPath}`, { timeout: 5000 }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        try { resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, body: JSON.parse(body) }); }
        catch { resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, body }); }
      });
    });
    req.on('error', (err) => resolve({ ok: false, error: err.message }));
  });
}

async function httpPost(urlPath, data, port = 4600) {
  const payload = Buffer.from(JSON.stringify(data), 'utf8');
  return new Promise((resolve) => {
    const req = http.request(
      `http://127.0.0.1:${port}${urlPath}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': payload.length,
        },
        timeout: 10000,
      },
      (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => {
          try { resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, body: JSON.parse(body) }); }
          catch { resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, body }); }
        });
      }
    );
    req.on('error', (err) => resolve({ ok: false, error: err.message }));
    req.write(payload);
    req.end();
  });
}

async function waitForBackend(port = 4600, maxWaitMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const res = await httpGet('/api/health', port);
    if (res.ok && res.body?.status === 'healthy') {
      return res.body;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return null;
}

async function submitPromptAndGetReply(page, promptText, waitMs = 6000) {
  const composerSelector = 'textarea, input[placeholder*="Ask"], input[placeholder*="Message"]';
  await page.waitForSelector(composerSelector, { timeout: 15000 });
  const input = page.locator(composerSelector).first();
  await input.fill(promptText);
  await input.press('Enter');
  await page.waitForTimeout(waitMs);

  const messageSelector = '[data-testid="jarvis-command-line"]';
  const count = await page.locator(messageSelector).count();
  let latestJarvisReply = '';

  if (count > 0) {
    for (let i = count - 1; i >= 0; i--) {
      const line = page.locator(messageSelector).nth(i);
      const speaker = await line.locator('span').first().innerText().catch(() => '');
      if (speaker.includes('JARVIS')) {
        latestJarvisReply = await line.locator('span').nth(1).innerText().catch(() => '');
        break;
      }
    }
  }

  if (!latestJarvisReply) {
    const bubbles = page.locator('[data-testid="jarvis-chat-scroll"] .messageRow, div[class*="messageContent"]');
    const bCount = await bubbles.count();
    if (bCount > 0) {
      latestJarvisReply = await bubbles.nth(bCount - 1).innerText().catch(() => '');
    }
  }

  return {
    prompt: promptText,
    reply: latestJarvisReply.trim(),
  };
}

async function startFreshConversation(page) {
  const newChatBtn = page.locator('button[title*="New Conversation"], button[aria-label*="New Conversation"], button:has-text("New Conversation"), [data-testid="new-conversation-btn"]');
  if (await newChatBtn.count() > 0) {
    try {
      await newChatBtn.first().click();
      await page.waitForTimeout(1000);
      return;
    } catch {}
  }
  await page.evaluate(() => {
    sessionStorage.clear();
    window.location.hash = '#/jarvis';
  });
  await page.waitForTimeout(1500);
}

async function main() {
  log('Checking backend health on port 4600...');
  const health = await waitForBackend(4600);
  if (!health) {
    console.error('Backend not running on 4600');
    process.exit(1);
  }
  log('Backend buildId:', health.build?.buildId);

  log('Launching installed AgenticOS.exe from:', INSTALLED_EXE_PATH);
  const app = await electron.launch({
    executablePath: INSTALLED_EXE_PATH,
    args: ['--no-sandbox'],
    timeout: 45000,
  });

  const page = await app.firstWindow();
  log('App window ready. URL:', page.url());
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(3000);

  // Navigate to #/jarvis
  await page.evaluate(() => { window.location.hash = '#/jarvis'; });
  await page.waitForTimeout(3000);

  const dockToggle = page.locator('[data-testid="jarvis-dock-toggle"], button:has-text("Workspace"), button:has-text("Command")');
  if (await dockToggle.count() > 0) {
    try { await dockToggle.first().click(); await page.waitForTimeout(1000); } catch {}
  }

  const results = [];

  // ── 6 MANDATORY COMMANDS ──
  const commands = [
    'Open YouTube',
    'Open Google',
    'Go to youtube.com',
    'Search YouTube for AI agents',
    'Open Notepad',
    'Open the AgenticOS folder',
  ];

  log('--- Executing 6 Mandatory Commands ---');
  for (let i = 0; i < commands.length; i++) {
    const cmd = commands[i];
    log(`Executing Command ${i + 1}/${commands.length}: "${cmd}"`);
    await startFreshConversation(page);
    const res = await submitPromptAndGetReply(page, cmd, 6000);
    const screenshotPath = path.join(SCREENSHOT_DIR, `cmd_${i + 1}_${cmd.replace(/[^a-zA-Z0-9]/g, '_')}.png`);
    await page.screenshot({ path: screenshotPath }).catch(() => {});
    log(`Result for "${cmd}":`, res.reply);
    results.push({
      command: cmd,
      reply: res.reply,
      screenshot: screenshotPath,
    });
  }

  // ── 3-TURN CONTINUATION ──
  log('--- Executing 3-Turn Continuation ---');
  await startFreshConversation(page);
  const continuationTurns = [
    'Open YouTube.',
    'Search for Moritz Jarvis.',
    'Open the first result.',
  ];
  const continuationResults = [];
  for (let i = 0; i < continuationTurns.length; i++) {
    const turn = continuationTurns[i];
    log(`Continuation Turn ${i + 1}: "${turn}"`);
    const res = await submitPromptAndGetReply(page, turn, 7000);
    const screenshotPath = path.join(SCREENSHOT_DIR, `continuation_turn_${i + 1}.png`);
    await page.screenshot({ path: screenshotPath }).catch(() => {});
    log(`Turn ${i + 1} reply:`, res.reply);
    continuationResults.push({
      turn,
      reply: res.reply,
      screenshot: screenshotPath,
    });
  }

  // Close electron app
  await app.close();

  // Save report
  const finalReport = {
    timestamp: new Date().toISOString(),
    backendBuildId: health.build?.buildId,
    mandatoryCommands: results,
    continuation: continuationResults,
  };

  const reportPath = path.join(ROOT, 'docs', 'acceptance', 'open_capability_gui_report.json');
  fs.writeFileSync(reportPath, JSON.stringify(finalReport, null, 2));
  log('All GUI acceptance tests complete. Report saved to:', reportPath);
}

main().catch((err) => {
  console.error('[GUI-Open-Test] Fatal error:', err);
  process.exit(1);
});
