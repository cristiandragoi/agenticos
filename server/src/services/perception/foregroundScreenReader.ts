/**
 * foregroundScreenReader.ts — `read_foreground_screen` capability.
 *
 * Reads what is ACTUALLY VISIBLE in the already-active foreground window and
 * returns a grounded answer built only from extracted evidence.
 *
 * Hard invariants (these are the behavioural contract, not preferences):
 *   1. It reads the FOREGROUND window. It never searches for a window by title
 *      or process name, and never inspects unrelated windows.
 *   2. It never opens, launches, focuses or navigates anything.
 *   3. It never performs a project/task lookup.
 *   4. It never answers with AgenticOS runtime diagnostics or status.
 *   5. It never fabricates content. No evidence → an explicit terminal failure.
 *
 * CONTENT PROVENANCE (physical root-cause corrections C1/C3)
 * ---------------------------------------------------------
 * `AutomationElement.Name` is the ACCESSIBILITY label of a control, not visible
 * document content: for a Button it returns "File"/"Datei", for a menu item
 * "Edit"/"Bearbeiten". Concatenating `.Name` over the whole UIA tree therefore
 * yields menu/button/tab labels, and a `length >= 20` gate happily accepted that
 * as "content" — which meant the vision fallback never ran. See
 * `foreground_physical_rootcause.md`.
 *
 * The PowerShell layer now separates CONTENT elements (Document/Edit/Text, whose
 * real text comes from TextPattern/ValuePattern where available) from CHROME
 * elements (Button/MenuItem/TabItem/Hyperlink/ToolBar/Group/Pane), and this layer
 * decides acceptance with `evaluateForegroundContent()` — a generic semantic
 * assessment, not a character count and not an application-specific blacklist.
 *
 * Evidence hierarchy: UIA content (quality `good`) → screenshot + vision model →
 * explicit terminal failure.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { exec } from 'node:child_process';
import { logger } from '../../utils/logger.js';
import { resolveScriptPath } from '../../utils/scriptResolver.js';
import { capabilityPermissionStore } from '../../domains/controlPlane/CapabilityPermissionStore.js';

/**
 * Explicit promise wrapper around `exec`.
 *
 * `promisify(exec)` resolves `{ stdout, stderr }` only via Node's
 * `util.promisify.custom` symbol, which does not exist when `node:child_process`
 * is mocked. Wrapping explicitly keeps the contract identical in production and
 * under test.
 */
function runPowerShell(
  cmd: string,
  timeoutMs: number
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    exec(cmd, { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(err);
      else resolve({ stdout: String(stdout ?? ''), stderr: String(stderr ?? '') });
    });
  });
}

export type ForegroundContentQuality = 'good' | 'weak' | 'chrome_only' | 'empty';

export interface ForegroundContentAssessment {
  quality: ForegroundContentQuality;
  /** 0..1 — higher means more likely to be real document/page content. */
  score: number;
  contentText: string;
  chromeText: string;
  evidence: {
    contentChars: number;
    chromeChars: number;
    contentElementCount: number;
    chromeElementCount: number;
    contentRatio: number;
    uniqueContentTokens: number;
    /** Fraction of content lines that are 3 words or fewer (label-like). */
    menuLabelRatio: number;
    /** Fraction of content lines that read like sentences. */
    sentenceLikeRatio: number;
    repetition: number;
    textPatternHits: number;
    valuePatternHits: number;
    /** Characters that came from TextPattern.DocumentRange (strong provenance). */
    textPatternChars: number;
    /** Characters that came from ValuePattern (weak provenance). */
    valuePatternChars: number;
    reasons: string[];
  };
}

export interface ForegroundScreenReading {
  /** True when a real, evidence-backed answer was produced. */
  success: boolean;
  windowTitle: string;
  process: string;
  hwnd: number;
  method: 'uia' | 'vision' | 'none';
  /** Raw content extracted from the window's client area. */
  content: string;
  /** Grounded answer text; safe to speak verbatim. */
  spokenText: string;
  controlCount: number;
  chromeFilteredCount: number;
  /** Semantic assessment that decided acceptance (C3). */
  quality: ForegroundContentQuality;
  qualityScore: number;
  /** True when the vision fallback was attempted. */
  visionAttempted: boolean;
  screenshotArtifactPath?: string;
  screenshotSha256?: string;
  /** Machine-readable outcome when success is false. */
  reason?: string;
  error?: string;
  /** Invariant markers, asserted by tests. */
  launchedApplication: false;
  performedTaskLookup: false;
  emittedRuntimeDiagnostics: false;
}

