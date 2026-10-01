/**
 * scripts/verify-cross-turn-gui-acceptance.cjs
 *
 * Real GUI acceptance test for Phase 10:
 * Scenario A — Contextual YouTube workflow (Open YouTube -> Search for Moritz Jarvis -> Open the first result)
 * Scenario B — Explicit search (Search YouTube for AI agents)
 * Scenario C — Change platform explicitly with YouTube active (Search Google for Agentic AI)
 * Scenario D — Filesystem (Open the AgenticOS folder, Open D:\AgenticOS)
 * Scenario E — Internal navigation regression (Open Free Cash)
 *
 * Uses installed runtime: C:\Users\cd-pr\AppData\Local\Programs\AgenticOS\AgenticOS.exe
 */

'use strict';

const { _electron: electron } = require('playwright');
const path = require('path');
const fs = require('fs');
const http = require('http');

const ROOT = path.resolve(__dirname, '..');
const INSTALLED_EXE_PATH = 'C:\\Users\\cd-pr\\AppData\\Local\\Programs\\AgenticOS\\AgenticOS.exe';
const SCREENSHOT_DIR = path.resolve(ROOT, 'docs', 'acceptance', 'screenshots', 'cross_turn_acceptance');
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

function log(msg, obj) {
  console.log(`[GUI-CrossTurn] ${msg}`, obj !== undefined ? (typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2)) : '');
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

