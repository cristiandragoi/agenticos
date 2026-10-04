/**
 * DiscourseReferentResolver.ts — Turn-to-turn discourse / referent / modality resolution.
 *
 * Position in pipeline:
 *   TurnEnvelope → AuthoritativeIntentCompiler → **DiscourseReferentResolver** → literal target extraction
 *
 * Purpose (forensically proven defects, human session 2026-10-04 10:24–10:29Z):
 *   1. "Yes, read them."   → compiled as READ_CONTENT target='them' (literal window lookup).
 *   2. "Why not can we … content be verified? Why not?" → rigid why-regex missed → OTHER.
 *   3. "Can you see what I hold in my hand? Can you read this?" while the camera was the
 *      active perception source → routed to SCREEN (Telegram).
 *
 * Contract:
 *   - PURE: no I/O, no LLM, no mutation. Input = utterance + read-only discourse view.
 *   - Conversational references are resolved against VERIFIED working memory BEFORE any
 *     noun/pronoun is allowed to become a literal application/window target.
 *   - Explicit modality nouns ("camera", "screen") always override context.
 *   - Returns null when the utterance is not a discourse-dependent turn, so the existing
 *     compiler semantics apply unchanged.
 */

export type DiscourseModality = 'CAMERA' | 'SCREEN' | 'DESKTOP' | 'BROWSER' | 'NONE';

/** Read-only projection of AuthoritativeInteractionContext handed to the compiler. */
export interface DiscourseCompilerView {
  readonly activeModality: DiscourseModality;
  readonly activePerceptionAt: number | null;
  readonly activeApplication: string | null;
  readonly activeWindow: string | null;
  readonly activeChat: string | null;
  readonly verifiedSelectedChat: boolean;
  readonly lastRead: {
    readonly kind: 'MESSAGES' | 'CONTENT';
    readonly action: string;
    readonly application: string | null;
    readonly target: string | null;
    readonly chat: string | null;
    readonly entityCount: number;
    readonly acquiredAt: number;
  } | null;
  readonly lastExecutionFailureAt: number | null;
  readonly lastSuccessfulActionAt: number | null;
  readonly activeSurface?: string | null;
  readonly currentSearchQuery?: string | null;
  readonly focusedEntity?: string | null;
  readonly openedVideoUrls?: readonly string[];
  readonly activePlaybackTask?: any | null;
  readonly now?: number;
}

export type DiscourseResolution =
  | { readonly kind: 'EXPLAIN_PREVIOUS_OUTCOME'; readonly reason: string }
  | {
      readonly kind: 'CONTINUE_PLAYBACK';
      readonly taskType: 'READ_MESSAGES';
      readonly source: string;
      readonly nextIndex: number;
      readonly remainingCount: number;
      readonly referent: string;
      readonly reason: string;
    }
  | {
      readonly kind: 'OPEN_ANOTHER_VIDEO';
      readonly surface: 'YouTube';
      readonly entityHint?: string | null;
      readonly referent: string;
      readonly reason: string;
    }
  | {
      readonly kind: 'REPLAY_READ_RESULT';
      readonly selection: 'ALL' | 'ORDINAL' | 'LAST' | 'LAST_N';
      readonly ordinal?: number;
      readonly count?: number;
      readonly referent: string;
      readonly reason: string;
    }
  | { readonly kind: 'REACQUIRE_READ_SOURCE'; readonly referent: string; readonly reason: string }
  | { readonly kind: 'UNRESOLVED_REFERENT'; readonly referent: string; readonly reason: string }
  | {
      readonly kind: 'PERCEIVE';
      readonly modality: Exclude<DiscourseModality, 'NONE'>;
      readonly explicit: boolean;
      readonly referent: string;
      readonly reason: string;
    };

/** Verified read results older than this are considered stale and must be re-acquired. */
export const DISCOURSE_READ_FRESHNESS_MS = 5 * 60 * 1000;

const LEADING_FILLER =
  /^(?:(?:yes|yeah|yep|yup|no|nope|okay|ok|so|well|but|and|then|um+|uh+|hmm+|erm|ah|oh|jarvis|hey|i\s+mean|like|please|now|alright|right|sorry|wait)\b[\s,.:;!?-]*)+/i;

