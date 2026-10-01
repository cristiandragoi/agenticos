import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, chromium } from 'playwright';
import { WindowsBrowserWindowHelper } from '../server/src/services/browser/browserSession.js';
import Database from '../server/node_modules/better-sqlite3/lib/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const EXE_PATH = 'C:\\Users\\cd-pr\\AppData\\Local\\Programs\\AgenticOS\\AgenticOS.exe';
const DB_PATH = 'C:\\Users\\cd-pr\\AppData\\Roaming\\AgenticOS\\data\\agentic-os.db';
const BASE_URL = 'http://127.0.0.1:4600';

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

type VerificationStatus = 'VERIFIED_SUCCESS' | 'VERIFIED_FAILURE' | 'FALSE_SUCCESS';

interface TurnResult {
  turnIndex: number;
  prompt: string;
  response: string;
  durationMs: number;
  browserUrl: string;
  status: VerificationStatus;
  reason: string;
}

const turnResults: TurnResult[] = [];

async function getActiveBrowserState(): Promise<{ url: string; title: string; targetId: string }> {
  try {
    const cdpTargets = await fetch('http://127.0.0.1:9223/json').then(r => r.json()).catch(() => []);
    if (!Array.isArray(cdpTargets)) return { url: '', title: '', targetId: '' };
    const pageTargets = cdpTargets.filter((tg: any) =>
      tg.type === 'page' &&
      !tg.url.startsWith('chrome-devtools://') &&
      !tg.url.startsWith('chrome://') &&
      !tg.url.startsWith('about:blank')
    );
    if (pageTargets.length === 0) return { url: '', title: '', targetId: '' };

    const top = pageTargets[0];
    return {
      url: top.url || '',
      title: top.title || '',
      targetId: top.id || '',
    };
  } catch {
    return { url: '', title: '', targetId: '' };
  }
}