async function submitPromptAndGetReply(page, promptText, waitMs = 8000) {
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

  const report = {
    timestamp: new Date().toISOString(),
    backendBuildId: health.build?.buildId,
    scenarios: {},
  };

  // ═════════════════════════════════════════════════════════════════════════════
  // SCENARIO A — Contextual YouTube workflow (Turn 1 -> Turn 2 -> Turn 3)
  // ═════════════════════════════════════════════════════════════════════════════
  log('\n=== SCENARIO A: Contextual YouTube Workflow ===');
  await startFreshConversation(page);
  const scenarioAResults = [];

  // Turn 1: Open YouTube
  log('Scenario A - Turn 1: Open YouTube');
  const aTurn1 = await submitPromptAndGetReply(page, 'Open YouTube', 8000);
  const shotA1 = path.join(SCREENSHOT_DIR, 'scenario_a_turn_1_open_youtube.png');
  await page.screenshot({ path: shotA1 }).catch(() => {});
  log('Turn 1 reply:', aTurn1.reply);
  scenarioAResults.push({ step: 'Open YouTube', reply: aTurn1.reply, screenshot: shotA1 });

  // Turn 2: Search for Moritz Jarvis
  log('Scenario A - Turn 2: Search for Moritz Jarvis');
  const aTurn2 = await submitPromptAndGetReply(page, 'Search for Moritz Jarvis', 10000);
  const shotA2 = path.join(SCREENSHOT_DIR, 'scenario_a_turn_2_search_moritz.png');
  await page.screenshot({ path: shotA2 }).catch(() => {});
  log('Turn 2 reply:', aTurn2.reply);
  scenarioAResults.push({ step: 'Search for Moritz Jarvis', reply: aTurn2.reply, screenshot: shotA2 });

  // Turn 3: Open the first result
  log('Scenario A - Turn 3: Open the first result');
  const aTurn3 = await submitPromptAndGetReply(page, 'Open the first result', 10000);
  const shotA3 = path.join(SCREENSHOT_DIR, 'scenario_a_turn_3_open_first_result.png');
  await page.screenshot({ path: shotA3 }).catch(() => {});
  log('Turn 3 reply:', aTurn3.reply);
  scenarioAResults.push({ step: 'Open the first result', reply: aTurn3.reply, screenshot: shotA3 });

  report.scenarios.scenarioA = scenarioAResults;

  // ═════════════════════════════════════════════════════════════════════════════
  // SCENARIO B — Explicit search (Search YouTube for AI agents)
  // ═════════════════════════════════════════════════════════════════════════════
  log('\n=== SCENARIO B: Explicit Search ===');
  await startFreshConversation(page);
  log('Scenario B: Search YouTube for AI agents');
  const bRes = await submitPromptAndGetReply(page, 'Search YouTube for AI agents', 10000);
  const shotB = path.join(SCREENSHOT_DIR, 'scenario_b_search_youtube_ai_agents.png');
  await page.screenshot({ path: shotB }).catch(() => {});
  log('Scenario B reply:', bRes.reply);
  report.scenarios.scenarioB = { prompt: 'Search YouTube for AI agents', reply: bRes.reply, screenshot: shotB };

  // ═════════════════════════════════════════════════════════════════════════════
  // SCENARIO C — Change platform explicitly (Search Google for Agentic AI while YouTube active)
  // ═════════════════════════════════════════════════════════════════════════════
  log('\n=== SCENARIO C: Override active platform explicitly ===');
  // First ensure YouTube is active
  await submitPromptAndGetReply(page, 'Open YouTube', 6000);
  log('Scenario C: Search Google for Agentic AI (with YouTube active)');
  const cRes = await submitPromptAndGetReply(page, 'Search Google for Agentic AI', 10000);
  const shotC = path.join(SCREENSHOT_DIR, 'scenario_c_search_google_override.png');
  await page.screenshot({ path: shotC }).catch(() => {});
  log('Scenario C reply:', cRes.reply);
  report.scenarios.scenarioC = { prompt: 'Search Google for Agentic AI', reply: cRes.reply, screenshot: shotC };

  // ═════════════════════════════════════════════════════════════════════════════
  // SCENARIO D — Filesystem / Folder routing
  // ═════════════════════════════════════════════════════════════════════════════
  log('\n=== SCENARIO D: Filesystem / Folder Routing ===');
  await startFreshConversation(page);
  log('Scenario D1: Open the AgenticOS folder');
  const d1Res = await submitPromptAndGetReply(page, 'Open the AgenticOS folder', 6000);
  const shotD1 = path.join(SCREENSHOT_DIR, 'scenario_d1_open_agenticos_folder.png');
  await page.screenshot({ path: shotD1 }).catch(() => {});
  log('Scenario D1 reply:', d1Res.reply);

  log('Scenario D2: Open D:\\AgenticOS');
  const d2Res = await submitPromptAndGetReply(page, 'Open D:\\AgenticOS', 6000);
  const shotD2 = path.join(SCREENSHOT_DIR, 'scenario_d2_open_direct_path.png');
  await page.screenshot({ path: shotD2 }).catch(() => {});
  log('Scenario D2 reply:', d2Res.reply);

  report.scenarios.scenarioD = {
    agenticosFolder: { prompt: 'Open the AgenticOS folder', reply: d1Res.reply, screenshot: shotD1 },
    directPath: { prompt: 'Open D:\\AgenticOS', reply: d2Res.reply, screenshot: shotD2 },
  };

  // ═════════════════════════════════════════════════════════════════════════════
  // SCENARIO E — Internal navigation regression (Open Free Cash)
  // ═════════════════════════════════════════════════════════════════════════════
  log('\n=== SCENARIO E: Internal Navigation Regression ===');
  await startFreshConversation(page);
  log('Scenario E: Open Free Cash');
  const eRes = await submitPromptAndGetReply(page, 'Open Free Cash', 6000);
  const shotE = path.join(SCREENSHOT_DIR, 'scenario_e_open_free_cash.png');
  await page.screenshot({ path: shotE }).catch(() => {});
  log('Scenario E reply:', eRes.reply);
  report.scenarios.scenarioE = { prompt: 'Open Free Cash', reply: eRes.reply, screenshot: shotE };

  // Close app
  await app.close();

  // Save report
  const reportPath = path.join(ROOT, 'docs', 'acceptance', 'cross_turn_gui_report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  log('All GUI acceptance scenarios complete. Report saved to:', reportPath);
}

main().catch((err) => {
  console.error('[GUI-CrossTurn] Fatal error:', err);
  process.exit(1);
});
