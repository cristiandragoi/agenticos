/**
 * foregroundScreenRead.test.ts — `read_foreground_screen`
 *
 * OS / window / UI side effects are mocked (PowerShell exec, vision model,
 * permission store). The routing and orchestration under test are REAL:
 * `detectForegroundScreenIntent`, `evaluateForegroundContent`,
 * `readForegroundScreen` and `turnRouter.routeTurn`.
 *
 * Fixtures mirror the physical root-cause findings in
 * `foreground_physical_rootcause.md`: UIA `.Name` returns accessibility labels,
 * Chromium/Electron reports ClientRect == WindowRect, and the old `length >= 20`
 * gate let label soup through as "content".
 *
 * No test manipulates the real desktop.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ── Mocked OS boundary ───────────────────────────────────────────────────────
type ExecResult = { stdout: string; stderr?: string };
let execHandler: (cmd: string) => ExecResult = () => ({ stdout: '' });
const spawnCalls: string[] = [];

/** Stand-in for child_process.exec: records the command, answers synchronously. */
function execImpl(cmd: string, optsOrCb: unknown, maybeCb?: unknown): void {
  const callback = (typeof optsOrCb === 'function' ? optsOrCb : maybeCb) as
    | ((err: null, stdout: string, stderr: string) => void)
    | undefined;
  spawnCalls.push(String(cmd));
  const result = execHandler(String(cmd));
  callback?.(null, result.stdout ?? '', result.stderr ?? '');
}

vi.mock('node:child_process', () => ({
  exec: vi.fn(execImpl),
  execSync: vi.fn(() => Buffer.from('')),
  spawn: vi.fn(() => ({ on: () => {}, kill: () => {}, pid: 1, stdout: null, stderr: null })),
}));
vi.mock('child_process', () => ({ exec: vi.fn(execImpl) }));

vi.mock('../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

let permissionAllowed = true;
vi.mock('../domains/controlPlane/CapabilityPermissionStore.js', () => ({
  capabilityPermissionStore: { isAllowed: () => permissionAllowed },
}));

let visionAnswer: string | null = null;
const visionCalls: string[] = [];
vi.mock('../domains/controlPlane/UniversalPerceptionService.js', () => ({
  universalPerceptionService: {
    analyzeImageWithVisionLLM: vi.fn(async (_b64: string, prompt: string) => {
      visionCalls.push(prompt);
      return visionAnswer;
    }),
  },
}));

vi.mock('../services/llmGateway.js', () => ({ llmChat: vi.fn(async () => ({ reply: 'llm' })) }));

import { detectForegroundScreenIntent } from '../domains/jarvis/execution/foregroundScreenIntent.js';
import {
  readForegroundScreen,
  evaluateForegroundContent,
} from '../services/perception/foregroundScreenReader.js';
import { routeTurn } from '../domains/jarvisNext/turnRouter.js';

/** Document text a real TextPattern would return. */
const DOC_TEXT = 'Foreground perception test 93827. The blue elephant is on Tuesday.';
/** Accessibility labels a chrome-only window produces (the physical failure). */
const CHROME_LABELS =
  'Datei\nBearbeiten\nAnsicht\nHilfe\nZurueck\nVorwaerts\nSeitenleiste schliessen\nMinimieren\nMaximieren';

/** Build a fake PowerShell `read_foreground` payload (defaults to a GOOD read). */
function payload(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    success: true,
    action: 'read_foreground',
    hwnd: 4242,
    windowTitle: 'hello_world.txt - Notepad',
    windowClass: 'Notepad',
    process: 'notepad',
    pid: 111,
    method: 'uia',
    text: DOC_TEXT,
    contentText: DOC_TEXT,
    chromeText: CHROME_LABELS,
    contentChars: DOC_TEXT.length,
    chromeChars: CHROME_LABELS.length,
    contentElementCount: 2,
    chromeElementCount: 11,
    controlCount: 2,
    textPatternHits: 1,
    valuePatternHits: 0,
    geometryFilteredCount: 0,
    chromeFilteredCount: 0,
    totalDescendants: 934,
    controlTypesSeen: { Document: 1, Text: 1, Button: 6, MenuItem: 4 },
    contentElements: [{ type: 'Document', text: DOC_TEXT, pattern: 'textpattern' }],
    chromeElements: [],
    geometry: { windowRect: {}, clientRect: {}, nonClientTopPx: 0 },
    screenshot: null,
    confidence: 0.9,
    ...over,
  });
}

