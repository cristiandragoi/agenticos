/**
 * foregroundScreenIntent.ts — generic intent abstraction for "read what is on my screen".
 *
 * WHY THIS EXISTS
 * The previous routing matched a long list of hard-coded phrasings
 * (`ControlPlaneTurnHandler` stage 0a2). Any paraphrase that was not in the list
 * — e.g. "Read what is CURRENTLY on my screen." — escaped deterministic routing
 * and fell through to the generic supervisor, which answered with AgenticOS
 * runtime diagnostics or a project/task lookup instead of reading the screen.
 *
 * This module replaces phrase matching with a compositional decision: an
 * utterance is a foreground-screen read when it references the VISIBLE SURFACE
 * and asks to READ it, and it is not one of the excluded neighbouring
 * capabilities (camera, screenshot capture, launching/navigating, remote search,
 * or AgenticOS runtime diagnostics).
 *
 * It is deliberately token/verb-object based rather than a phrase list, so new
 * paraphrases route correctly without new patterns.
 */

/** Things that identify the surface the user is looking at. */
const SURFACE_NOUNS = new Set([
  'screen', 'monitor', 'display', 'desktop', 'window', 'page', 'tab',
  'document', 'pdf', 'browser', 'view', 'content', 'workspace',
]);

/** Words that point at what is currently visible rather than a named thing. */
const DEICTIC = new Set([
  'this', 'that', 'these', 'those', 'it', 'current', 'currently',
  'visible', 'foreground', 'active', 'now', 'here',
]);

/** Verbs/intents that mean "tell me what it says". */
const READ_VERBS = new Set([
  'read', 'reading', 'describe', 'summarize', 'summarise', 'summary',
  'inspect', 'see', 'look', 'show', 'tell', 'extract', 'explain',
  'say', 'says', 'saying', 'content', 'contents',
]);