/** Shape of `desktop_perception.ps1 -Action read_foreground` output. */
interface ReadForegroundPayload {
  success?: boolean;
  reason?: string;
  error?: string;
  windowTitle?: string;
  process?: string;
  hwnd?: number;
  method?: string;
  /** Legacy alias for contentText, kept so older payloads still parse. */
  text?: string;
  contentText?: string;
  chromeText?: string;
  contentElementCount?: number;
  chromeElementCount?: number;
  controlCount?: number;
  chromeFilteredCount?: number;
  geometryFilteredCount?: number;
  textPatternHits?: number;
  valuePatternHits?: number;
  textPatternChars?: number;
  valuePatternChars?: number;
  totalDescendants?: number;
}

const MAX_PREVIEW_LINES = 8;

const TERMINAL_UNREADABLE =
  'I can see the foreground window, but I cannot read its contents.';
/** Required terminal outcome when UIA is unusable AND vision is unavailable. */
const TERMINAL_UNRELIABLE =
  'I can identify the foreground window, but I cannot reliably read its contents.';
const TERMINAL_AGENTICOS =
  'The window in the foreground is AgenticOS itself. Switch to the application you want me to read, then ask again.';

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function artifactDir(): string {
  const dir = path.resolve(process.cwd(), 'data', 'artifacts', 'screenshots');
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch {
    // Best effort: screenshot artifacts are optional, extraction still works.
  }
  return dir;
}

function terminal(
  reason: string,
  spokenText: string,
  extra: Partial<ForegroundScreenReading> = {}
): ForegroundScreenReading {
  return {
    success: false,
    windowTitle: String(extra.windowTitle ?? ''),
    process: String(extra.process ?? ''),
    hwnd: Number(extra.hwnd ?? 0),
    method: 'none',
    content: '',
    spokenText,
    controlCount: 0,
    chromeFilteredCount: 0,
    quality: 'empty',
    qualityScore: 0,
    visionAttempted: false,
    reason,
    error: extra.error,
    launchedApplication: false,
    performedTaskLookup: false,
    emittedRuntimeDiagnostics: false,
  };
}

function preview(content: string): string {
  return content
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 1)
    .slice(0, MAX_PREVIEW_LINES)
    .join('; ');
}

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

/**
 * Decide whether extracted text is real document/page content.
 *
 * Generic by construction: it uses provenance (which UIA control types produced
 * the text, and whether a Text/Value pattern supplied it), structure (line
 * length, sentence shape, repetition) and breadth (unique tokens, content-to-
 * chrome ratio). It contains no per-application and no per-language word lists.
 */