/** Answer the PS1 call with a fixed payload. */
function answerWith(body: string): void {
  execHandler = () => ({ stdout: body });
}

/** Answer the PS1 call and materialise the screenshot artifact it points at. */
function answerWithScreenshot(body: string): void {
  execHandler = (cmd: string) => {
    const m = /-OutScreenshotPath "([^"]+)"/.exec(cmd);
    if (m) {
      fs.mkdirSync(path.dirname(m[1]), { recursive: true });
      fs.writeFileSync(m[1], Buffer.alloc(4096, 7));
    }
    return { stdout: body };
  };
}

beforeEach(() => {
  spawnCalls.length = 0;
  visionCalls.length = 0;
  visionAnswer = null;
  permissionAllowed = true;
  execHandler = () => ({ stdout: '' });
  vi.clearAllMocks();
});

/* ═══════════════════ Generic intent (routing abstraction) ═══════════════════ */

describe('foreground-screen intent is compositional, not a phrase list', () => {
  const positives = [
    'Read what is currently on my screen.',
    'Tell me what is visible on this screen.',
    'What does the current window say?',
    'Read this page.',
    'What is on my screen right now?',
    'Describe what is on my monitor.',
  ];

  it.each(positives)('routes %j to read_foreground_screen', (phrase) => {
    const r = detectForegroundScreenIntent(phrase);
    expect(r.isReadForegroundScreen).toBe(true);
    expect(r.confidence).toBeGreaterThan(0.7);
  });

  const negatives: Array<[string, string]> = [
    ['Look at me and tell me what you see', 'camera'],
    ['What am I holding in my hand', 'camera'],
    ['Take a screenshot of the window', 'screenshot capture'],
    ['Open Chrome and read the page', 'launch named target'],
    ['Google what is on my screen', 'web search'],
    ['What is the AgenticOS runtime status', 'runtime diagnostics'],
    ['What is the status of my project', 'no surface reference'],
  ];

  it.each(negatives)('does not claim %j (%s)', (phrase) => {
    expect(detectForegroundScreenIntent(phrase).isReadForegroundScreen).toBe(false);
  });
});

/* ═══════════════ RC1: bare read verbs (live voice regression) ═══════════════ */

describe('RC1 — bare read verbs imply the foreground screen', () => {
  const bareReads = [
    'Yeah, whatever, Jarvis, read.',
    'Jarvis, read.',
    'read',
    'Just read please.',
    'Can you read?',
    'Read for me.',
    'Tell me.',
  ];

  it.each(bareReads)('accepts %j as a foreground screen read', (phrase) => {
    const r = detectForegroundScreenIntent(phrase);
    expect(r.isReadForegroundScreen).toBe(true);
    expect(r.confidence).toBeGreaterThanOrEqual(0.6);
    expect(r.reason).toContain('bare read verb');
  });
});

describe('RC1.2 — deictic + read verb implies the foreground screen', () => {
  const deicticReads = [
    'Read this.',
    'Read that.',
    'Look at it.',
    'Inspect this now.',
    'Describe that for me.',
  ];

  it.each(deicticReads)('accepts %j as a foreground screen read', (phrase) => {
    const r = detectForegroundScreenIntent(phrase);
    expect(r.isReadForegroundScreen).toBe(true);
    expect(r.confidence).toBeGreaterThanOrEqual(0.65);
  });
});

/* ═══════════ RC3: 'me' is not a camera noun in read contexts ════════════════ */