/** Interrogative forms that request the surface's content without a read verb. */
const CONTENT_QUESTION = /\bwhat(?:'s|s| is| are)\b/;

/** Camera / physical-presence vocabulary — a different capability. */
const CAMERA_NOUNS = new Set([
  'camera', 'webcam', 'photo', 'photograph', 'picture', 'image', 'hand',
]);

/** AgenticOS self / runtime vocabulary — must never satisfy a screen read. */
const DIAGNOSTIC_NOUNS = new Set([
  'diagnostic', 'diagnostics', 'health', 'runtime', 'status', 'incident',
  'selfheal', 'heartbeat', 'agenticos',
]);

/** Launch / navigation vocabulary. */
const LAUNCH_VERBS = new Set([
  'open', 'launch', 'start', 'run', 'navigate', 'goto', 'go', 'switch', 'focus',
]);

/** Glue words that carry no target on their own. */
const STOPWORDS = new Set([
  'the', 'a', 'an', 'my', 'your', 'our', 'me', 'i', 'you', 'is', 'are', 'was',
  'on', 'in', 'at', 'of', 'to', 'for', 'and', 'or', 'it', 'this', 'that',
  'right', 'now', 'up', 'please', 'jarvis', 'can', 'could', 'would', 'do',
  'does', 'what', 'whats', 'which', 'where', 'there', 'here', 'be', 'am',
  'currently', 'current', 'visible', 'foreground', 'active',
]);

/**
 * Conversational filler that should not prevent a bare-read from
 * being recognised as a foreground screen read. Words like "yeah",
 * "whatever", "just" contribute no actionable target.
 */
const FILLER = new Set([
  'yeah', 'yep', 'yes', 'ok', 'okay', 'sure', 'well', 'so', 'just',
  'whatever', 'alright', 'hey', 'um', 'uh', 'hmm', 'like', 'actually',
  'again', 'also', 'already', 'anyway', 'basically', 'literally',
]);

export interface ForegroundScreenIntent {
  /** True when the utterance is a "read the visible foreground screen" request. */
  isReadForegroundScreen: boolean;
  confidence: number;
  reason: string;
}

function tokenize(raw: string): string[] {
  return (raw || '')
    .toLowerCase()
    // Keep letters/digits (incl. unicode) and apostrophes, drop punctuation.
    .replace(/[^\p{L}\p{N}\s']/gu, ' ')
    .replace(/'/g, '')
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Detect a foreground-screen read request.
 *
 * Positive  = surface reference + read intent, minus excluded neighbours.
 * Negative  = camera, screenshot capture, launching/navigating to a named
 *             target, remote search, or AgenticOS runtime diagnostics.
 */
export function detectForegroundScreenIntent(raw: string): ForegroundScreenIntent {
  const text = (raw || '').toLowerCase();
  const tokens = tokenize(raw);

  if (tokens.length === 0) {
    return { isReadForegroundScreen: false, confidence: 0, reason: 'empty input' };
  }

  const hasSurface = tokens.some((t) => SURFACE_NOUNS.has(t));
  const hasDeictic = tokens.some((t) => DEICTIC.has(t));
  const hasReadVerb = tokens.some((t) => READ_VERBS.has(t));

  // ── Exclusions (neighbouring capabilities win) ──────────────────────────
  const mentionsCamera = tokens.some((t) => CAMERA_NOUNS.has(t));
  // 'me' is only camera-relevant in "see me" / "look at me" patterns —
  // not when it is the grammatical object of a read verb ("read for me",
  // "tell me", "describe that for me").
  const isCameraMePattern = !mentionsCamera && tokens.includes('me') &&
    /\b(?:see|look\s+at|watch|observe)\s+me\b/.test(text) && !hasSurface;
  if ((mentionsCamera || isCameraMePattern) && !hasSurface) {
    return { isReadForegroundScreen: false, confidence: 0, reason: 'camera/presence vocabulary without a screen surface' };
  }

  const mentionsScreenshot = tokens.includes('screenshot') || tokens.includes('snapshot');
  const mentionsCaptureVerb = ['take', 'capture', 'grab', 'save'].some((v) => tokens.includes(v));
  if (mentionsScreenshot && mentionsCaptureVerb) {
    return { isReadForegroundScreen: false, confidence: 0, reason: 'explicit screenshot capture (screen.capture)' };
  }

  const mentionsSearch = /\b(google|search the web|search for|look up|web search)\b/.test(text);
  if (mentionsSearch) {
    return { isReadForegroundScreen: false, confidence: 0, reason: 'remote/web search' };
  }

  const mentionsDiagnostics = tokens.some((t) => DIAGNOSTIC_NOUNS.has(t));
  if (mentionsDiagnostics && !hasSurface) {
    return { isReadForegroundScreen: false, confidence: 0, reason: 'AgenticOS runtime diagnostics vocabulary' };
  }

  // Launch verb followed by a NAMED target (an app/thing, not the surface
  // itself) means the user wants that thing opened, not the current screen read.
  const launchIdx = tokens.findIndex((t) => LAUNCH_VERBS.has(t));
  if (launchIdx >= 0) {
    const tail = tokens
      .slice(launchIdx + 1)
      .filter((t) => !STOPWORDS.has(t) && !SURFACE_NOUNS.has(t) && !DEICTIC.has(t));
    if (tail.length > 0) {
      return { isReadForegroundScreen: false, confidence: 0, reason: `launch/navigate to named target: ${tail.join(' ')}` };
    }
  }

  // ── Positive decision ───────────────────────────────────────────────────
  // A surface reference plus either an explicit read verb or an interrogative
  // "what is/are …" is a request for that surface's content. Compositional, so
  // "What is on my screen right now?" needs no phrase entry.
  const asksWhatIsThere = CONTENT_QUESTION.test(text);
  if (hasSurface && (hasReadVerb || asksWhatIsThere)) {
    return {
      isReadForegroundScreen: true,
      confidence: hasReadVerb ? 0.9 : 0.8,
      reason: hasReadVerb
        ? 'surface reference + read intent'
        : 'surface reference + content question',
    };
  }

  // ── Bare read verb with no competing target (RC1 fix) ───────────────────
  // "Jarvis, read." / "Yeah, whatever, Jarvis, read." / "Read for me."
  // When the only meaningful tokens beside the read verb are stopwords or
  // conversational filler, the user is implicitly referring to the foreground
  // screen. This prevents a bare "read" from cascading to chat_trivial.
  if (hasReadVerb) {
    const nonStopTokens = tokens.filter(
      (t) => !STOPWORDS.has(t) && !READ_VERBS.has(t) && !FILLER.has(t),
    );
    if (nonStopTokens.length === 0) {
      return {
        isReadForegroundScreen: true,
        confidence: 0.65,
        reason: 'bare read verb with no competing target — implied foreground screen',
      };
    }
  }

  // "What does it say?" / "Tell me what that says" — deictic reference to the
  // visible surface with a read intent, no explicit surface noun.
  const asksWhatItSays = /\b(what\s+(?:does|do)\s+(?:it|this|that)\s+say|tell\s+me\s+what\s+(?:it|this|that)\s+says)\b/.test(text);
  if (asksWhatItSays && hasReadVerb) {
    return {
      isReadForegroundScreen: true,
      confidence: 0.75,
      reason: 'deictic "what does it say" with read intent',
    };
  }

  // ── Deictic + read verb (RC1 fix 2) ──────────────────────────────────────
  // "Read this." / "Tell me what that says." / "Look at it."
  // A deictic reference with a read verb strongly implies the foreground screen
  // when no explicit surface noun is present. Previously rejected at 0.4;
  // upgraded to accepted at 0.7 because the deictic IS the surface reference
  // in a voice context where the user is looking at their screen.
  if (hasDeictic && hasReadVerb && !hasSurface) {
    return {
      isReadForegroundScreen: true,
      confidence: 0.7,
      reason: 'read intent with deictic reference — implied foreground surface',
    };
  }

  return { isReadForegroundScreen: false, confidence: 0, reason: 'no surface read intent detected' };
}