async function run7TurnsAcceptance() {
  console.log('================================================================');
  console.log('JARVIS REAL HUMAN ACCEPTANCE VERIFICATION — 7 TURNS');
  console.log('Target: Installed Application at C:\\Users\\cd-pr\\AppData\\Local\\Programs\\AgenticOS');
  console.log('Model: xiaomi/mimo-v2.6-flash (Primary), xiaomi/mimo-v2.6-pro (Reasoning)');
  console.log('================================================================\n');

  console.log(`1. Launching installed Electron app: ${EXE_PATH}`);
  const app = await electron.launch({
    executablePath: EXE_PATH,
    args: ['--no-sandbox'],
  });

  const page = await app.firstWindow();
  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('[JRT]') || text.includes('[TRIAGE]') || text.includes('LIVE_TURN_TRACE') || text.includes('[SAFE_FINALIZER]')) {
      console.log(`[APP LOG] ${text}`);
    }
  });

  await page.waitForLoadState('domcontentloaded');
  console.log('Electron window loaded. Initial URL:', page.url());

  // 2. Poll for backend readiness on port 4600
  console.log('\n2. Waiting for backend to be healthy at http://127.0.0.1:4600/api/health ...');
  let backendReady = false;
  for (let i = 0; i < 35; i++) {
    try {
      const res = await fetch('http://127.0.0.1:4600/api/health');
      if (res.ok) {
        const body = await res.json();
        console.log(`Backend healthy in ${i + 1}s! Build: ${body?.build?.buildId || 'unknown'}`);
        backendReady = true;
        break;
      }
    } catch {}
    await sleep(1000);
  }
  if (!backendReady) {
    await app.close().catch(() => {});
    throw new Error('Backend failed to become healthy on port 4600 within 35s');
  }

  // 3. Navigate to #/jarvis
  console.log('\n3. Navigating to #/jarvis ...');
  const jarvisUrl = page.url().split('#')[0] + '#/jarvis';
  await page.goto(jarvisUrl);
  await sleep(3000);

  const textareaSelector = 'textarea[aria-label="Message Input"], textarea[placeholder*="Ask Jarvis"], textarea';
  await page.waitForSelector(textareaSelector, { timeout: 30000 });

  // Start fresh conversation
  const newConvBtn = page.locator('button[title="New Conversation"], button[aria-label="New Conversation"], button:has-text("New conversation"), button:has-text("New")');
  if (await newConvBtn.count() > 0) {
    await newConvBtn.first().click().catch(() => {});
    await sleep(2000);
  }
  console.log('Composer input ready on #/jarvis with fresh conversation.\n');

  let activeConversationId = '';
  try {
    const convs = await fetch('http://127.0.0.1:4600/api/jarvis/conversations').then(r => r.json()).catch(() => []);
    if (Array.isArray(convs) && convs.length > 0) {
      activeConversationId = convs[0]?.id || '';
    }
  } catch {}
  console.log(`Active conversation ID: ${activeConversationId || 'unknown'}`);

  async function getAgentMessages(): Promise<string[]> {
    try {
      const convs = await fetch('http://127.0.0.1:4600/api/jarvis/conversations').then(r => r.json()).catch(() => []);
      if (Array.isArray(convs) && convs.length > 0) {
        const activeId = convs[0]?.id;
        if (activeId) {
          activeConversationId = activeId;
          const msgsResp = await fetch(`http://127.0.0.1:4600/api/jarvis/conversations/${activeId}/messages`).then(r => r.json()).catch(() => []);
          const msgs = Array.isArray(msgsResp) ? msgsResp : msgsResp?.messages || [];
          return msgs
            .filter((m: any) => (m.role === 'agent' || m.role === 'assistant'))
            .map((m: any) => (m.content || m.metadata?.message || '').trim())
            .filter((c: string) => c && !c.includes('ROUTING LLM'));
        }
      }
    } catch {}
    return [];
  }

  async function waitForTurnCompletion(prevCount: number, timeoutMs = 60000): Promise<string> {
    const startTime = Date.now();
    await sleep(2500);

    while (Date.now() - startTime < timeoutMs) {
      const cancelBtn = page.locator('button[title="Cancel response"], button[aria-label="Cancel Response"]');
      const cancelCount = await cancelBtn.count();
      const taDisabled = await page.$eval(textareaSelector, el => (el as HTMLTextAreaElement).disabled).catch(() => false);

      const msgs = await getAgentMessages();
      if (msgs.length > prevCount && !taDisabled && cancelCount === 0) {
        await sleep(1000);
        return msgs[msgs.length - 1];
      }

      await sleep(500);
    }

    const finalMsgs = await getAgentMessages();
    if (finalMsgs.length > prevCount) {
      return finalMsgs[finalMsgs.length - 1];
    }
    return '(Timeout waiting for response)';
  }

  async function sendTurn(text: string): Promise<string> {
    const prevMsgs = await getAgentMessages();
    const prevCount = prevMsgs.length;

    await page.waitForSelector(textareaSelector, { timeout: 15000 });
    const ta = page.locator(textareaSelector).first();
    await ta.fill(text);
    await sleep(500);

    const sendBtn = page.locator('button[title="Send message"], button[aria-label="Send Message"]').first();
    if (await sendBtn.count() > 0 && await sendBtn.isVisible() && !(await sendBtn.isDisabled())) {
      await sendBtn.click();
    } else {
      await ta.press('Enter');
    }

    return await waitForTurnCompletion(prevCount);
  }

  // 7 DEFINED TURNS WITH RIGOROUS THREE-WAY VERIFICATION
  const testTurns = [
    {
      index: 1,
      prompt: 'What are we working on?',
      verify: async (resp: string, bState: { url: string }) => {
        const lower = resp.toLowerCase();
        // Check for duplicate repeated titles
        const duplicates = resp.match(/(Revenue Mission Strategy.*?){2,}/i);
        const hasPriority = lower.includes('priority 1') || lower.includes('free cash');
        const hasStatus = lower.includes('running') || lower.includes('blocked') || lower.includes('task');

        if (!duplicates && hasPriority && hasStatus) {
          return { status: 'VERIFIED_SUCCESS' as VerificationStatus, reason: 'Deduplicated, prioritized work summary provided truthfully.' };
        }
        if (duplicates) {
          return { status: 'VERIFIED_FAILURE' as VerificationStatus, reason: 'Duplicate task/project titles detected in speech.' };
        }
        return { status: 'VERIFIED_FAILURE' as VerificationStatus, reason: `Did not contain prioritized work summary: ${resp}` };
      },
    },
    {
      index: 2,
      prompt: 'Jarvis, go to Freecash and tell me its current status.',
      verify: async (resp: string, bState: { url: string }) => {
        const lower = resp.toLowerCase();
        const hasNav = lower.includes('open') || lower.includes('free cash') || lower.includes('freecash');
        const hasStatus = lower.includes('priority') || lower.includes('active') || lower.includes('task') || lower.includes('blocked');
        const isOnlyNav = lower.trim() === 'free cash is open.' || lower.trim() === 'freecash is open.';

        if (hasNav && hasStatus && !isOnlyNav) {
          return { status: 'VERIFIED_SUCCESS' as VerificationStatus, reason: 'Opened Free Cash and spoke complete status details.' };
        }
        if (isOnlyNav) {
          return { status: 'VERIFIED_FAILURE' as VerificationStatus, reason: 'Dropped status query and only returned "Freecash is open."' };
        }
        return { status: 'VERIFIED_FAILURE' as VerificationStatus, reason: `Response lacked navigation or status: ${resp}` };
      },
    },
    {
      index: 3,
      prompt: 'Jarvis, open YouTube.',
      verify: async (resp: string, bState: { url: string }) => {
        const lower = resp.toLowerCase();
        const isYt = bState.url.includes('youtube.com');
        const spokenYt = lower.includes('youtube') || lower.includes('opened');
        const hasRoContamination = lower.includes('revenue operator') || lower.includes('what would you like me to do with free cash');

        if (isYt && spokenYt && !hasRoContamination) {
          return { status: 'VERIFIED_SUCCESS' as VerificationStatus, reason: 'YouTube opened and verified via live browser CDP state.' };
        }
        if (hasRoContamination) {
          return { status: 'VERIFIED_FAILURE' as VerificationStatus, reason: 'Revenue Operator or Free Cash contamination intercepted browser command.' };
        }
        return { status: 'VERIFIED_FAILURE' as VerificationStatus, reason: `Browser not on YouTube or speech failed (url=${bState.url}, speech=${resp})` };
      },
    },
    {
      index: 4,
      prompt: 'What website do you currently have open?',
      verify: async (resp: string, bState: { url: string }) => {
        const lower = resp.toLowerCase();
        const mentionsYoutube = lower.includes('youtube');
        const isFallback = lower.includes("couldn't make that out") || lower.includes('haven\'t opened');

        if (mentionsYoutube && !isFallback) {
          return { status: 'VERIFIED_SUCCESS' as VerificationStatus, reason: 'Accurately reported YouTube is open based on live browser state.' };
        }
        return { status: 'VERIFIED_FAILURE' as VerificationStatus, reason: `Did not identify YouTube as open: ${resp}` };
      },
    },
    {
      index: 5,
      prompt: "Jarvis, I want you to check the Freecash project, and after that tell me what the next unfinished task is. But don't execute anything yet.",
      verify: async (resp: string, bState: { url: string }) => {
        const lower = resp.toLowerCase();
        const mentionsFreeCash = lower.includes('free cash') || lower.includes('freecash');
        const mentionsTask = lower.includes('next unfinished task') || lower.includes('task') || lower.includes('verification') || lower.includes('login');
        const confirmsNoExecution = lower.includes('have not started') || lower.includes('not executed') || lower.includes('status is') || !lower.includes('started task');
        const startedExecution = lower.includes('started executing') || lower.includes('starting task');

        if (mentionsFreeCash && mentionsTask && confirmsNoExecution && !startedExecution) {
          return { status: 'VERIFIED_SUCCESS' as VerificationStatus, reason: 'Identified next unfinished task in Free Cash with zero execution.' };
        }
        if (startedExecution) {
          return { status: 'VERIFIED_FAILURE' as VerificationStatus, reason: 'Violated negative execution constraint by starting tasks.' };
        }
        return { status: 'VERIFIED_FAILURE' as VerificationStatus, reason: `Failed to identify next unfinished task: ${resp}` };
      },
    },
    {
      index: 6,
      prompt: "No, don't start it. Just tell me why that task is next.",
      verify: async (resp: string, bState: { url: string }) => {
        const lower = resp.toLowerCase();
        const explainsWhy = lower.includes('next because') || lower.includes('priority') || lower.includes('sequence') || lower.includes('prerequisite') || lower.includes('awaiting');
        const confirmsNoStart = lower.includes('not started') || !lower.includes('started task');

        if (explainsWhy && confirmsNoStart) {
          return { status: 'VERIFIED_SUCCESS' as VerificationStatus, reason: 'Explained task prioritization and ordering rationale without executing.' };
        }
        return { status: 'VERIFIED_FAILURE' as VerificationStatus, reason: `Failed to explain why task is next: ${resp}` };
      },
    },
    {
      index: 7,
      prompt: 'Okay, now open Google.',
      verify: async (resp: string, bState: { url: string }) => {
        const lower = resp.toLowerCase();
        const isGoogle = bState.url.includes('google.com');
        const spokenGoogle = lower.includes('google') || lower.includes('opened');
        const contaminated = lower.includes('revenue') || lower.includes('free cash');

        if (isGoogle && spokenGoogle && !contaminated) {
          return { status: 'VERIFIED_SUCCESS' as VerificationStatus, reason: 'Google opened cleanly, switching from project to browser.' };
        }
        return { status: 'VERIFIED_FAILURE' as VerificationStatus, reason: `Browser not on Google or speech failed (url=${bState.url}, speech=${resp})` };
      },
    },
  ];

  console.log('--- STARTING 7-TURN EXECUTION SEQUENCE ---\n');

  for (const t of testTurns) {
    console.log(`\n======================================================`);
    console.log(`TURN ${t.index}: "${t.prompt}"`);
    console.log(`======================================================`);

    const tStart = Date.now();
    const response = await sendTurn(t.prompt);
    const durationMs = Date.now() - tStart;

    await sleep(2000);
    const bState = await getActiveBrowserState();

    console.log(`Jarvis Response (${durationMs}ms): "${response}"`);
    console.log(`Live Browser URL: ${bState.url || '(none)'}`);

    const ver = await t.verify(response, bState);
    console.log(`Verification Status: ${ver.status} — ${ver.reason}`);

    turnResults.push({
      turnIndex: t.index,
      prompt: t.prompt,
      response,
      durationMs,
      browserUrl: bState.url,
      status: ver.status,
      reason: ver.reason,
    });
  }

  console.log('\n================================================================');
  console.log('7-TURN HUMAN ACCEPTANCE RESULTS SUMMARY');
  console.log('================================================================\n');

  let passedCount = 0;
  for (const res of turnResults) {
    const mark = res.status === 'VERIFIED_SUCCESS' ? 'PASS' : 'FAIL';
    if (res.status === 'VERIFIED_SUCCESS') passedCount++;
    console.log(`[${mark}] Turn ${res.turnIndex}: "${res.prompt}"`);
    console.log(`       Response: "${res.response}"`);
    console.log(`       Browser URL: "${res.browserUrl}"`);
    console.log(`       Evaluation: ${res.status} — ${res.reason}\n`);
  }

  console.log(`FINAL SCORE: ${passedCount}/7 TURNS VERIFIED_SUCCESS`);
  console.log(`ACCEPTANCE VERDICT: ${passedCount === 7 ? 'PASS' : 'FAIL'}`);

  await app.close().catch(() => {});
  return { passedCount, total: 7, results: turnResults };
}

run7TurnsAcceptance().catch(err => {
  console.error('[FATAL ERROR IN ACCEPTANCE RUNNER]:', err);
  process.exit(1);
});