describe('RC3 — "me" does not false-positive as camera vocabulary', () => {
  it('"Read for me" routes to screen read, not camera', () => {
    const r = detectForegroundScreenIntent('Read for me.');
    expect(r.isReadForegroundScreen).toBe(true);
    expect(r.reason).not.toMatch(/camera/);
  });

  it('"Tell me" routes to screen read, not camera', () => {
    const r = detectForegroundScreenIntent('Tell me.');
    expect(r.isReadForegroundScreen).toBe(true);
    expect(r.reason).not.toMatch(/camera/);
  });

  it('"Describe that for me" routes to screen read, not camera', () => {
    const r = detectForegroundScreenIntent('Describe that for me.');
    expect(r.isReadForegroundScreen).toBe(true);
    expect(r.reason).not.toMatch(/camera/);
  });

  it('"Can you see me?" still routes to camera (true camera intent)', () => {
    const r = detectForegroundScreenIntent('Can you see me?');
    expect(r.isReadForegroundScreen).toBe(false);
    expect(r.reason).toMatch(/camera/);
  });
});

/* ═══════════════ C3: semantic content scoring (unit, no I/O) ════════════════ */

describe('C3 — evaluateForegroundContent replaces the length>=20 gate', () => {
  it('chrome-only accessibility labels are NOT good content', () => {
    const a = evaluateForegroundContent({
      contentText: '',
      chromeText: CHROME_LABELS,
      contentElementCount: 0,
      chromeElementCount: 11,
      textPatternHits: 0,
    });
    expect(a.quality).not.toBe('good');
    expect(a.quality).toBe('empty');
  });

  it('a long list of accessibility labels is still not content', () => {
    const labelSoup = CHROME_LABELS.replace(/\n/g, '\n');
    const a = evaluateForegroundContent({
      contentText: labelSoup,
      chromeText: CHROME_LABELS,
      contentElementCount: 9,
      chromeElementCount: 9,
      textPatternHits: 0,
    });
    expect(a.quality).not.toBe('good');
    expect(a.evidence.menuLabelRatio).toBeGreaterThan(0.7);
  });

  it('TextPattern document text scores good', () => {
    const a = evaluateForegroundContent({
      contentText: DOC_TEXT,
      chromeText: CHROME_LABELS,
      contentElementCount: 1,
      chromeElementCount: 8,
      textPatternHits: 1,
    });
    expect(a.quality).toBe('good');
    expect(a.score).toBeGreaterThan(0.2);
  });

  it('substantial varied prose scores good even without a pattern hit', () => {
    const prose =
      'Foreground perception test nine three eight two seven. The blue elephant is on Tuesday. ' +
      'Revenue for the quarter reached one point two million euros across all regions.';
    const a = evaluateForegroundContent({
      contentText: prose,
      chromeText: CHROME_LABELS,
      contentElementCount: 12,
      chromeElementCount: 3,
      textPatternHits: 0,
    });
    expect(a.quality).toBe('good');
  });

  it('ValuePattern-only ribbon values are NOT treated as document text', () => {
    // Live finding: an EMPTY Word document exposes ValuePattern values from the
    // style gallery and the font-size combo box. Treating a pattern hit as
    // document text made that label soup score as good content.
    const a = evaluateForegroundContent({
      contentText:
        'Suchen\nAptos (Textkörper)\n12\n¶ Standard\nÜberschrift 1\nWortanzahl 0 Wörter\nDokument1',
      chromeText: 'Ribbon\nSpeichern\nRückgängig',
      contentElementCount: 22,
      chromeElementCount: 95,
      textPatternHits: 0,
      valuePatternHits: 3,
      textPatternChars: 0,
      valuePatternChars: 12,
    });
    expect(a.quality).toBe('chrome_only');
    expect(a.evidence.menuLabelRatio).toBeGreaterThan(0.7);
  });

  it('reports the evidence the decision was based on', () => {
    const a = evaluateForegroundContent({
      contentText: DOC_TEXT,
      chromeText: CHROME_LABELS,
      contentElementCount: 1,
      chromeElementCount: 8,
      textPatternHits: 1,
    });
    expect(a.evidence).toMatchObject({
      contentChars: DOC_TEXT.length,
      contentElementCount: 1,
      chromeElementCount: 8,
      textPatternHits: 1,
    });
    expect(a.evidence.uniqueContentTokens).toBeGreaterThan(5);
    expect(a.evidence.reasons.length).toBeGreaterThan(0);
  });
});

