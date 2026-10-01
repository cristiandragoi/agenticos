/**
 * RC2 — no silence for handled turns, driven through the REAL turnRouter.
 *
 * The voice path routes through turnRouter.routeTurn(). The defect is that
 * finish() used to fall back to an EMPTY spoken string for a handled turn whose
 * entity could not be resolved, which jarvisNextAgent then completed as
 * `quiet_recovery`: the user got no response at all.
 *
 * The routing decision itself is NOT mocked. Only external side-effect surfaces
 * are replaced:
 *   - node:child_process: the choke point for launching Chrome, Outlook,
 *     Calculator, Comet, PowerShell automation, shell commands, ...
 *   - the desktop / browser executor singletons (application launching,
 *     browser navigation, desktop automation)
 *   - the Telegram adapter (UI actions, network)
 *   - the LLM gateway (outbound network)
 * So no real GUI application can be opened by this suite.
 *
 * Each turn runs against a REAL conversation row created through
 * conversationService, so the database requirements of the routing path are
 * satisfied rather than bypassed.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';

// ── Hard safety: nothing in this suite may spawn a process. ──────────────────
const fakeChild = () => ({
  on: () => {}, once: () => {}, off: () => {}, emit: () => {},
  stdout: null, stderr: null, stdin: null, kill: () => {}, unref: () => {},
  pid: 4242, killed: false, exitCode: 0,
});
vi.mock('node:child_process', () => ({
  spawn: vi.fn(fakeChild),
  fork: vi.fn(fakeChild),
  exec: vi.fn((_c: any, cb: any) => { cb?.(null, '', ''); return fakeChild(); }),
  execFile: vi.fn((_f: any, _a: any, cb: any) => { cb?.(null, '', ''); return fakeChild(); }),
  execSync: vi.fn(() => Buffer.from('')),
  execFileSync: vi.fn(() => Buffer.from('')),
  spawnSync: vi.fn(() => ({ status: 0, stdout: Buffer.from(''), stderr: Buffer.from(''), pid: 4242 })),
  default: {},
}));
vi.mock('child_process', () => ({
  spawn: vi.fn(fakeChild),
  exec: vi.fn((_c: any, cb: any) => { cb?.(null, '', ''); return fakeChild(); }),
  execSync: vi.fn(() => Buffer.from('')),
  spawnSync: vi.fn(() => ({ status: 0, stdout: Buffer.from(''), stderr: Buffer.from('') })),
  default: {},
}));

// ── External side-effect executors / adapters (never the routing decision). ──
vi.mock('../domains/jarvis/execution/executors/desktopExecutor.js', () => {
  const cache = new Map<string, any>();
  const stub: any = new Proxy({}, {
    get(_t, prop) {
      if (typeof prop === 'symbol' || prop === 'then') return undefined;
      if (!cache.has(prop as string)) {
        cache.set(prop as string, vi.fn(async () => ({
          ok: true, success: true, handled: true, verified: false, executed: false,
          output: '', message: `desktopExecutor.${String(prop)} stubbed — no real application was launched`,
          data: {},
        })));
      }
      return cache.get(prop as string);
    },
  });
  return { desktopExecutor: stub, DesktopExecutor: class {}, KNOWN_DESKTOP_APPS: [] };
});
vi.mock('../domains/jarvis/execution/executors/browserExecutor.js', () => {
  const cache = new Map<string, any>();
  const stub: any = new Proxy({}, {
    get(_t, prop) {
      if (typeof prop === 'symbol' || prop === 'then') return undefined;
      if (!cache.has(prop as string)) {
        cache.set(prop as string, vi.fn(async () => ({
          ok: true, success: true, handled: true, verified: false, executed: false,
          output: '', message: `browserExecutor.${String(prop)} stubbed — no real browser navigation`,
          data: {},
        })));
      }
      return cache.get(prop as string);
    },
  });
  return { browserExecutor: stub, BrowserExecutor: class {} };
});
vi.mock('../adapters/telegramAdapter.js', () => {
  const cache = new Map<string, any>();
  const stub: any = new Proxy({}, {
    get(_t, prop) {
      if (typeof prop === 'symbol' || prop === 'then') return undefined;
      if (!cache.has(prop as string)) {
        cache.set(prop as string, vi.fn(async () => ({
          ok: true, success: true, handled: true, verified: false, executed: false,
          output: '', message: `telegramAdapter.${String(prop)} stubbed — no real Telegram UI action`,
          data: {},
        })));
      }
      return cache.get(prop as string);
    },
  });
  return { telegramAdapter: stub, TelegramAdapter: class {} };
});

vi.mock('../services/llmGateway.js', () => ({
  llmChat: vi.fn(async () => ({ reply: 'stubbed conversational reply' })),
}));

import { routeTurn } from '../domains/jarvisNext/turnRouter.js';
import { conversationService } from '../domains/conversations/service.js';

/** goalIds for which an empty spoken text is deliberate product behaviour. */
const INTENTIONAL_SILENCE_GOAL_IDS = new Set([
  'quiet_recovery', 'stop', 'suspended_ignored', 'wake_reactivated',
]);