export function evaluateForegroundContent(input: {
  contentText?: string;
  chromeText?: string;
  contentElementCount?: number;
  chromeElementCount?: number;
  textPatternHits?: number;
  valuePatternHits?: number;
  /** Characters that came from TextPattern.DocumentRange (strong provenance). */
  textPatternChars?: number;
  /**
   * Characters that came from ValuePattern. Weak provenance on purpose: ribbon
   * ComboBox/Edit controls (font size, style gallery) expose values too, which
   * is precisely how an EMPTY Word document produced label-soup "content".
   */
  valuePatternChars?: number;
}): ForegroundContentAssessment {
  const contentText = String(input.contentText ?? '').trim();
  const chromeText = String(input.chromeText ?? '').trim();
  const contentElementCount = Number(input.contentElementCount || 0);
  const chromeElementCount = Number(input.chromeElementCount || 0);
  const textPatternHits = Number(input.textPatternHits || 0);
  const valuePatternHits = Number(input.valuePatternHits || 0);

  const contentChars = contentText.length;

  // Fall back to inferring provenance for payloads without explicit char counts.
  const textPatternChars = Number(
    input.textPatternChars ??
      (textPatternHits > 0 && valuePatternHits === 0 ? contentChars : 0)
  );
  const valuePatternChars = Number(
    input.valuePatternChars ?? (valuePatternHits > 0 && textPatternHits === 0 ? contentChars : 0)
  );
  const documentChars = textPatternChars + valuePatternChars;
  const chromeChars = chromeText.length;
  const lines = contentText.split('\n').map((l) => l.trim()).filter(Boolean);
  const words = contentText.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];
  const uniqueTokens = new Set(words).size;

  const totalElements = contentElementCount + chromeElementCount;
  const contentRatio =
    totalElements > 0
      ? contentElementCount / totalElements
      : contentChars > 0
        ? 1
        : 0;

  const shortLines = lines.filter((l) => l.split(/\s+/).length <= 3).length;
  const menuLabelRatio = lines.length ? shortLines / lines.length : 0;
  const sentenceLines = lines.filter(
    (l) => l.split(/\s+/).length >= 6 || /[.!?]$/.test(l)
  ).length;
  const sentenceLikeRatio = lines.length ? sentenceLines / lines.length : 0;
  const repetition = words.length ? 1 - uniqueTokens / words.length : 0;

  const reasons: string[] = [];
  let score = 0;
  score += Math.min(1, contentChars / 400) * 0.3;
  score += Math.min(1, uniqueTokens / 40) * 0.2;
  score += contentRatio * 0.2;
  score += sentenceLikeRatio * 0.15;
  // Provenance-weighted: a TextPattern document read is real evidence; a lone
  // ValuePattern hit is not (ribbon combo boxes expose values as well).
  score += textPatternChars > 0 ? 0.15 : Math.min(1, textPatternHits / 3) * 0.15;
  score -= menuLabelRatio * 0.25;
  score -= repetition * 0.15;
  score = clamp01(score);

  let quality: ForegroundContentQuality;
  if (contentChars === 0) {
    quality = 'empty';
    reasons.push('no content-bearing text extracted');
  } else if (textPatternChars >= 8) {
    // TextPattern.DocumentRange text is document content by construction, so it
    // outranks every structural heuristic below. ValuePattern alone does NOT
    // qualify: ribbon ComboBox/Edit controls expose values too.
    quality = 'good';
    reasons.push(`document text via TextPattern (${textPatternChars} chars)`);
  } else if (
    contentChars >= 120 &&
    contentRatio >= 0.25 &&
    uniqueTokens >= 20 &&
    menuLabelRatio <= 0.5
  ) {
    quality = 'good';
    reasons.push('substantial, varied, sentence-like content');
  } else if (
    contentChars < 60 ||
    menuLabelRatio > 0.7 ||
    (contentRatio < 0.15 && documentChars === 0)
  ) {
    quality = 'chrome_only';
    if (contentChars < 60) reasons.push(`content too short (${contentChars} chars)`);
    if (menuLabelRatio > 0.7) reasons.push(`label-like lines dominate (${menuLabelRatio.toFixed(2)})`);
    if (contentRatio < 0.15 && documentChars === 0) {
      reasons.push(`content elements are a small minority (ratio ${contentRatio.toFixed(2)})`);
    }
  } else {
    quality = 'weak';
    reasons.push('some content present but not enough to rely on');
  }

  return {
    quality,
    score,
    contentText,
    chromeText,
    evidence: {
      contentChars,
      chromeChars,
      contentElementCount,
      chromeElementCount,
      contentRatio,
      uniqueContentTokens: uniqueTokens,
      menuLabelRatio,
      sentenceLikeRatio,
      repetition,
      textPatternHits,
      valuePatternHits,
      textPatternChars,
      valuePatternChars,
      reasons,
    },
  };
}

/** Assemble a successful reading from the PowerShell payload. */
function reading(
  base: Pick<ForegroundScreenReading, 'windowTitle' | 'process' | 'hwnd' | 'content'>,
  over: Partial<ForegroundScreenReading> & Pick<ForegroundScreenReading, 'method' | 'spokenText'>
): ForegroundScreenReading {
  return {
    success: true,
    controlCount: 0,
    chromeFilteredCount: 0,
    quality: 'good',
    qualityScore: 0,
    visionAttempted: false,
    launchedApplication: false,
    performedTaskLookup: false,
    emittedRuntimeDiagnostics: false,
    ...base,
    ...over,
  };
}

/**
 * Read the foreground window. Read-only, side-effect free.
 */