/* ═══════════ Required fixtures (physical root-cause regression set) ═════════ */

describe('fixtures — chrome-only UIA', () => {
  it('F1: chrome-only window is rejected and vision is triggered', async () => {
    visionAnswer = 'The window shows a conversation about quarterly revenue.';
    answerWithScreenshot(
      payload({
        contentText: '',
        contentChars: 0,
        contentElementCount: 0,
        textPatternHits: 0,
        chromeElementCount: 11,
      })
    );
    const r = await readForegroundScreen();

    expect(r.quality).not.toBe('good');
    expect(r.method).toBe('vision');
    expect(visionCalls.length).toBe(1);
    expect(r.success).toBe(true);
    // Chrome labels must never reach the spoken answer.
    for (const label of ['Datei', 'Bearbeiten', 'Ansicht', 'Hilfe', 'Zurueck', 'Vorwaerts']) {
      expect(r.spokenText).not.toContain(label);
    }
  });
});

describe('fixtures — real document content', () => {
  it('F2: TextPattern document text is accepted and vision is NOT invoked', async () => {
    visionAnswer = 'should not be used';
    answerWithScreenshot(payload());
    const r = await readForegroundScreen();

    expect(r.quality).toBe('good');
    expect(r.method).toBe('uia');
    expect(r.content).toContain('blue elephant is on Tuesday');
    expect(r.spokenText).toContain('blue elephant is on Tuesday');
    expect(visionCalls.length).toBe(0);
  });

  it('F2b: the required Notepad known-text case returns document text, not tab/menu labels', async () => {
    answerWithScreenshot(
      payload({
        windowTitle: '*hello_world.txt - Notepad',
        contentText: 'Hello World physical test 4471',
        contentChars: 30,
      })
    );
    const r = await readForegroundScreen();

    expect(r.content).toContain('Hello World physical test 4471');
    expect(r.spokenText).not.toMatch(/Datei|Bearbeiten|Ansicht|Text-Editor/i);
  });
});

describe('fixtures — mixed chrome + content', () => {
  it('F3: document content is prioritised and chrome is excluded', async () => {
    answerWithScreenshot(payload({ chromeElementCount: 40, chromeChars: 900 }));
    const r = await readForegroundScreen();

    expect(r.method).toBe('uia');
    expect(r.content).toContain('blue elephant');
    for (const label of CHROME_LABELS.split('\n')) {
      expect(r.content).not.toContain(label);
      expect(r.spokenText).not.toContain(label);
    }
  });
});

describe('fixtures — TextPattern unavailable', () => {
  it('F4: no pattern support degrades gracefully to the vision fallback', async () => {
    visionAnswer = 'The editor shows a short note about the Tuesday review.';
    answerWithScreenshot(
      payload({
        contentText: '',
        contentChars: 0,
        contentElementCount: 0,
        textPatternHits: 0,
        valuePatternHits: 0,
        method: 'uia',
      })
    );
    const r = await readForegroundScreen();

    expect(r.quality).toBe('empty');
    expect(r.method).toBe('vision');
    expect(r.spokenText).toContain('Tuesday review');
  });
});

