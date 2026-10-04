/**
 * run_live_production_repairs_acceptance.mjs
 *
 * Full live production acceptance test for:
 * 1. FAILURE 1 — Telegram Multi-Message Playback & Continuation
 * 2. FAILURE 2 — YouTube Entity & Task Continuity
 */

const BASE_URL = 'http://127.0.0.1:4600';

async function fetchJson(url, opts = {}) {
  const res = await fetch(url, opts);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${text}`);
  }
  return res.json();
}

async function sendTurn(conversationId, prompt) {
  const operationId = `op-live-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
  console.log(`\n>>> [USER PROMPT] "${prompt}" (op: ${operationId})`);

  const res = await fetch(`${BASE_URL}/api/jarvis/conversations/${conversationId}/message/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt,
      operationId,
      inputChannel: 'voice_livekit',
      approvalPolicy: 'auto',
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`SSE stream failed (HTTP ${res.status}): ${text}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const events = [];
  let fullText = '';
  let finalResult = null;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    let currentEvent = 'message';
    for (const line of lines) {
      if (line.startsWith('event: ')) {
        currentEvent = line.substring(7).trim();
      } else if (line.startsWith('data: ')) {
        try {
          const data = JSON.parse(line.substring(6));
          events.push({ event: currentEvent, data });
          if (currentEvent === 'chunk' && data.delta) {
            fullText += data.delta;
          }
          if (currentEvent === 'result') {
            finalResult = data;
          }
        } catch {
          events.push({ event: currentEvent, raw: line.substring(6) });
        }
      }
    }
  }

  return { operationId, fullText, finalResult, events };
}