export async function readForegroundScreen(): Promise<ForegroundScreenReading> {
  if (!capabilityPermissionStore.isAllowed('desktop.observe')) {
    return terminal(
      'permission_denied',
      'Desktop observation is disabled in settings, so I cannot read the screen.'
    );
  }

  const scriptPath = resolveScriptPath('desktop_perception.ps1');
  const artifactPath = path.join(
    artifactDir(),
    `foreground-read-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.png`
  );
  const cmd = `powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}" -Action "read_foreground" -OutScreenshotPath "${artifactPath}"`;

  let parsed: ReadForegroundPayload;
  try {
    const { stdout } = await runPowerShell(cmd, 25000);
    const firstBrace = stdout.indexOf('{');
    const lastBrace = stdout.lastIndexOf('}');
    if (firstBrace === -1 || lastBrace <= firstBrace) {
      return terminal('unparseable_output', TERMINAL_UNREADABLE, {
        error: 'desktop_perception.ps1 returned no JSON for action read_foreground',
      });
    }
    parsed = JSON.parse(stdout.substring(firstBrace, lastBrace + 1)) as ReadForegroundPayload;
  } catch (err) {
    logger.warn(`[ForegroundScreenReader] read failed: ${errorMessage(err)}`);
    return terminal('execution_error', TERMINAL_UNREADABLE, { error: errorMessage(err) });
  }

  // ── Window identified, but not readable by design or by window state ─────
  if (parsed.success !== true) {
    const reason = String(parsed.reason || 'unknown');
    const windowTitle = String(parsed.windowTitle || '');
    const process = String(parsed.process || '');

    if (reason === 'foreground_is_agenticos') {
      return terminal(reason, TERMINAL_AGENTICOS, { windowTitle, process });
    }
    if (reason === 'foreground_minimised') {
      return terminal(
        reason,
        'The foreground window is minimised, so there is nothing visible to read.',
        { windowTitle, process }
      );
    }
    if (reason === 'no_foreground_window' || reason === 'foreground_not_visible') {
      return terminal(reason, 'I could not identify a visible foreground window to read.', {
        windowTitle,
        process,
      });
    }
    return terminal(reason, TERMINAL_UNREADABLE, { windowTitle, process, error: parsed.error });
  }

  const base = {
    windowTitle: String(parsed.windowTitle || ''),
    process: String(parsed.process || 'unknown'),
    hwnd: Number(parsed.hwnd || 0),
    content: String(parsed.contentText ?? parsed.text ?? '').trim(),
  };
  const identity = `${base.process} window${base.windowTitle ? ` — "${base.windowTitle}"` : ''}`;
  const counts = {
    controlCount: Number(parsed.contentElementCount ?? parsed.controlCount ?? 0),
    chromeFilteredCount: Number(
      parsed.geometryFilteredCount ?? parsed.chromeFilteredCount ?? 0
    ),
  };

  // ── C1/C3: semantic assessment, NOT a character count ──────────────────
  const assessment = evaluateForegroundContent({
    contentText: base.content,
    chromeText: parsed.chromeText,
    contentElementCount: counts.controlCount,
    chromeElementCount: Number(parsed.chromeElementCount ?? 0),
    textPatternHits: parsed.textPatternHits,
    valuePatternHits: parsed.valuePatternHits,
    textPatternChars: parsed.textPatternChars,
    valuePatternChars: parsed.valuePatternChars,
  });
  const audit = {
    quality: assessment.quality,
    qualityScore: assessment.score,
    ...counts,
  };

  // ── Screenshot artifact, used only by the vision fallback ───────────────
  let screenshotArtifactPath: string | undefined;
  let screenshotSha256: string | undefined;
  let base64Image: string | undefined;
  if (fs.existsSync(artifactPath) && fs.statSync(artifactPath).size > 1024) {
    const buf = fs.readFileSync(artifactPath);
    screenshotArtifactPath = artifactPath;
    screenshotSha256 = crypto.createHash('sha256').update(buf).digest('hex');
    base64Image = buf.toString('base64');
  }
  const shot = { screenshotArtifactPath, screenshotSha256 };

  // ── 1. Only `good` UIA content may be spoken directly ──────────────────
  if (assessment.quality === 'good') {
    return reading(base, {
      method: 'uia',
      spokenText: `I can see a ${identity}. The visible content contains: ${preview(assessment.contentText)}.`,
      ...audit,
      ...shot,
    });
  }

  // ── 2. weak / chrome_only / empty MUST attempt the vision fallback ──────
  // Chrome labels are never spoken as content, so a failed fallback is a
  // terminal failure rather than a menu-label answer.
  let visionAttempted = false;
  if (base64Image) {
    visionAttempted = true;
    try {
      const { universalPerceptionService } = await import(
        '../../domains/controlPlane/UniversalPerceptionService.js'
      );
      const visionAnswer = await universalPerceptionService.analyzeImageWithVisionLLM(
        base64Image,
        `The user asked to read what is on their screen. The foreground window is a ${identity}. ` +
          `Describe the readable content actually visible in it, in 1 to 2 spoken sentences. ` +
          `Do not describe window controls, title bars, minimise/maximise/close buttons, menus, ` +
          `sidebars, tabs, or capture details.`,
        'image/png'
      );
      if (visionAnswer?.trim()) {
        logger.info('[ForegroundScreenReader] UIA quality was not usable; vision supplied the content', {
          quality: assessment.quality,
          reasons: assessment.evidence.reasons,
        });
        return reading(base, {
          method: 'vision',
          content: '',
          spokenText: `I can see a ${identity}. ${visionAnswer.trim()}`,
          ...audit,
          visionAttempted,
          ...shot,
        });
      }
    } catch (err) {
      logger.warn(`[ForegroundScreenReader] vision fallback failed: ${errorMessage(err)}`);
    }
  }

  // ── 3. Terminal capability failure — never chrome, never runtime status ─
  return {
    ...terminal('unreliable_content', TERMINAL_UNRELIABLE, {
      windowTitle: base.windowTitle,
      process: base.process,
      hwnd: base.hwnd,
    }),
    ...audit,
    visionAttempted,
    ...shot,
  };
}