describe('fixtures — Chromium/Electron geometry (ClientRect == WindowRect)', () => {
  it('F5: chrome is rejected semantically even though geometry filters nothing', async () => {
    visionAnswer = 'A chat window with three messages about the launch plan.';
    answerWithScreenshot(
      payload({
        process: 'ChatGPT',
        windowTitle: 'ChatGPT',
        windowClass: 'Chrome_WidgetWin_1',
        // Label soup leaked into the content bucket because there is no pattern.
        contentText: 'Datei\nBearbeiten\nAnsicht\nHilfe\nZurueck\nVorwaerts',
        contentElementCount: 6,
        chromeElementCount: 6,
        textPatternHits: 0,
        valuePatternHits: 0,
        geometryFilteredCount: 0,
        geometry: { windowRect: {}, clientRect: {}, nonClientTopPx: 0 },
      })
    );
    const r = await readForegroundScreen();

    expect(r.quality).toBe('chrome_only');
    expect(r.qualityScore).toBeLessThan(0.5);
    expect(r.method).toBe('vision');
    expect(r.spokenText).toContain('launch plan');
    expect(r.spokenText).not.toMatch(/Datei|Bearbeiten|Ansicht|Hilfe/);
  });
});

describe('fixtures — traversal budget', () => {
  it('F6: a single Document element is still found among hundreds of navigation controls', async () => {
    answerWithScreenshot(
      payload({
        contentText: DOC_TEXT,
        contentElementCount: 1,
        chromeElementCount: 380, // exceeds the chrome cap; content cap untouched
        textPatternHits: 1,
      })
    );
    const r = await readForegroundScreen();

    expect(r.quality).toBe('good');
    expect(r.content).toContain('93827');
    expect(visionCalls.length).toBe(0);
  });
});

describe('fixtures — vision fallback failure', () => {
  it('F7: one terminal response, no chrome answer and no runtime-status fallback', async () => {
    visionAnswer = null; // vision unavailable
    answerWithScreenshot(
      payload({
        contentText: 'Datei\nBearbeiten\nAnsicht\nHilfe',
        contentElementCount: 4,
        chromeElementCount: 4,
        textPatternHits: 0,
      })
    );
    const r = await readForegroundScreen();

    expect(r.success).toBe(false);
    expect(r.reason).toBe('unreliable_content');
    expect(r.visionAttempted).toBe(true);
    expect(r.spokenText).toBe(
      'I can identify the foreground window, but I cannot reliably read its contents.'
    );
    expect(r.emittedRuntimeDiagnostics).toBe(false);
    expect(r.spokenText).not.toMatch(/diagnostic|runtime status|heartbeat|incident|Datei|Bearbeiten/i);
  });
});

describe('fixtures — ValuePattern-only ribbon controls (live Word document)', () => {
  it('F8: an empty Word document is NOT accepted as good content', async () => {
    visionAnswer = 'The Word document is empty; the page is blank apart from the ribbon.';
    answerWithScreenshot(
      payload({
        process: 'WINWORD',
        windowTitle: 'Dokument1 - Word',
        // A style gallery + status bar, NOT document text.
        contentText:
          'Suchen\nAptos (Textkörper)\n12\n¶ Standard\nÜberschrift 1\n¶ Kein Leerraum\nWortanzahl 0 Wörter\nDokument1\n1-Seiteninhalt',
        contentChars: 335,
        contentElementCount: 22,
        chromeElementCount: 95,
        chromeChars: 1788,
        textPatternHits: 0,
        valuePatternHits: 3,
        textPatternChars: 0,
        valuePatternChars: 12,
      })
    );
    const r = await readForegroundScreen();

    expect(r.quality).toBe('chrome_only');
    expect(r.method).toBe('vision');
    expect(r.visionAttempted).toBe(true);
    expect(r.spokenText).toContain('page is blank');
    for (const label of ['Überschrift', 'Aptos', 'Wortanzahl', 'Suchen', 'Standard']) {
      expect(r.spokenText).not.toContain(label);
    }
  });
});

/* ═══════════════════════ readForegroundScreen invariants ═══════════════════ */