const CORPUS = [
  'what is the status of the project',
  'tell me about something totally unrelated to anything',
  'how is the weather in Berlin today',
  'blah blah nonsense token sequence',
  'what do you think about the colour blue',
  'explain quantum entanglement briefly',
  'who won the world cup in 1998',
  'give me a poem about the sea',
  'summarize the meeting notes from yesterday',
  'do the thing with the stuff',
  'what happened to the plan',
  'compare two unrelated concepts for me',
  'what is the meaning of life',
  'describe the colour red',
  'is it going to rain tomorrow',
  'count from one to ten',
  'tell me a joke',
  'zzq wwv unknown entity request',
  'what else can you tell me about that',
  'give me an overview of nothing in particular',
];

type Observation = {
  prompt: string;
  handled: boolean | 'threw';
  route: string;
  goalId: string;
  silent: boolean;
  text: string;
  error?: string;
};

let conversationId: string;

async function observe(prompt: string, turnId: number): Promise<Observation> {
  try {
    const res: any = await routeTurn({
      prompt, conversationId, turnId, rawStt: prompt, confidence: 0.95,
    });
    return {
      prompt,
      handled: res?.handled === true,
      route: String(res?.route ?? ''),
      goalId: String(res?.goalId ?? ''),
      silent: res?.silent === true,
      text: String(res?.text ?? ''),
    };
  } catch (err: any) {
    return {
      prompt, handled: 'threw', route: '', goalId: '', silent: false, text: '',
      error: err?.message || String(err),
    };
  }
}

function printObservations(label: string, observations: Observation[]) {
  console.log(`\n[RC2] ${label}`);
  for (const o of observations) {
    console.log(
      `  handled=${String(o.handled).padEnd(5)} silent=${String(o.silent).padEnd(5)}` +
      ` goalId=${(o.goalId || '-').padEnd(18)} route=${(o.route || '-').padEnd(24)}` +
      ` text="${o.text}"${o.error ? ` ERROR=${o.error}` : ''}  <= ${o.prompt}`,
    );
  }
}

describe('RC2 — handled turns through the real turnRouter must not be silently empty', () => {
  beforeAll(async () => {
    // A real conversation row: the routing path's DB requirements are met, not bypassed.
    conversationId = await conversationService.createConversation('RC2 routing regression');
    expect(conversationId).toBeTruthy();
  });

  it('every handled turn in a 20-prompt corpus produces a spokeable outcome', async () => {
    const observations: Observation[] = [];
    for (let i = 0; i < CORPUS.length; i++) {
      observations.push(await observe(CORPUS[i], i + 1));
    }
    printObservations('routeTurn observations (20-prompt corpus):', observations);

    const thrown = observations.filter((o) => o.handled === 'threw');
    const unexplainedSilence = observations.filter(
      (o) =>
        o.handled === true &&
        o.text.trim() === '' &&
        !o.silent &&
        !INTENTIONAL_SILENCE_GOAL_IDS.has(o.goalId),
    );

    expect(thrown.map((o) => `${o.prompt}: ${o.error}`)).toEqual([]);
    expect(
      unexplainedSilence.map((o) => `${o.prompt} (route=${o.route}, goalId=${o.goalId})`),
    ).toEqual([]);
  }, 180_000);

  it('an entity-less request that reaches the generic fallback is never silent', async () => {
    const o = await observe('what else can you tell me about that', 99);
    printObservations('entity-less fallback probe:', [o]);

    if (o.handled === true && o.text.trim() === '') {
      // Explicitly intentional silence is allowed; anything else is the RC2 defect.
      expect(o.silent || INTENTIONAL_SILENCE_GOAL_IDS.has(o.goalId)).toBe(true);
    } else {
      expect(o.text.trim().length).toBeGreaterThan(0);
    }
  }, 60_000);

  it('a desktop action whose executor cannot perform it still yields a terminal, non-silent outcome', async () => {
    // Executor + process spawning are stubbed, so the action cannot really happen.
    // The turn must still terminate with something the user can hear, rather than
    // completing silently.
    const o = await observe('open Calculator', 98);
    printObservations('desktop action probe (no application is actually opened):', [o]);

    expect(o.handled).not.toBe('threw');
    if (o.handled === true) {
      expect(o.silent || o.text.trim().length > 0).toBe(true);
    }
  }, 60_000);
});
