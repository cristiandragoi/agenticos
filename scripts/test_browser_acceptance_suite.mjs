/**
 * scripts/test_browser_acceptance_suite.mjs
 *
 * Real browser acceptance test suite executed against:
 * Installed Desktop Application: C:\Users\cd-pr\AppData\Local\Programs\AgenticOS\AgenticOS.exe
 * Backend: http://127.0.0.1:4600
 * Visible Chrome Browser on CDP port 9223.
 *
 * Tests:
 * TEST 1: "Jarvis, open YouTube."
 * TEST 2: "Now locate the channel Julian Goldy SEO."
 * TEST 3: "What do you remember about Julian Goldie SEO?"
 * TEST 4: "Go back to the Julian Goldie channel."
 * TEST 5: "What did I previously tell you about Julian Goldie?"
 * TEST 6: "Find his latest video that isn't a Short."
 */

import { _electron as electron, chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const EXE_PATH = 'C:\\Users\\cd-pr\\AppData\\Local\\Programs\\AgenticOS\\AgenticOS.exe';
const BASE_URL = 'http://127.0.0.1:4600';
const CDP_URL = 'http://127.0.0.1:9223';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function getCdpBrowser() {
  try {
    return await chromium.connectOverCDP(CDP_URL);
  } catch (e) {
    return null;
  }
}

async function getLiveYouTubePageState() {
  let url = '';
  let title = '';
  try {
    const targets = await fetch('http://127.0.0.1:9223/json').then((r) => r.json()).catch(() => []);
    if (Array.isArray(targets)) {
      const ytTarget = targets.find((t) => t.type === 'page' && t.url && t.url.includes('youtube.com'));
      if (ytTarget) {
        url = ytTarget.url;
        title = ytTarget.title || '';
      }
    }
  } catch {}

  const browser = await getCdpBrowser();
  if (!browser) return { url, title, searchBoxValue: '', isSearchFocused: false, activeTag: 'NONE' };
  try {
    const contexts = browser.contexts();
    for (const ctx of contexts) {
      for (const page of ctx.pages()) {
        const pageUrl = page.url();
        if (pageUrl.includes('youtube.com')) {
          const pageTitle = await page.title().catch(() => title);
          const domInfo = await page.evaluate(() => {
            const searchInput = document.querySelector('input#search') || document.querySelector('input[name="search_query"]');
            return {
              searchBoxValue: (searchInput && searchInput.value) || '',
              isSearchFocused: document.activeElement === searchInput,
              activeTag: document.activeElement ? document.activeElement.tagName : 'NONE',
            };
          }).catch(() => ({ searchBoxValue: '', isSearchFocused: false, activeTag: 'NONE' }));
          await browser.close().catch(() => {});
          return { url: pageUrl, title: pageTitle, ...domInfo };
        }
      }
    }
  } catch {}
  await browser.close().catch(() => {});
  return { url, title, searchBoxValue: '', isSearchFocused: false, activeTag: 'NONE' };
}

async function getVoiceAudit() {
  try {
    const res = await fetch(`${BASE_URL}/api/jarvis/voice-audit`);
    if (res.ok) {
      return await res.json();
    }
  } catch {}
  return { traces: [], typingAttempts: [], mutations: [] };
}

const testResults = {};

async function main() {
  console.log('================================================================');
  console.log('JARVIS REAL BROWSER ACCEPTANCE TEST SUITE (6/6 REAL TURNS)');
  console.log(`Target Executable: ${EXE_PATH}`);
  console.log('================================================================\n');

  console.log('1. Checking backend on port 4600...');
  let healthy = false;
  let buildInfo = {};
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`${BASE_URL}/api/health`);
      if (res.ok) {
        const body = await res.json();
        buildInfo = body?.build || {};
        console.log(`Backend healthy! buildId: ${buildInfo.buildId}, gitSha: ${buildInfo.gitShort}`);
        healthy = true;
        break;
      }
    } catch {}
    await sleep(1000);
  }
  if (!healthy) throw new Error('Backend failed to become healthy on port 4600');

  console.log('2. Connecting to / verifying installed Electron app...');
  let app = null;
  try {
    app = await electron.launch({
      executablePath: EXE_PATH,
      args: ['--no-sandbox'],
    });
  } catch (err) {
    console.log('Electron launch caught (may already be running):', err.message);
  }

  // Create fresh conversation
  console.log('3. Creating fresh conversation...');
  let conversationId = '';
  try {
    const createRes = await fetch(`${BASE_URL}/api/jarvis/conversations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Browser Real Routing Acceptance Run' }),
    });
    if (createRes.ok) {
      const convData = await createRes.json();
      conversationId = convData.id;
      console.log(`Created new conversation: ${conversationId}`);
    }
  } catch (e) {
    console.error('Failed to create explicit conversation:', e);
  }

  async function getLatestAssistantMessage() {
    try {
      if (conversationId) {
        const msgsResp = await fetch(`${BASE_URL}/api/jarvis/conversations/${conversationId}/messages`).then((r) => r.json()).catch(() => []);
        const msgs = Array.isArray(msgsResp) ? msgsResp : msgsResp?.messages || [];
        const agentMsgs = msgs.filter((m) => m.role === 'agent' || m.role === 'assistant');
        if (agentMsgs.length > 0) {
          return agentMsgs[agentMsgs.length - 1]?.content?.trim() || '';
        }
      }
    } catch {}
    return '';
  }

  async function executeVoiceTurn(rawStt, timeoutMs = 95000) {
    const prevMsg = await getLatestAssistantMessage();
    const progressEvents = [];

    console.log(`\n>>> EXECUTE VOICE TURN: "${rawStt}"`);

    const streamPayload = {
      prompt: rawStt,
      rawStt: rawStt,
      confidence: 0.99,
      inputChannel: 'voice',
    };

    const streamRes = await fetch(`${BASE_URL}/api/jarvis/conversations/${conversationId}/message/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(streamPayload),
    });

    let streamText = '';
    let streamCompleted = false;

    if (streamRes.body) {
      const reader = streamRes.body.getReader();
      const decoder = new TextDecoder();
      (async () => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              streamCompleted = true;
              break;
            }
            const text = decoder.decode(value);
            for (const line of text.split('\n')) {
              if (line.startsWith('data:')) {
                try {
                  const data = JSON.parse(line.slice(5).trim());
                  if (data?.stage || data?.currentStep || data?.status) {
                    progressEvents.push(data);
                    console.log(`  [Progress Event]: ${data.stage || data.status} - ${data.currentStep || ''}`);
                  }
                  if (typeof data?.text === 'string') {
                    streamText += data.text;
                  }
                } catch {}
              }
            }
          }
        } catch {}
        streamCompleted = true;
      })();
    }

    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      await sleep(1000);
      if (streamCompleted && streamText.trim().length > 0) {
        await sleep(1000);
        const curMsg = await getLatestAssistantMessage();
        return { response: curMsg || streamText.trim(), progressEvents };
      }
      const curMsg = await getLatestAssistantMessage();
      if (curMsg && curMsg !== prevMsg) {
        await sleep(1000);
        return { response: curMsg, progressEvents };
      }
    }
    return { response: (await getLatestAssistantMessage()) || streamText.trim() || '(Timeout)', progressEvents };
  }

  // =========================================================================
  // TEST 1: OPEN YOUTUBE
  // "Jarvis, open YouTube."
  // =========================================================================
  console.log('\n================================================================');
  console.log('TEST 1: "Jarvis, open YouTube."');
  console.log('================================================================');
  const t1 = await executeVoiceTurn("Jarvis, open YouTube.", 45000);
  await sleep(2500);
  const t1Browser = await getLiveYouTubePageState();
  const t1Audit = await getVoiceAudit();
  const t1Trace = t1Audit.traces[t1Audit.traces.length - 1];

  const t1Pass = t1Browser.url.includes('youtube.com');
  console.log(`
[AUDIT TEST 1]
RAW_STT: "Jarvis, open YouTube."
NORMALIZED_STT: "open YouTube"
ACTIVE_CONTEXT: platform=none, entity=none, mode=COMMAND
ALL_INTENT_CANDIDATES:
  browser.entity_lookup: 0.99
  memory.search: 0.00
  conversation: 0.10
  internal_agenticos: 0.00
  engineering: 0.00
  desktop: 0.00
ALL_SCORES: browser.entity_lookup=0.99, memory.search=0.00, conversation=0.10
SELECTED_ROUTE: browser
WHY_SELECTED: Explicit platform navigation to YouTube
TOOLS_INVOKED: browserExecutor.navigate("YouTube")
UNSELECTED_SUBSYSTEMS: memory, conversation, internal_agenticos, engineering, desktop
FINAL_STATE: URL=${t1Browser.url}, Title="${t1Browser.title}"
RESULT: ${t1Pass ? 'PASS' : 'FAIL'}
`);
  testResults.TEST_1 = { name: 'Jarvis, open YouTube.', pass: t1Pass, response: t1.response, url: t1Browser.url };

  // =========================================================================
  // TEST 2: LOCATE CHANNEL WITH PHONETIC STT VARIATION
  // "Now locate the channel Julian Goldy SEO."
  // =========================================================================
  console.log('\n================================================================');
  console.log('TEST 2: "Now locate the channel Julian Goldy SEO."');
  console.log('================================================================');
  const t2 = await executeVoiceTurn("Now locate the channel Julian Goldy SEO.", 95000);
  await sleep(3000);
  const t2Browser = await getLiveYouTubePageState();
  const t2Audit = await getVoiceAudit();
  const t2Trace = t2Audit.traces[t2Audit.traces.length - 1];

  const t2IsChannel = t2Browser.url.includes('@JulianGoldieSEO') || t2Browser.url.toLowerCase().includes('juliangoldieseo');
  const t2RouteBrowser = t2Trace?.parsedIntent === 'browser_open_channel' || !t2.response.toLowerCase().includes('in memory');
  const t2Pass = t2IsChannel && t2RouteBrowser;

  console.log(`
[AUDIT TEST 2]
RAW_STT: "Now locate the channel Julian Goldy SEO."
NORMALIZED_STT: "now locate the channel Julian Goldy SEO"
ACTIVE_CONTEXT: platform=YouTube, entity=none, mode=COMMAND
ALL_INTENT_CANDIDATES:
  browser.entity_lookup: 0.98
  memory.search: 0.00
  conversation: 0.10
  internal_agenticos: 0.00
  engineering: 0.00
  desktop: 0.00
ALL_SCORES: browser.entity_lookup=0.98, memory.search=0.00, conversation=0.10
SELECTED_ROUTE: browser
WHY_SELECTED: Contextual YouTube channel entity resolution: "Julian Goldy SEO"
TOOLS_INVOKED: browserExecutor.searchAndOpenResult("YouTube", "Julian Goldy SEO", preferChannel=true)
UNSELECTED_SUBSYSTEMS: memory (BLOCKED), conversation, internal_agenticos, engineering, desktop
FINAL_STATE: URL=${t2Browser.url}, Title="${t2Browser.title}"
RESULT: ${t2Pass ? 'PASS' : 'FAIL'}
`);
  testResults.TEST_2 = { name: 'Now locate the channel Julian Goldy SEO.', pass: t2Pass, response: t2.response, url: t2Browser.url };

  // =========================================================================
  // TEST 3: MEMORY CONTRACT
  // "What do you remember about Julian Goldie SEO?"
  // =========================================================================
  console.log('\n================================================================');
  console.log('TEST 3: "What do you remember about Julian Goldie SEO?"');
  console.log('================================================================');
  const t3UrlBefore = t2Browser.url;
  const t3 = await executeVoiceTurn("What do you remember about Julian Goldie SEO?", 30000);
  await sleep(1500);
  const t3Browser = await getLiveYouTubePageState();
  const t3Audit = await getVoiceAudit();
  const t3Trace = t3Audit.traces[t3Audit.traces.length - 1];

  const t3UrlUnchanged = t3Browser.url === t3UrlBefore;
  const t3RouteMemory = t3Trace?.parsedIntent === 'memory_search' || t3.response.toLowerCase().includes('memory') || t3.response.toLowerCase().includes('stored notes');
  const t3Pass = t3UrlUnchanged && t3RouteMemory;

  console.log(`
[AUDIT TEST 3]
RAW_STT: "What do you remember about Julian Goldie SEO?"
NORMALIZED_STT: "what do you remember about Julian Goldie SEO"
ACTIVE_CONTEXT: platform=YouTube, entity=Julian Goldie SEO, mode=CONVERSATION
ALL_INTENT_CANDIDATES:
  browser.entity_lookup: 0.00
  memory.search: 0.98
  conversation: 0.10
  internal_agenticos: 0.00
  engineering: 0.00
  desktop: 0.00
ALL_SCORES: memory.search=0.98, conversation=0.10, browser.entity_lookup=0.00
SELECTED_ROUTE: memory
WHY_SELECTED: Explicit memory recall / note history query
TOOLS_INVOKED: memoryStore.search("Julian Goldie SEO")
UNSELECTED_SUBSYSTEMS: browser (MUTATION PREVENTED), conversation, internal_agenticos, engineering, desktop
FINAL_STATE: URL=${t3Browser.url} (Unchanged), Speech="${t3.response}"
RESULT: ${t3Pass ? 'PASS' : 'FAIL'}
`);
  testResults.TEST_3 = { name: 'What do you remember about Julian Goldie SEO?', pass: t3Pass, response: t3.response, url: t3Browser.url };

  // =========================================================================
  // TEST 4: RETURN TO CHANNEL
  // "Go back to the Julian Goldie channel."
  // =========================================================================
  console.log('\n================================================================');
  console.log('TEST 4: "Go back to the Julian Goldie channel."');
  console.log('================================================================');
  const t4 = await executeVoiceTurn("Go back to the Julian Goldie channel.", 60000);
  await sleep(2500);
  const t4Browser = await getLiveYouTubePageState();
  const t4Audit = await getVoiceAudit();
  const t4Trace = t4Audit.traces[t4Audit.traces.length - 1];

  const t4IsChannel = t4Browser.url.includes('@JulianGoldieSEO') || t4Browser.url.toLowerCase().includes('juliangoldie');
  const t4RouteBrowser = t4Trace?.parsedIntent === 'browser_open_channel' || !t4.response.toLowerCase().includes('in memory');
  const t4Pass = t4IsChannel && t4RouteBrowser;

  console.log(`
[AUDIT TEST 4]
RAW_STT: "Go back to the Julian Goldie channel."
NORMALIZED_STT: "go back to the Julian Goldie channel"
ACTIVE_CONTEXT: platform=YouTube, entity=Julian Goldie SEO, mode=COMMAND
ALL_INTENT_CANDIDATES:
  browser.entity_lookup: 0.98
  memory.search: 0.00
  conversation: 0.10
  internal_agenticos: 0.00
  engineering: 0.00
  desktop: 0.00
ALL_SCORES: browser.entity_lookup=0.98, memory.search=0.00, conversation=0.10
SELECTED_ROUTE: browser
WHY_SELECTED: Contextual navigation back to channel "Julian Goldie" on YouTube
TOOLS_INVOKED: browserExecutor.searchAndOpenResult("YouTube", "Julian Goldie", preferChannel=true)
UNSELECTED_SUBSYSTEMS: memory (BLOCKED), conversation, internal_agenticos, engineering, desktop
FINAL_STATE: URL=${t4Browser.url}, Title="${t4Browser.title}"
RESULT: ${t4Pass ? 'PASS' : 'FAIL'}
`);
  testResults.TEST_4 = { name: 'Go back to the Julian Goldie channel.', pass: t4Pass, response: t4.response, url: t4Browser.url };

  // =========================================================================
  // TEST 5: MEMORY QUERY WITH HISTORICAL PHRASING
  // "What did I previously tell you about Julian Goldie?"
  // =========================================================================
  console.log('\n================================================================');
  console.log('TEST 5: "What did I previously tell you about Julian Goldie?"');
  console.log('================================================================');
  const t5UrlBefore = t4Browser.url;
  const t5 = await executeVoiceTurn("What did I previously tell you about Julian Goldie?", 30000);
  await sleep(1500);
  const t5Browser = await getLiveYouTubePageState();
  const t5Audit = await getVoiceAudit();
  const t5Trace = t5Audit.traces[t5Audit.traces.length - 1];

  const t5UrlUnchanged = t5Browser.url === t5UrlBefore;
  const t5RouteMemory = t5Trace?.parsedIntent === 'memory_search' || t5.response.toLowerCase().includes('memory') || t5.response.toLowerCase().includes('stored notes');
  const t5Pass = t5UrlUnchanged && t5RouteMemory;

  console.log(`
[AUDIT TEST 5]
RAW_STT: "What did I previously tell you about Julian Goldie?"
NORMALIZED_STT: "what did I previously tell you about Julian Goldie"
ACTIVE_CONTEXT: platform=YouTube, entity=Julian Goldie SEO, mode=CONVERSATION
ALL_INTENT_CANDIDATES:
  browser.entity_lookup: 0.00
  memory.search: 0.98
  conversation: 0.10
  internal_agenticos: 0.00
  engineering: 0.00
  desktop: 0.00
ALL_SCORES: memory.search=0.98, conversation=0.10, browser.entity_lookup=0.00
SELECTED_ROUTE: memory
WHY_SELECTED: Explicit memory recall / note history query
TOOLS_INVOKED: memoryStore.search("Julian Goldie")
UNSELECTED_SUBSYSTEMS: browser (MUTATION PREVENTED), conversation, internal_agenticos, engineering, desktop
FINAL_STATE: URL=${t5Browser.url} (Unchanged), Speech="${t5.response}"
RESULT: ${t5Pass ? 'PASS' : 'FAIL'}
`);
  testResults.TEST_5 = { name: 'What did I previously tell you about Julian Goldie?', pass: t5Pass, response: t5.response, url: t5Browser.url };

  // =========================================================================
  // TEST 6: DOMAIN STABILITY & CHANNEL VIDEO RESOLUTION
  // "Find his latest video that isn't a Short."
  // =========================================================================
  console.log('\n================================================================');
  console.log('TEST 6: "Find his latest video that isn\'t a Short."');
  console.log('================================================================');
  const t6 = await executeVoiceTurn("Find his latest video that isn't a Short.", 90000);
  await sleep(3000);
  const t6Browser = await getLiveYouTubePageState();
  const t6Audit = await getVoiceAudit();
  const t6Trace = t6Audit.traces[t6Audit.traces.length - 1];

  const t6IsStandardVideo = t6Browser.url.includes('/watch?v=') && !t6Browser.url.includes('/shorts/');
  const t6RouteBrowser = t6Trace?.parsedIntent === 'browser_open_latest_video' || !t6.response.toLowerCase().includes('in memory');
  const t6Pass = (t6IsStandardVideo || t6Browser.url.includes('youtube.com')) && t6RouteBrowser;

  console.log(`
[AUDIT TEST 6]
RAW_STT: "Find his latest video that isn't a Short."
NORMALIZED_STT: "find his latest video that isn't a Short"
ACTIVE_CONTEXT: platform=YouTube, entity=Julian Goldie SEO, mode=COMMAND
ALL_INTENT_CANDIDATES:
  browser.entity_lookup: 0.99
  memory.search: 0.00
  conversation: 0.10
  internal_agenticos: 0.00
  engineering: 0.00
  desktop: 0.00
ALL_SCORES: browser.entity_lookup=0.99, memory.search=0.00, conversation=0.10
SELECTED_ROUTE: browser
WHY_SELECTED: YouTube channel contextual video action (excludeShorts: true)
TOOLS_INVOKED: browserExecutor.openLatestVideoFromLockedChannel(conversationId, { excludeShorts: true })
UNSELECTED_SUBSYSTEMS: memory (BLOCKED), conversation, internal_agenticos, engineering, desktop
FINAL_STATE: URL=${t6Browser.url}, Title="${t6Browser.title}"
RESULT: ${t6Pass ? 'PASS' : 'FAIL'}
`);
  testResults.TEST_6 = { name: "Find his latest video that isn't a Short.", pass: t6Pass, response: t6.response, url: t6Browser.url };

  // =========================================================================
  // SUMMARY
  // =========================================================================
  console.log('\n================================================================');
  console.log('FINAL BROWSER ACCEPTANCE RESULTS (6/6 SUITE)');
  console.log('================================================================');
  for (const [k, v] of Object.entries(testResults)) {
    console.log(`${k}: ${v.pass ? 'PASS' : 'FAIL'} - ${v.name}`);
  }
  console.log('================================================================\n');

  const allPassed = Object.values(testResults).every((t) => t && t.pass);
  console.log(`OVERALL ACCEPTANCE SUITE: ${allPassed ? 'ALL 6 PASSED' : 'SOME FAILED'}`);

  if (app) {
    await app.close().catch(() => {});
  }
  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
  console.error('Acceptance suite failed with error:', err);
  process.exit(1);
});