describe('read_foreground_screen capability', () => {
  it('1. identifies the foreground window and returns real content', async () => {
    answerWith(payload());
    const r = await readForegroundScreen();

    expect(r.success).toBe(true);
    expect(r.hwnd).toBe(4242);
    expect(r.process).toBe('notepad');
    expect(r.windowTitle).toBe('hello_world.txt - Notepad');
    expect(r.method).toBe('uia');
    expect(r.content).toContain('blue elephant');
    expect(r.spokenText).toContain('notepad window');
  });

  it('2. returns application content, never window chrome', async () => {
    answerWith(payload());
    const r = await readForegroundScreen();

    expect(r.content).toContain('Foreground perception test');
    for (const chrome of ['minimize', 'maximize', 'close', 'restore', 'Datei', 'Hilfe']) {
      expect(r.spokenText.toLowerCase()).not.toContain(chrome.toLowerCase());
    }
  });

  it('3. reads a browser foreground window (render-widget content root)', async () => {
    answerWith(
      payload({
        process: 'comet',
        windowTitle: 'Perplexity',
        windowClass: 'Chrome_WidgetWin_1',
        contentText: 'Perplexity explains what quantum entanglement means in practice.',
      })
    );
    const r = await readForegroundScreen();

    expect(r.success).toBe(true);
    expect(r.process).toBe('comet');
    expect(r.spokenText).toContain('comet window');
    expect(r.spokenText).toContain('quantum entanglement');
  });

  it('4. reads a generic desktop application window', async () => {
    answerWith(
      payload({
        process: 'WINWORD',
        windowTitle: 'Contract.docx - Word',
        contentText: 'Clause 4. Delivery terms are net 30 days from the invoice date.',
        textPatternHits: 1,
      })
    );
    const r = await readForegroundScreen();

    expect(r.success).toBe(true);
    expect(r.process).toBe('WINWORD');
    expect(r.spokenText).toContain('net 30 days');
  });

  it('5. weak UIA -> screenshot + vision fallback', async () => {
    visionAnswer = 'The visible page shows a product list with three items.';
    answerWithScreenshot(payload({ contentText: '', contentChars: 0, textPatternHits: 0 }));
    const r = await readForegroundScreen();

    expect(r.method).toBe('vision');
    expect(r.success).toBe(true);
    expect(r.visionAttempted).toBe(true);
    expect(visionCalls.length).toBe(1);
    expect(r.spokenText).toContain('product list with three items');
    expect(visionCalls[0]).toMatch(/minimise|minimize/i);
    expect(r.screenshotSha256).toBeTruthy();
  });

  it('6. unusable UIA + failed vision -> explicit terminal response', async () => {
    visionAnswer = null;
    answerWithScreenshot(payload({ contentText: '', contentChars: 0, textPatternHits: 0 }));
    const r = await readForegroundScreen();

    expect(r.success).toBe(false);
    expect(r.reason).toBe('unreliable_content');
    expect(r.spokenText).toContain('cannot reliably read its contents');
    expect(r.content).toBe('');
  });

  it('7. never answers with AgenticOS runtime status/diagnostics', async () => {
    for (const body of [
      payload(),
      payload({ contentText: '' }),
      payload({ contentText: 'Datei\nHilfe', textPatternHits: 0 }),
      JSON.stringify({ success: false, reason: 'no_foreground_window' }),
      JSON.stringify({ success: false, reason: 'foreground_is_agenticos' }),
      JSON.stringify({ success: false, reason: 'foreground_minimised' }),
    ]) {
      answerWith(body);
      const r = await readForegroundScreen();
      expect(r.emittedRuntimeDiagnostics).toBe(false);
      expect(r.spokenText).not.toMatch(/diagnostic|runtime status|heartbeat|self-?heal|incident/i);
    }
  });

  it('8. never launches an application or opens a new window', async () => {
    answerWith(payload());
    const r = await readForegroundScreen();

    expect(spawnCalls.length).toBeGreaterThan(0);
    for (const cmd of spawnCalls) {
      expect(cmd).toContain('desktop_perception.ps1');
      expect(cmd).toContain('-Action "read_foreground"');
      expect(cmd).not.toMatch(/\bstart\b|Start-Process|calc\.exe|explorer\.exe|\bexplorer\b/i);
      // Production never pins an HWND; only diagnostics may use -Hwnd.
      expect(cmd).not.toMatch(/-Hwnd\s+\d+/);
    }
    expect(r.launchedApplication).toBe(false);
  });

  it('9. never performs a project/task lookup', async () => {
    answerWith(payload());
    const r = await readForegroundScreen();

    expect(r.performedTaskLookup).toBe(false);
    for (const cmd of spawnCalls) {
      expect(cmd).not.toMatch(/task|goal|project/i);
    }
  });

  it('10. repeated calls keep working in the same conversation', async () => {
    for (let i = 0; i < 5; i++) {
      answerWith(
        payload({
          contentText: `Screen content sample number ${i}. The paragraph has enough words to score.`,
          textPatternHits: 1,
        })
      );
      const r = await readForegroundScreen();
      expect(r.success).toBe(true);
      expect(r.content).toContain(`sample number ${i}`);
    }
  });

  it('title-bar controls alone are not meaningful screen content', async () => {
    visionAnswer = null;
    answerWith(
      payload({ contentText: '', contentChars: 0, textPatternHits: 0, chromeText: 'Minimieren\nMaximieren\nSchliessen' })
    );
    const r = await readForegroundScreen();

    expect(r.success).toBe(false);
    expect(r.method).toBe('none');
    expect(r.spokenText).not.toMatch(/minimi|maximi|close|restore|title bar/i);
  });

  it('foreground is AgenticOS itself -> explicit, honest terminal outcome', async () => {
    answerWith(
      JSON.stringify({
        success: false,
        reason: 'foreground_is_agenticos',
        windowTitle: 'AgenticOS',
        process: 'AgenticOS',
      })
    );
    const r = await readForegroundScreen();

    expect(r.success).toBe(false);
    expect(r.reason).toBe('foreground_is_agenticos');
    expect(r.spokenText).toMatch(/AgenticOS itself/i);
  });
});