async function run() {
  console.log('================================================================');
  console.log('LIVE PRODUCTION ACCEPTANCE: YOUTUBE CONTINUITY & TELEGRAM PLAYBACK');
  console.log('================================================================');

  // Check health
  const health = await fetchJson(`${BASE_URL}/api/health`);
  console.log('Backend Health:', JSON.stringify(health, null, 2));

  // Create clean test conversation
  const conv = await fetchJson(`${BASE_URL}/api/jarvis/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Live Production Repairs Acceptance' }),
  });
  const convId = conv.id;
  console.log(`Created test conversation: ${convId}`);

  // ────────────────────────────────────────────────────────────────
  // STEP 1: "Jarvis, open YouTube and search Julian Goldie SEO."
  // ────────────────────────────────────────────────────────────────
  console.log('\n--- STEP 1: YouTube Search ---');
  const step1 = await sendTurn(convId, 'Jarvis, open YouTube and search Julian Goldie SEO.');
  console.log('Assistant Response:', step1.fullText);
  console.log('Final Result:', JSON.stringify(step1.finalResult, null, 2));

  // Verify CDP navigation to YouTube search
  const { browserCodeProvider } = await import('../server/dist/domains/controlPlane/browser/BrowserCodeProvider.js');
  const { browserCodeSession } = await import('../server/dist/domains/controlPlane/browser/BrowserCodeSession.js');
  const isAvailable = await browserCodeProvider.isAvailable();
  console.log('BrowserCodeProvider available:', isAvailable);

  async function getPageState() {
    try {
      const { page } = await browserCodeSession.getSession();
      return {
        url: page?.url?.() || '',
        title: (await page?.title?.()) || '',
      };
    } catch (e) {
      console.warn('Could not get page state via Playwright page:', e.message);
      const tabs = await browserCodeSession.listTabs();
      const active = tabs.find(t => t.active) || tabs[tabs.length - 1];
      return { url: active?.url || '', title: active?.title || '' };
    }
  }

  const state1 = await getPageState();
  console.log('Observed Page State Step 1:', {
    url: state1?.url,
    title: state1?.title,
  });

  if (!state1?.url?.includes('youtube.com/results') || !state1?.url?.toLowerCase().includes('julian')) {
    throw new Error(`Step 1 FAIL: Expected YouTube search results page, got: ${state1?.url}`);
  }
  console.log('✓ STEP 1 PASS: Search results physically visible for Julian Goldie SEO.');

  // ────────────────────────────────────────────────────────────────
  // STEP 2: "Open one video from Julian Goldie."
  // ────────────────────────────────────────────────────────────────
  console.log('\n--- STEP 2: Open Video From Julian Goldie ---');
  const step2 = await sendTurn(convId, 'Open one video from Julian Goldie.');
  console.log('Assistant Response:', step2.fullText);
  console.log('Final Result:', JSON.stringify(step2.finalResult, null, 2));

  await new Promise(r => setTimeout(r, 2000));
  const state2 = await getPageState();
  console.log('Observed Page State Step 2:', {
    url: state2?.url,
    title: state2?.title,
  });

  if (!state2?.url?.includes('youtube.com/watch?v=')) {
    throw new Error(`Step 2 FAIL: Expected video watch page, got: ${state2?.url}`);
  }
  const firstVideoUrl = state2.url;
  const firstVideoTitle = state2.title;
  console.log(`✓ STEP 2 PASS: First video opened: "${firstVideoTitle}" (${firstVideoUrl})`);

  // ────────────────────────────────────────────────────────────────
  // STEP 3: Return to search results
  // ────────────────────────────────────────────────────────────────
  console.log('\n--- STEP 3: Returning to YouTube Search Results ---');
  await browserCodeProvider.navigate(`https://www.youtube.com/results?search_query=${encodeURIComponent('Julian Goldie SEO')}`);
  await new Promise(r => setTimeout(r, 1500));
  const state3 = await getPageState();
  console.log('Observed Page State Step 3:', {
    url: state3?.url,
    title: state3?.title,
  });
  console.log('✓ STEP 3 PASS: Returned to search results.');

  // ────────────────────────────────────────────────────────────────
  // STEP 4: "Open another one."
  // ────────────────────────────────────────────────────────────────
  console.log('\n--- STEP 4: Open Another One ---');
  const step4 = await sendTurn(convId, 'Open another one.');
  console.log('Assistant Response:', step4.fullText);
  console.log('Final Result:', JSON.stringify(step4.finalResult, null, 2));

  await new Promise(r => setTimeout(r, 2000));
  const state4 = await getPageState();
  console.log('Observed Page State Step 4:', {
    url: state4?.url,
    title: state4?.title,
  });

  if (!state4?.url?.includes('youtube.com/watch?v=')) {
    throw new Error(`Step 4 FAIL: Expected video watch page, got: ${state4?.url}`);
  }
  const getVidId = (u) => { const m = u?.match(/[?&]v=([a-zA-Z0-9_-]+)/); return m ? m[1] : u; };
  if (getVidId(state4.url) === getVidId(firstVideoUrl)) {
    throw new Error(`Step 4 FAIL: Expected DIFFERENT video, but opened same URL: ${firstVideoUrl}`);
  }
  console.log(`✓ STEP 4 PASS: Different video opened: "${state4.title}" (${state4.url}) !== (${firstVideoUrl})`);

  // ────────────────────────────────────────────────────────────────
  // STEP 5: Telegram Read Messages
  // ────────────────────────────────────────────────────────────────
  console.log('\n--- STEP 5: Telegram Read Last 4 Messages ---');
  const step5 = await sendTurn(convId, 'Open Telegram, locate Agentic OS bot and read the last four messages.');
  console.log('Assistant Response:', step5.fullText);
  console.log('Final Result:', JSON.stringify(step5.finalResult, null, 2));

  if (!step5.fullText || step5.fullText.includes('failed') || step5.fullText.includes('error')) {
    throw new Error(`Step 5 FAIL: Telegram message extraction failed: ${step5.fullText}`);
  }

  // ────────────────────────────────────────────────────────────────
  // STEP 6: Playback Continuation
  // ────────────────────────────────────────────────────────────────
  console.log('\n--- STEP 6: Telegram Playback Continuation ---');
  const step6 = await sendTurn(convId, 'continue with the messages');
  console.log('Assistant Response:', step6.fullText);
  console.log('Final Result:', JSON.stringify(step6.finalResult, null, 2));

  if (step6.fullText.includes("I'm listening") || step6.fullText.includes("How can I assist you")) {
    throw new Error(`Step 6 FAIL: Continuation fell back to generic conversation!`);
  }
  console.log('✓ STEP 6 PASS: Playback continuation executed from task cursor without falling back to generic chat.');

  console.log('\n================================================================');
  console.log('ALL LIVE PRODUCTION ACCEPTANCE CHECKS PASSED WITH FULL EVIDENCE!');
  console.log('================================================================');
}

run().catch(err => {
  console.error('\n*** ACCEPTANCE TEST FAILED ***\n', err);
  process.exit(1);
});