/**
 * Lowercases, strips punctuation (keeps apostrophes), removes leading fillers and
 * immediate STT word/phrase repetition.
 */
export function normalizeForDiscourse(text: string): string {
  if (!text) return '';
  let t = String(text).toLowerCase().replace(/[’`]/g, "'");
  t = t.replace(/[^a-z0-9'\s]/g, ' ').replace(/\s+/g, ' ').trim();
  // Collapse immediate repetition: "no no", "why not why not", "can we can we"
  t = t.replace(/\b([a-z0-9']+(?:\s+[a-z0-9']+){0,2})(?:\s+\1\b)+/g, '$1');
  t = t.replace(LEADING_FILLER, '').trim();
  // Request frames
  t = t.replace(/^(?:(?:can|could|would|will)\s+you\s+(?:please\s+)?|please\s+|just\s+)+/i, '').trim();
  return t;
}

const SUGGESTION_COMMAND =
  /\bwhy\s+(?:don'?t|do\s+not|not)\s+you\s+(?:just\s+)?(?:open|launch|read|go|check|look|try|show|navigate|start|find|locate|close|switch|play|send|call|tell)\b/;
const WHAT_WENT_WRONG =
  /\bwhat\s+(?:happened(?!\s+(?:with|to|in|at|on)\b)|went\s+wrong|was\s+wrong(?!\s+with\b)|is\s+wrong(?!\s+with\b)|was\s+the\s+(?:problem|issue|error)(?!\s+with\b)|is\s+the\s+(?:problem|issue|error)(?!\s+with\b))|\bwhat'?s\s+(?:wrong|the\s+(?:problem|issue|error))(?!\s+with\b)/;
const CAUSAL_VOCAB =
  /(?:\bnot\b|n't\b|\bfail|\bwork|\bverif|\bread\b|\bopen|\bfind|\bsee\b|\bload|\bcannot\b|\bproblem|\bwrong|\berror|\bable\b|\bthat\b|\bit\b|\bthis\b|\bthem\b)/;

/**
 * Causal intent resolution: is the utterance predominantly asking for the cause of the
 * immediately preceding result/failure? Tolerates STT hesitation/repetition.
 */
export function isCausalFollowUp(rawText: string): boolean {
  const t = normalizeForDiscourse(rawText);
  if (!t) return false;
  if (SUGGESTION_COMMAND.test(t)) return false;
  // Worker/task questions belong to TASK_STATUS / delegation, not the previous turn's outcome.
  if (/\b(?:hermes|codex|antigravity|task|job|goal|build|deploy(?:ment)?)\b/.test(t)) return false;
  if (WHAT_WENT_WRONG.test(t)) return true;
  const words = t.split(/\s+/).filter(Boolean);
  if (/^(?:why|how\s+come)\b/.test(t)) {
    return words.length <= 3 || CAUSAL_VOCAB.test(t);
  }
  if (/\b(?:why|how\s+come)\b/.test(t)) {
    // "investigate why …", "fix why …", "find out why …" are imperative requests, not follow-ups.
    if (/\b(?:investigate|fix|debug|delegate|implement|ask|find\s+out|figure\s+out|look\s+into|research)\b/.test(t)) return false;
    return /(?:\bnot\b|n't\b|\bfail|\bverif|\bwork|\bcannot\b|\bproblem|\bwrong)/.test(t);
  }
  return false;
}

const REPEAT_LAST_RESPONSE = /\bsay\s+that\s+again\b|\brepeat\s+(?:that|what\s+you\s+(?:just\s+)?said)\b|\bwhat\s+did\s+you\s+(?:just\s+)?say\b/;
const CAMERA_NOUN = /\b(?:camera|webcam|web\s+cam)\b/;
const CAMERA_STOP = /\b(?:close|turn\s+off|stop|disable|shut\s+down|deactivate)\b[^.]*\b(?:camera|webcam)\b/;
const SCREEN_NOUN = /\b(?:my|the|this|on|whole|entire)\s+screen\b|\bscreen\b/;
const PERCEPTION_VERB = /\b(?:read|see|look|what|show|tell|check|inspect|describe|whats|what's)\b/;
const APP_COMMAND = /\b(?:open|launch|start|navigate|go\s+to|locate|find|switch\s+to|close|delegate|send|type|click)\b/;
const CAMERA_INHERENT =
  /\b(?:holding|hold\s+in\s+my\s+hands?|have\s+in\s+my\s+hands?|in\s+my\s+hands?|see\s+me|look\s+at\s+me|what\s+i'?m\s+showing|what\s+am\s+i\s+showing|what\s+i\s+am\s+showing|what\s+i'?m\s+wearing|what\s+am\s+i\s+wearing)\b/;
const REFRESH = /\b(?:refresh|re-?read|re-?check|fresh|check\s+again|look\s+again|new\s+messages|current\s+messages|any\s+new)\b/;
const READ_VERB = /\b(?:read|say|repeat|tell\s+me|give\s+me|what\s+did|what\s+does|what\s+do|speak|recite)\b/;
const PLURAL_REFERENT =
  /\b(?:them|these|those|both(?:\s+of\s+them)?|all\s+of\s+them|the\s+messages|those\s+messages|these\s+messages)\b/;
const LAST_N_REFERENT = /\bthe\s+last\s+(two|2|three|3|four|4|five|5|few)\b(?!\s+(?:chat\s+)?messages?)/;
const EXPLICIT_FRESH_MESSAGES = /\b(?:last|latest|recent)\s+(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)?\s*(?:chat\s+)?messages?\b/;
const ORDINAL_REFERENT =
  /\b(?:the\s+|that\s+)?(first|second|third|fourth|fifth|1st|2nd|3rd|4th|5th|last|latest|final|previous)\s+(?:one|message)\b/;
const SINGULAR_REFERENT =
  /\bwhat\s+did\s+(?:it|that|they|he|she|the\s+message|that\s+message)\s+say\b|\bwhat\s+does\s+(?:it|that|the\s+message)\s+say\b|\b(?:read|say|repeat)\s+(?:it|that)\b|\b(?:the|that)\s+message\b/;
const THIS_DEICTIC =
  /\b(?:read|see|look\s+at|describe|identify|what'?s|what\s+is|what\s+does|tell\s+me\s+what)\b.*\bthis\b|\bwhat\s+do\s+you\s+see\b|\bcan\s+you\s+see\s+(?:it|this)\b|\bsee\s+(?:it|this)\b/;
const THIS_BROWSER_NOUN = /\b(?:this|that|the\s+current|current)\s+(?:page|webpage|web\s+page|site|website|tab)\b/;
const THIS_WINDOW_NOUN = /\b(?:this|that|the\s+current|current)\s+window\b/;
/** Explicitly named applications always override deictic/context resolution. */
const EXPLICIT_APP_NOUN =
  /\b(?:anti\s*-?\s*gravity|telegram|chrome|edge|firefox|brave|notepad|hermes|codex|explorer|vs\s+code|visual\s+studio|word|excel|outlook|discord|slack|spotify|whatsapp|terminal|powershell)\b/;
const EXPLAIN_MEANING = /\b(?:mean|means|meaning|explain|summari[sz]e|interpret)\b/;

function parseOrdinalWord(word: string): number | 'LAST' | 'PREVIOUS' {
  const w = word.toLowerCase();
  const map: Record<string, number> = {
    first: 1, '1st': 1, second: 2, '2nd': 2, third: 3, '3rd': 3, fourth: 4, '4th': 4, fifth: 5, '5th': 5,
  };
  if (map[w] !== undefined) return map[w];
  if (w === 'previous') return 'PREVIOUS';
  return 'LAST';
}

function parseCountWord(word: string): number {
  const map: Record<string, number> = { two: 2, '2': 2, three: 3, '3': 3, four: 4, '4': 4, five: 5, '5': 5, few: 3 };
  return map[word.toLowerCase()] ?? 2;
}

/**
 * Resolves a discourse-dependent utterance against verified working memory.
 * Returns null when the utterance carries no discourse dependency.
 */
export function resolveDiscourse(rawText: string, view?: DiscourseCompilerView | null): DiscourseResolution | null {
  const t = normalizeForDiscourse(rawText);
  if (!t) return null;

  // Repetition of the assistant's last utterance is owned by the existing repeat contract.
  if (REPEAT_LAST_RESPONSE.test(t)) return null;

  // 0. Causal follow-up ("why", "why not", "but why didn't that work", "what went wrong")
  if (isCausalFollowUp(rawText)) {
    return { kind: 'EXPLAIN_PREVIOUS_OUTCOME', reason: 'Causal follow-up about the immediately preceding outcome' };
  }

  // Playback continuation ("continue", "continue reading", "continue with the messages", "next", "read the rest")
  const isContinuation = /^(?:continue|continue\s+reading|continue\s+with\s+(?:the\s+)?messages|next|read\s+the\s+rest|go\s+on|keep\s+reading|more\s+messages)$/i.test(t);
  if (isContinuation && view?.activePlaybackTask && view.activePlaybackTask.status !== 'COMPLETED') {
    const pt = view.activePlaybackTask;
    const remainingCount = pt.remainingMessages?.length || Math.max(0, (pt.messageRecords?.length || 0) - pt.currentMessageIndex);
    if (remainingCount > 0) {
      return {
        kind: 'CONTINUE_PLAYBACK',
        taskType: 'READ_MESSAGES',
        source: pt.source || 'chat',
        nextIndex: pt.currentMessageIndex,
        remainingCount,
        referent: 'messages',
        reason: 'User requested continuation of in-flight/interrupted message playback',
      };
    }
  }

  // YouTube "open another one" / "play another one" continuity
  const isAnotherVideo = /^(?:open\s+(?:another\s+one|another\s+video|another|next\s+one)|play\s+(?:another\s+one|another\s+video|another|next\s+one)|another\s+one|next\s+video)$/i.test(t);
  if (isAnotherVideo && (view?.activeSurface === 'YouTube' || view?.activeApplication?.toLowerCase() === 'chrome')) {
    return {
      kind: 'OPEN_ANOTHER_VIDEO',
      surface: 'YouTube',
      entityHint: view?.focusedEntity || view?.currentSearchQuery || null,
      referent: 'another video',
      reason: 'User requested another video on active YouTube surface',
    };
  }

  const modality: DiscourseModality = view?.activeModality || 'NONE';
  const now = view?.now ?? Date.now();

  // 1. Explicit modality nouns override context.
  if (CAMERA_NOUN.test(t) && !CAMERA_STOP.test(t)) {
    return { kind: 'PERCEIVE', modality: 'CAMERA', explicit: true, referent: 'camera', reason: 'Explicit camera noun selects CAMERA modality' };
  }
  if (SCREEN_NOUN.test(t) && PERCEPTION_VERB.test(t) && !/\bshare\s+(?:my\s+)?screen\b/.test(t)) {
    return { kind: 'PERCEIVE', modality: 'SCREEN', explicit: true, referent: 'screen', reason: 'Explicit screen noun selects SCREEN modality' };
  }

  // 2. Explicit application/navigation commands are never discourse turns.
  if (APP_COMMAND.test(t)) return null;

  // 3. Camera-inherent deixis ("what I'm holding", "what I have in my hand", "can you see me").
  if (CAMERA_INHERENT.test(t)) {
    return { kind: 'PERCEIVE', modality: 'CAMERA', explicit: false, referent: 'held object / user', reason: 'Referent is physically in front of the camera (hand/holding/me)' };
  }

  // 4. References to previously read, verified content.
  const lastRead = view?.lastRead || null;
  const isFresh = Boolean(lastRead && now - lastRead.acquiredAt <= DISCOURSE_READ_FRESHNESS_MS);
  const cameraMoreRecent = Boolean(
    modality === 'CAMERA' && view?.activePerceptionAt && (!lastRead || view.activePerceptionAt > lastRead.acquiredAt),
  );

  const ordinalMatch = t.match(ORDINAL_REFERENT);
  const pluralMatch = t.match(PLURAL_REFERENT);
  const lastNMatch = t.match(LAST_N_REFERENT);
  const singularMatch = t.match(SINGULAR_REFERENT);
  const explicitFreshMessages = EXPLICIT_FRESH_MESSAGES.test(t);
  const hasReadVerb = READ_VERB.test(t);

  const referentText =
    (ordinalMatch && ordinalMatch[0]) || (pluralMatch && pluralMatch[0]) || (lastNMatch && lastNMatch[0]) || (singularMatch && singularMatch[0]) || '';

  const isContentReference =
    !explicitFreshMessages &&
    (Boolean(ordinalMatch) ||
      (Boolean(pluralMatch) && hasReadVerb) ||
      (Boolean(lastNMatch) && hasReadVerb) ||
      (Boolean(singularMatch) && !cameraMoreRecent));

  if (isContentReference) {
    // "What does the last one mean?" asks for interpretation, owned by the existing explain contract.
    if (EXPLAIN_MEANING.test(t)) return null;
    if (!lastRead) {
      // Plural pronoun referents with no verified antecedent must never become literal window names.
      // Ordinal / singular references without antecedent keep their existing compiler semantics.
      if (pluralMatch && !ordinalMatch) {
        return { kind: 'UNRESOLVED_REFERENT', referent: referentText.trim(), reason: 'Referent has no verified antecedent in discourse state' };
      }
      return null;
    }

    // Singular "read it / read that" right after a failure keeps causal semantics.
    if (singularMatch && !pluralMatch && !ordinalMatch && /\b(?:read|say)\s+(?:it|that)\b/.test(t)) {
      const failureAt = view?.lastExecutionFailureAt ?? 0;
      if (failureAt > lastRead.acquiredAt) return null;
    }

    if (REFRESH.test(t) || !isFresh) {
      return {
        kind: 'REACQUIRE_READ_SOURCE',
        referent: referentText.trim(),
        reason: REFRESH.test(t) ? 'User explicitly requested fresh acquisition' : 'Previous verified evidence is stale',
      };
    }

    if (ordinalMatch) {
      const ord = parseOrdinalWord(ordinalMatch[1]);
      if (ord === 'LAST') {
        return { kind: 'REPLAY_READ_RESULT', selection: 'LAST', referent: ordinalMatch[0].trim(), reason: 'Ordinal referent resolved against lastReadResult' };
      }
      if (ord === 'PREVIOUS') {
        return {
          kind: 'REPLAY_READ_RESULT', selection: 'ORDINAL', ordinal: Math.max(1, lastRead.entityCount - 1),
          referent: ordinalMatch[0].trim(), reason: 'Ordinal referent resolved against lastReadResult',
        };
      }
      return { kind: 'REPLAY_READ_RESULT', selection: 'ORDINAL', ordinal: ord, referent: ordinalMatch[0].trim(), reason: 'Ordinal referent resolved against lastReadResult' };
    }
    if (lastNMatch && !pluralMatch) {
      return { kind: 'REPLAY_READ_RESULT', selection: 'LAST_N', count: parseCountWord(lastNMatch[1]), referent: lastNMatch[0].trim(), reason: 'Count referent resolved against lastReadResult' };
    }
    if (singularMatch && !pluralMatch && /\b(?:the|that)\s+message\b/.test(t) && lastRead.entityCount > 1) {
      return { kind: 'REPLAY_READ_RESULT', selection: 'LAST', referent: singularMatch[0].trim(), reason: 'Singular message referent resolved to the most recent message' };
    }
    return { kind: 'REPLAY_READ_RESULT', selection: 'ALL', referent: referentText.trim(), reason: 'Pronoun referent resolved against lastReadResult' };
  }

  // 5. Deictic perception ("read this", "what is this", "look at this") follows the active modality.
  if (THIS_BROWSER_NOUN.test(t)) return null; // explicit page noun: existing browser semantics
  if (EXPLICIT_APP_NOUN.test(t)) return null; // explicitly named application: literal target semantics
  if (THIS_WINDOW_NOUN.test(t) && PERCEPTION_VERB.test(t)) {
    if (!view?.activeApplication) return null;
    return { kind: 'PERCEIVE', modality: 'DESKTOP', explicit: true, referent: 'window', reason: 'Explicit window noun selects DESKTOP modality' };
  }
  const itInCamera = cameraMoreRecent && /\bwhat\s+does\s+it\s+say\b|\b(?:read|see)\s+it\b/.test(t);
  if (THIS_DEICTIC.test(t) || itInCamera) {
    if (modality === 'NONE') return null;
    return {
      kind: 'PERCEIVE',
      modality,
      explicit: false,
      referent: 'this',
      reason: `Deictic referent resolved against active modality ${modality}`,
    };
  }

  return null;
}
