import { chromium } from 'playwright';

const BASE_URL = 'http://127.0.0.1:4600';
const CDP_URL = 'http://127.0.0.1:9223';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
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

  try {
    const browser = await chromium.connectOverCDP(CDP_URL).catch(() => null);
    if (browser) {
      for (const ctx of browser.contexts()) {
        for (const page of ctx.pages()) {
          const pageUrl = page.url();
          if (pageUrl.includes('youtube.com')) {
            const pageTitle = await page.title().catch(() => title);
            await browser.close().catch(() => {});
            return { url: pageUrl, title: pageTitle };
          }
        }
      }
      await browser.close().catch(() => {});
    }
  } catch {}
  return { url, title };
}

async function main() {
  console.log('================================================================');
  console.log('REAL COLD-START USER ACCEPTANCE COMMANDS');
  console.log('================================================================\n');

  // 1. Verify health
  const healthRes = await fetch(`${BASE_URL}/api/health`);
  const health = await healthRes.json();
  console.log(`Backend Health (PID ${health.pid}, uptime: ${health.uptime.toFixed(1)}s):`, health.status);

  // 2. Create conversation
  const convRes = await fetch(`${BASE_URL}/api/jarvis/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Cold-Start Operator Acceptance' }),
  });
  const conv = await convRes.json();
  const convId = conv.id;
  console.log(`Created conversation: ${convId}\n`);

  async function executeTurn(promptText) {
    console.log(`----------------------------------------------------------------`);
    console.log(`USER COMMAND: "${promptText}"`);
    console.log(`----------------------------------------------------------------`);

    const streamRes = await fetch(`${BASE_URL}/api/jarvis/conversations/${convId}/message/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: promptText,
        rawStt: promptText,
        confidence: 0.99,
        inputChannel: 'voice',
      }),
    });

    let streamText = '';
    const reader = streamRes.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value);
      for (const line of chunk.split('\n')) {
        if (line.startsWith('data:')) {
          try {
            const data = JSON.parse(line.slice(5).trim());
            if (data?.stage || data?.status || data?.currentStep) {
              console.log(`  [Progress]: stage=${data.stage || data.status} step=${data.currentStep || ''}`);
            }
            if (typeof data?.text === 'string') {
              streamText += data.text;
            }
            if (data?.response?.text) {
              streamText = data.response.text;
            }
          } catch {}
        }
      }
    }

    await sleep(2500);

    // Get audit
    const auditRes = await fetch(`${BASE_URL}/api/jarvis/voice-audit`).catch(() => null);
    let auditData = null;
    if (auditRes && auditRes.ok) {
      const auditJson = await auditRes.json();
      auditData = auditJson.traces?.[auditJson.traces.length - 1] || null;
    }

    const browserState = await getLiveYouTubePageState();

    console.log(`  [Response Text]: "${streamText.trim()}"`);
    if (auditData) {
      console.log(`  [Route Selected]: ${auditData.selectedRoute} (${auditData.whySelected})`);
      console.log(`  [Candidates]:`, auditData.allCandidates);
    }
    console.log(`  [Browser State]: URL=${browserState.url || 'none'} Title="${browserState.title || 'none'}"`);
    return { streamText, auditData, browserState };
  }

  // Turn 1
  const t1 = await executeTurn("Jarvis, open YouTube.");

  // Turn 2
  const t2 = await executeTurn("Now locate the channel Julian Goldy SEO.");

  // Turn 3
  const t3 = await executeTurn("Find his latest video that isn't a Short.");

  console.log('\n================================================================');
  console.log('ACCEPTANCE SUMMARY:');
  console.log('Turn 1 (Open YouTube):', t1.browserState.url.includes('youtube.com') ? 'PASS' : 'FAIL');
  console.log('Turn 2 (Locate Channel):', t2.browserState.url.includes('@JulianGoldie') || t2.browserState.url.includes('Julian') ? 'PASS' : 'FAIL');
  console.log('Turn 3 (Find Latest Video):', t3.browserState.url.includes('watch?v=') ? 'PASS' : 'FAIL');
  console.log('================================================================\n');
}

main().catch(console.error);