/* ═══════════════════════ Routing through the real turnRouter ════════════════ */

describe('routing: real turnRouter sends screen reads to read_foreground_screen', () => {
  it.each([
    'Read what is currently on my screen.',
    'Tell me what is visible on this screen.',
    'What does the current window say?',
    'Read this page.',
  ])('%j -> route read_foreground_screen', async (phrase) => {
    answerWith(payload());
    const res = await routeTurn({
      prompt: phrase,
      conversationId: 'fg-test',
      turnId: 1,
      rawStt: phrase,
    });

    expect(res.route).toBe('read_foreground_screen');
    expect(res.handled).toBe(true);
    expect(res.text.length).toBeGreaterThan(0);
    expect(res.text).not.toMatch(/diagnostic|runtime status|heartbeat|incident/i);
    expect(res.text).not.toMatch(/\btask\b|\bblocker\b/i);
    for (const cmd of spawnCalls) {
      expect(cmd).toContain('read_foreground');
      expect(cmd).not.toMatch(/Start-Process|\bstart\b/i);
    }
  });

  // RC1 regression: bare read verbs must route through turnRouter too
  it.each([
    'Jarvis, read.',
    'Yeah, whatever, Jarvis, read.',
    'Read for me.',
    'Tell me.',
    'Read this.',
  ])('RC1 regression: %j -> route read_foreground_screen', async (phrase) => {
    answerWith(payload());
    const res = await routeTurn({
      prompt: phrase,
      conversationId: 'fg-test',
      turnId: 3,
      rawStt: phrase,
    });

    expect(res.route).toBe('read_foreground_screen');
    expect(res.handled).toBe(true);
    expect(res.text).not.toMatch(/diagnostic|runtime status|heartbeat|incident/i);
  });

  it('does not hijack launch or camera requests', async () => {
    answerWith(payload());
    for (const phrase of ['open notepad', 'look at me and tell me what you see']) {
      const res = await routeTurn({
        prompt: phrase,
        conversationId: 'fg-test',
        turnId: 2,
        rawStt: phrase,
      });
      expect(res.route).not.toBe('read_foreground_screen');
    }
  });
});
