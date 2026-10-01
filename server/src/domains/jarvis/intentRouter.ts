export interface IntentResult {
  route: 'codex' | 'hermes' | 'memory' | 'direct' | 'clarification_required' | 'agent_teams' | 'investigate' | 'magnitude' | 'antigravity';
  semanticIntent: string;
  executionMode: 'direct_conversation' | 'operational_execution';
  selectedCapability: 'hermes' | 'codex' | 'magnitude' | 'agent_teams' | 'antigravity' | 'system' | 'none';
  category:
    | 'conversation'
    | 'repository_analysis'
    | 'repository_change'
    | 'codex_delegation'
    | 'agent_team_execution'
    | 'file_operation'
    | 'pipeline_operation'
    | 'research'
    | 'system_status'
    | 'approval_required'
    | 'investigation'
    | 'browser_automation'
    | 'project_planning';
  mode: 'direct_conversation' | 'operational_execution';
  confidence: number;
  reason: string;
  requiresWorkspace?: boolean;
  requiresApproval?: boolean;
  selectedAgent?: 'Jarvis' | 'CodeX' | 'Hermes' | 'Agent Teams' | 'AntiGravity' | 'System';
  plan?: string[];
  /** Populated only for clarification_required when the transcript looks
   *  like speech-recognition corruption (voice-aware clarification). */
  voiceIssue?: string;
}

export interface DelegationSignals {
  explicitDelegationRequested: boolean;
  globalNonDelegationRequested: boolean;
  explicitWorkerRequested?: 'codex' | 'hermes' | 'magnitude' | 'agent_teams' | 'antigravity';
  prohibitedWorkers: ('codex' | 'hermes' | 'magnitude' | 'agent_teams' | 'automations' | 'antigravity')[];
  explicitNonDelegationRequested: boolean; // backwards compatibility
}

export function detectDelegationSignals(prompt: string): DelegationSignals {
  const p = prompt.toLowerCase().replace(/\s+/g, ' ').trim();

  const prohibitedWorkers: ('codex' | 'hermes' | 'magnitude' | 'agent_teams' | 'automations' | 'antigravity')[] = [];
  if (/\b(?:do not use|don't use|without|no)\s+codex\b/.test(p) || /\bno\s+codex\s+goal\b/.test(p)) {
    prohibitedWorkers.push('codex');
  }
  if (/\b(?:do not use|don't use|without|no)\s+hermes\b/.test(p)) {
    prohibitedWorkers.push('hermes');
  }
  if (/\b(?:do not use|don't use|without|no)\s+magnitude\b/.test(p)) {
    prohibitedWorkers.push('magnitude');
  }
  if (/\b(?:do not use|don't use|without|no)\s+(?:teams?|agent teams?|multi-agent)\b/.test(p)) {
    prohibitedWorkers.push('agent_teams');
  }
  if (/\b(?:do not use|don't use|without|no)\s+(?:antigravity|anti-gravity)\b/.test(p)) {
    prohibitedWorkers.push('antigravity');
  }
  if (/\b(?:do not|don't|no|without|never)\s+(?:create|register|set up|add|schedule)?\s*(?:an?\s+)?automation\b/.test(p)) {
    prohibitedWorkers.push('automations');
  }

  let explicitWorkerRequested: 'codex' | 'hermes' | 'magnitude' | 'agent_teams' | 'antigravity' | undefined;
  if ((/\b(?:use|ask|have|tell|delegate to|give\s+(?:this\s+task\s+to|to)?)\s*(?:antigravity|anti-gravity)\b/.test(p) || /\b(?:antigravity|anti-gravity)\b/.test(p)) && !prohibitedWorkers.includes('antigravity')) {
    explicitWorkerRequested = 'antigravity';
  } else if ((/\b(?:use|ask|have|tell|delegate to)\s+magnitude\b/.test(p) || /^magnitude[,:]/.test(p)) && !prohibitedWorkers.includes('magnitude')) {
    explicitWorkerRequested = 'magnitude';
  } else if ((/\b(?:use|ask|have|tell|delegate to)\s+codex\b/.test(p) || /^codex[,:]/.test(p)) && !prohibitedWorkers.includes('codex') && !/\b(?:do not|don't|no|without)\s+use\s+codex\b/.test(p)) {
    explicitWorkerRequested = 'codex';
  } else if ((/\b(?:use|ask|have|tell|delegate to)\s+hermes\b/.test(p) || /^hermes[,:]/.test(p)) && !prohibitedWorkers.includes('hermes') && !/\b(?:do not|don't|no|without)\s+use\s+hermes\b/.test(p)) {
    explicitWorkerRequested = 'hermes';
  } else if ((/\b(?:use|ask|have|tell|delegate to)\s+(?:teams?|agent teams?)\b/.test(p) || /^teams?[,:]/.test(p)) && !prohibitedWorkers.includes('agent_teams') && !/\b(?:do not|don't|no|without)\s+use\s+(?:teams?|agent teams?)\b/.test(p)) {
    explicitWorkerRequested = 'agent_teams';
  }

  const globalNonDelegationRequested =
    /\banswer directly\b/.test(p) ||
    /\bdo not delegate\b/.test(p) ||
    /\bdon't delegate\b/.test(p) ||
    /\bno\s+agent\b/.test(p);

  const explicitDelegationRequested = !!explicitWorkerRequested || (
    /\bcodex\b/.test(p) && /\b(?:inspect|analy[sz]e|review|fix|change|modify|update|implement|create|build)\b/.test(p) && !prohibitedWorkers.includes('codex')
  );

  return {
    explicitDelegationRequested,
    globalNonDelegationRequested,
    explicitWorkerRequested,
    prohibitedWorkers,
    explicitNonDelegationRequested: globalNonDelegationRequested && !explicitWorkerRequested
  };
}

/**
 * Implicit bug-report detection for contextual AgenticOS statements.
 *
 * A statement about a malfunction, inconsistency, unexpected UI state,
 * incorrect value, failed operation, or broken behavior is treated as an
 * implicit operational request ("investigate this problem"), even without an
 * imperative verb. This is PATTERN-based (problem signals + contextual
 * references) — NOT a hardcoded list of example phrases.
 *
 * Informational wh-questions are handled BEFORE this check (they stay direct),
 * so "Why does the provider badge exist?" remains direct conversation.
 */
const APOSTROPHE = `['\u2019]`;
const BUG_SIGNAL_PATTERNS: RegExp[] = [
  // Explicit incorrectness / inconsistency
  /\b(wrong|incorrect|mismatch|out of sync|outdated|stale)\b/,
  /\b(broken|broke|not working|not functioning)\b/,
  // Negated capability about an app artifact ("button doesn't work",
  // "not showing", "won't switch", "can't see")
  new RegExp(`\\b(doesn${APOSTROPHE}?t|doesnt|don${APOSTROPHE}?t|dont|won${APOSTROPHE}?t|wont|can${APOSTROPHE}?t|cant|isn${APOSTROPHE}?t|isnt|aren${APOSTROPHE}?t|arent|didn${APOSTROPHE}?t|didnt)\\s+(work|working|show|showing|update|updating|display|displaying|switch|switching|load|loading|respond|responding|start|stop|open|close|appear|appearing|change|changing|connect|connecting)\\b`),
  /\bnot\s+(work|working|show|showing|update|updating|display|displaying|switch|switching|load|loading|respond|responding|correct|right|there|found|available)\b/,
  // Failure / stuck / missing states
  /\b(stuck|failed|failing|error|errors|missing|gone|nothing happens|no longer|still shows|still says|still stuck|weird|strange)\b/,
  // Deictic + state copula ("It is wrong", "That's broken", "This is stuck")
  /\b(it|this|that|these|those)\s+(is|are|was|were|did|does)\s+(wrong|broken|stuck|failed|missing|incorrect|not)\b/,
  new RegExp(`\\b(that${APOSTROPHE}?s|thats|this is|its|it${APOSTROPHE}?s)\\s+(wrong|broken|stuck|failed|not|showing|updating|displaying)\\b`),
  // Repeat/failure context: "It failed again", "still not", "again"
  /\b(failed|fail|broken|wrong|stuck)\s+again\b/,
];

export function isBugReportStatement(prompt: string): boolean {
  const p = prompt.toLowerCase().replace(/\s+/g, ' ').trim();
  if (/\b(speak|sprich|vorbește|deutsch|română|romanian|german|english|hallo|salut|bună|hello|hi|hey)\b/i.test(p)) {
    return false;
  }
  return BUG_SIGNAL_PATTERNS.some((re) => re.test(p));
}


/**
 * Detect obvious speech-recognition corruption (conversation-state milestone).
 *
 * Returns a short human description when the transcript is likely malformed,
 * or null when it reads normally. Heuristics only — never blocks a clean
 * utterance. Recognized corruption classes:
 *  - repeated fragments: "the the the" / "and and and"
 *  - impossible letter-runs: "xxxqzz" (no vowels, 5+ consonants)
 *  - abrupt truncation: the final token is a bare letter or 1-2 chars
 */
export function detectVoiceTranscriptionIssue(prompt: string): string | null {
  const p = prompt.trim();
  if (!p) return null;
  // §9 (stabilization): corruption detection must be CONSERVATIVE. Normal
  // grammar mistakes, accents, frustration, repetition and informal speech
  // are NOT corruption. Only STRONG evidence triggers this path.

  // Repeated fragments (3+ identical consecutive content tokens). Short
  // particles ("a", "i") are excluded — repeated exclamations like "ha ha
  // ha" or "no no no" are valid emphatic speech, not word salad.
  const tokens = p.split(/\s+/);
  for (let i = 0; i + 2 < tokens.length; i++) {
    const t = tokens[i].toLowerCase().replace(/[^a-zäöü]/g, '');
    if (t.length >= 3 &&
      t === tokens[i + 1].toLowerCase().replace(/[^a-zäöü]/g, '') &&
      t === tokens[i + 2].toLowerCase().replace(/[^a-zäöü]/g, '')) {
      return 'repeated fragment detected';
    }
  }
  // Impossible letter-run "words" (6+ consecutive consonants, no vowel) —
  // raised from 5+ because short consonant clusters ("strengths", "glimpsed")
  // are real words; only long vowel-less runs are genuine STT artifacts.
  for (const t of tokens) {
    const alpha = t.replace(/[^a-zA-ZäöüÄÖÜß]/g, '');
    if (alpha.length >= 8 && !/[aeiouyäöü]/i.test(alpha)) {
      return 'impossible word fragment detected';
    }
  }
  // Abrupt truncation — STRONG evidence only (§9):
  //  - a sentence that already ends in terminal punctuation is complete,
  //    whatever the final token length ("What the hell is going on?").
  //  - the final token must be a BARE single letter, or a 2-char fragment
  //    in a longer utterance. Real words like "me", "on", "do", "up" at
  //    the end of a valid sentence must never classify as truncation.
  if (/[?.!…]$/.test(p)) return null;
  const last = tokens[tokens.length - 1];
  if (last && /^[a-zäöü]$/i.test(last) && tokens.length >= 2) {
    return 'abrupt truncation detected';
  }
  // 2-char fragment: truncation UNLESS it is a common real 2-letter word
  // ("do", "on", "me", "up"). Genuine artifacts like "ab" (from "about")
  // still classify. §9: never flag real words.
  const REAL_TWO_LETTER_WORDS = new Set([
    'me', 'my', 'do', 'no', 'on', 'of', 'in', 'it', 'is', 'am', 'be',
    'we', 'he', 'us', 'up', 'or', 'so', 'to', 'an', 'as', 'at', 'by',
    'if', 'ok', 'hi', 'go', 'ya', 'um', 'uh', 'hm', 'ah', 'oh',
  ]);
  const lastClean = last ? last.toLowerCase().replace(/[^a-zäöü]/g, '') : '';
  if (lastClean && /^[a-zäöü]{2}$/.test(lastClean) && tokens.length >= 5 && !REAL_TWO_LETTER_WORDS.has(lastClean)) {
    return 'abrupt truncation detected';
  }
  return null;
}

/**
 * §8 (stabilization): complaints ABOUT Jarvis/AgenticOS itself.
 *
 * "You are not able to work fine.", "You keep misunderstanding me.",
 * "What the hell is going on?" are complaints about the assistant —
 * understandable conversational input, never corrupted speech. They route
 * to INVESTIGATE (inspect the current AgenticOS/runtime state and report)
 * instead of clarification or generic chat.
 */
const ASSISTANT_COMPLAINT_PATTERNS: RegExp[] = [
  // Second-person malfunction: "you are not able to work fine",
  // "you're not working", "you don't work", "you never listen"
  new RegExp(`\\byou${APOSTROPHE}?re\\s+(not\\s+)?(able|capable)\\s+to\\b`),
  /\byou\s+(are|were)\s+(not\s+)?(able|capable)\s+to\b/,
  /\byou\s+(are|were)\s+not\s+(understanding|listening|hearing|getting|following)\b/,
  /\byou\s+(don|do)\s*['\u2019]?t\s+(work|function|understand|listen|respond|help|know)\b/,
  /\byou\s+(never|always)\s+(work|function|understand|listen|respond|help|ask|fail)\b/,
  /\byou\s+keep\s+\w{3,}ing\b/, // "you keep misunderstanding me"
  /\byou\s+are\s+(useless|broken|annoying|terrible|awful|hopeless)\b/,
  // Frustrated rhetorical complaints about the situation
  /\bwhat\s+the\s+(hell|heck|f[\u2019']?)\s+is\s+going\s+on\b/,
  /\bi\s+don\s*['\u2019]?t\s+know\s+what\s+(to\s+do|you\s*['\u2019]?re\s+doing)\b/,
  /\bwhy\s+are\s+you\s+(asking|saying|doing)\s+(me\s+)?(again|that)\b/,
  /\b(why|how)\s+(did|do)\s+you\s+keep\b/,
  // Explicit "this still doesn't work" family about the app itself
  /\b(this|it|that)\s+still\s+doesn\s*['\u2019]?t\s+work\b/,
];

export function isAssistantComplaint(prompt: string): boolean {
  const p = prompt.toLowerCase().replace(/\s+/g, ' ').trim();
  return ASSISTANT_COMPLAINT_PATTERNS.some((re) => re.test(p));
}
const CONVERSATIONAL_FEEDBACK_PATTERNS: RegExp[] = [
  /\b(?:didn'?t|did not|doesn'?t|does not)\s+(?:reply|answer|respond|tell|explain)(?:\s+(?:to\s+me|me))?\s+(?:like|how|what|the way)\s+(?:i\s+(?:want|wanted|asked|meant|expected)|you should)\b/i,
  /\bthat'?s\s+not\s+what\s+i\s+(?:asked|wanted|meant|requested)\b/i,
  /\bwhy\s+did\s+you\s+(?:do|start|run|create|approve)\s+that\b/i,
  /\bi\s+meant\s+(?:the\s+)?(?:previous|other|earlier|last)\s+(?:task|run|message|question|goal|one)\b/i,
  /\byou\s+started\s+(?:it|the task)\s+but\s+didn'?t\s+(?:answer|reply|respond)\b/i,
  /\b(?:it|the task|you)\s+(?:approved\s+and\s+started|started|ran)\s*,?\s*but\s+(?:it\s+)?didn'?t\s+(?:reply|answer|respond)\b/i,
  /\bthat\s+response\s+was\s+(?:wrong|incorrect|unhelpful|bad|not what i asked)\b/i,
  /\bi\s+don'?t\s+like\s+how\s+(?:that|you)\s+(?:answered|replied|responded|handled that)\b/i,
  /\bwhat\s+happened\s+with\s+that\s+(?:task|run|goal|operation|request)\b/i,
  /\bwhy\s+didn'?t\s+you\s+(?:reply|answer|tell me|respond)\b/i,
  /\bi\s+give\s+a\s+task\s*,?\s*but\b/i,
  /\bi\s+gave\s+a\s+task\s*,?\s*but\b/i,
];

export function isConversationalFeedback(prompt: string): boolean {
  const p = prompt.toLowerCase().replace(/\s+/g, ' ').trim();
  return CONVERSATIONAL_FEEDBACK_PATTERNS.some((re) => re.test(p));
}

/**
 * UI / interface / layout operational problem classifier.
 *
 * AgenticOS is a working desktop application: when the user says the UI is
 * wrong, asks to change/fix/move a panel, or reports an overlap, that is an
 * OPERATIONAL problem report — Jarvis inspects runtime/frontend state and
 * can delegate engineering work. It must NEVER fall through to generic chat
 * ("I cannot modify the UI") or to a clarification wall.
 *
 * Pattern-based (semantic family), NOT a hardcoded sentence list:
 *  - UI/interface/layout topic tokens: chat interface, layout, panel,
 *    transcript, composer, orb, workspace, controls, section, sidebar,
 *    activity column, spacing, overlap, component, screen, window…
 *  - Problem/change signals: wrong, broken, fix, change, move, overlap,
 *    overlapping, cut, misaligned, misplaced, floating, still looks,
 *    shouldn't be, doesn't work, bug, glitch, weird, inconsistent…
 *  - Deictic phrases (this/that/it) are classified ONLY when recent
 *    conversation context already refers to AgenticOS UI/state.
 *
 * Informational UI QUESTIONS ("What is the transcript panel?", "How does
 * the layout system work?") are explicitly excluded — they stay direct.
 */
const UI_TOPIC_RE =
  /\b(ui|interface|layout|panel|transcript|composer|orb|workspace|controls|section|sidebar|activity column|spacing|overlap|component|screen|window|header|footer|status strip|command bar|dock|rail|bar)\b/i;
const UI_CHANGE_RE =
  /\b(change|fix|move|modify|rearrange|reorder|adjust|repair|redesign|restyle|relocate|shift)\b/i;
const UI_PROBLEM_RE =
  /\b(wrong|broken|broke|misaligned|misplaced|overlap|overlapping|cut|cutting|floating|inconsistent|shouldn'?t be|should not be|doesn'?t (look|work|fit|belong)|still looks|looks wrong|bug|glitch|weird|strange|not (right|correct|aligned|working)|out of place|in the wrong place|too (high|low|big|small|wide|narrow)|pushed|clipped|hidden|overlapping|still (here|there|shown|displayed|visible)|still present|like this|like that|this way|that way)\b/i;
const UI_DEICTIC_RE = /\b(this|that|it|these|those)\b/i;

export function isUIChangeOrProblemRequest(prompt: string, recentText?: string): boolean {
  const p = prompt.toLowerCase().replace(/\s+/g, ' ').trim();
  if (!p) return false;
  // Informational UI questions stay direct — never investigate.
  if (/^(what|who|where|when|which)\s+(is|are|does|do|can|could|would)\b/.test(p) && !/\b(wrong|broken|overlap|still|issue|problem|like this|like that)\b/.test(p)) return false;
  // "Why is the chat interface like this?" / "Why does the transcript
  // overlap?" are PROBLEM questions — they investigate. Only genuine
  // how/what explanations stay direct.
  if (/^how\s+(does|do|is|are|would|should|can)\b/.test(p) && !/\b(wrong|broken|overlap|still|issue|problem)\b/.test(p)) return false;
  if (/^(what is|what does|how does|how do|explain|tell me about|describe)\b/.test(p) && !/\b(wrong|broken|overlap|still|issue|problem)\b/.test(p)) return false;

  const hasTopic = UI_TOPIC_RE.test(p);
  const hasChange = UI_CHANGE_RE.test(p);
  const hasProblem = UI_PROBLEM_RE.test(p);
  const hasDeictic = UI_DEICTIC_RE.test(p);

  // Direct UI topic + change or problem signal → operational.
  if (hasTopic && (hasChange || hasProblem)) return true;
  // Bare UI topic with an explicit problem ("The layout is broken.").
  if (hasTopic && hasProblem) return true;
  // Explicit "investigate <this/that/it>" — an operational command even
  // without a UI topic; the plan inspects AgenticOS frontend/runtime state.
  if (/^(investigate|check|inspect|look into|look at)\b/.test(p) && hasDeictic) return true;
  // Deictic UI reference — needs recent AgenticOS UI context to disambiguate.
  if (hasDeictic && (hasChange || hasProblem) && recentText) {
    return UI_TOPIC_RE.test(recentText) || /(ui|interface|layout|panel|transcript|composer|orb|workspace|overlap)/i.test(recentText);
  }
  // "Can you change that?" — a change request about a deictic referent.
  // With no UI context it is genuinely ambiguous (may clarify); with UI
  // context it is operational (handled above).
  return false;
}

/**
 * Contextual continuation / follow-up resolution (§4 follow-up understanding,
 * §5 clarification policy).
 *
 * Short follow-ups ("Continue.", "Fix it.", "Can you change that?", "yes",
 * "try again", "still doesn't work") are NOT ambiguous when recent turns
 * establish a single reasonable referent. This resolver returns a route
 * suggestion when recent context resolves the deictic/continuation reference:
 *
 *  - `{ resolved: 'continue_goal' }`  → continue the most recent operational
 *    goal/task (investigate or delegate), never generic chat.
 *  - `{ resolved: 'retry_goal' }`     → retry the last failed/completed
 *    operational action.
 *  - `{ resolved: 'investigate_ui' }` → the referent (that/it/this) points at
 *    a UI/interface/layout problem from a prior turn.
 *  - `{ resolved: 'direct_confirm' }` → affirmative/repetition follow-up with
 *    a single conversational referent — direct chat with the subject retained.
 *  - `{ resolved: 'unresolved' }`     → genuinely ambiguous; clarification is
 *    legitimate (e.g. destructive "Delete it." with two plausible objects).
 */
const CONTINUATION_RE = /^(continue|go on|keep going|proceed|do it|do that|fix it|try again|retry|run it again|check it|yes|yeah|yep|sure|ok|okay|no, the previous one|the other one|the one on the right|i mean .+|what about the other one|why[?!.]*$|still doesn'?t work|that'?s not what i asked)/i;

const CORRECTION_RE = /^(no|not that|wait|sorry|i mean|actually|rather|no, i mean)[,.!]?\s+(the |that |it'?s |this )?/i;

export interface ContinuationResolution {
  resolved: 'continue_goal' | 'retry_goal' | 'investigate_ui' | 'direct_confirm' | 'unresolved';
  referent?: string;
}

export function resolveContinuationIntent(prompt: string, recentText?: string): ContinuationResolution {
  const p = prompt.toLowerCase().replace(/\s+/g, ' ').trim();
  const recent = (recentText || '').toLowerCase();

  // Correction phrases ("No, I mean the repository bar.", "Not that — the
  // other one.", "No, the previous one.") redirect the SUBJECT but stay
  // operational when the new subject is a UI/app element. Checked BEFORE the
  // continuation gate — a correction is its own class of follow-up and does
  // not need to match the continue/yes/why vocabulary.
  if (CORRECTION_RE.test(p)) {
    const corrected = p.replace(CORRECTION_RE, '').trim();
    if (/(ui|interface|layout|panel|transcript|composer|orb|workspace|controls|section|sidebar|bar|overlap|spacing)/i.test(corrected)) {
      return { resolved: 'investigate_ui', referent: `corrected target: ${corrected}` };
    }
    if (recent.length > 0) return { resolved: 'direct_confirm', referent: `corrected target: ${corrected}` };
    return { resolved: 'unresolved' };
  }

  // Only short, continuation-shaped prompts are candidates.
  const isContinuation = CONTINUATION_RE.test(p) || /^(can|could) you (change|fix|adjust|move) that\b/i.test(p);
  if (!isContinuation) return { resolved: 'unresolved' };

  // Any prior turn mentioning UI/interface/layout problems → deictic "that"
  // resolves to the UI problem (Case A: "Can you change that?" after
  // "The chat interface is still wrong.").
  // Jarvis repair: a prior UI problem requires a REAL UI-surface complaint —
  // "the chat interface is still wrong", "the panel overlaps", "the composer
  // is broken". Normal conversational talk ("we're not working on any
  // engineering task", "UI changes/code fixes", "if you have a task in mind —
  // bug, feature, investigation") must NOT trip this. Generic "ui" (matches
  // "UI changes" capability talk), the repo-root "workspace", and action
  // verbs ("change"/"fix") are excluded; "not working" is excluded because it
  // matches "we're not working on X". Requires a UI-surface component word.
  const uiProblemInContext = /(chat interface|interface|layout|panel|transcript|composer|orb|overlap|controls|spacing|section|sidebar)/i.test(recent) &&
    /(wrong|broken|still (shows|says|looks)|issue|problem|overlap|misaligned|glitch|bug)/i.test(recent);
  const investigateInContext = /(investigate|inspection|inspecting|i inspected|problem report|runtime state|frontend state)/i.test(recent);
  // Jarvis repair: delegation context requires an ACTUAL delegation/start
  // action, not mere mention of the words "task"/"codex"/"hermes"/"delegation"
  // (those appear in ordinary conversation and capability talk — e.g. "I can
  // delegate engineering work through CodeX"). Without an explicit "I started /
  // delegated this / queued it / sent it to / working on it in the background"
  // phrase, a short follow-up like "Why?" stays conversational.
  const delegatedInContext =
    /(i (have )?started|i started (a |the )?task|delegated (it|this|that|the)|delegated a|queued (a |the )?task|sent (it|this|that) to|gave (it|this|that) to|working on it (in the background|now)|codex (is|was) (working|building|fixing|investigating|inspecting)|hermes (is|was) (working|running|processing))/i.test(recent);

  // "fix it", "do that", "can you change that?" with a UI problem referent.
  if (uiProblemInContext) return { resolved: 'investigate_ui', referent: 'prior UI problem' };

  // "continue" after an investigation/inspection turn.
  if (investigateInContext) return { resolved: 'continue_goal', referent: 'prior investigation' };

  // "continue"/"do it" after a delegation — continue the goal/task.
  if (delegatedInContext) return { resolved: 'continue_goal', referent: 'prior delegated task' };

  // "try again"/"retry" after a failure mention.
  // Jarvis repair: failure language anywhere in the 8-message window is too
  // loose — an informational answer ("there are 10 failed tasks in the
  // backlog", "we're not working on X") is normal talk, not a retry referent.
  // Only the MOST RECENT assistant message is the direct referent of a bare
  // "Why?"/"try again": if IT contains unambiguous failure language, retry is
  // the right continuation; otherwise the follow-up stays conversational.
  const lastAssistant = recent.split('\n').reverse().find((l) => /^agent:/.test(l)) || '';
  if (/(failed|failure|error|broken|timed out|didn'?t work|doesn'?t work|crashed|threw (an |a )?error)/i.test(lastAssistant)) {
    return { resolved: 'retry_goal', referent: 'prior failed action' };
  }

  // Affirmative follow-ups with ANY recent conversational referent → direct,
  // retaining the subject.
  if (/^(yes|yeah|yep|sure|ok|okay)\b/i.test(p) && recent.length > 0) {
    return { resolved: 'direct_confirm', referent: 'prior conversation subject' };
  }

  // "why?" / "what happened?" after a previous Jarvis statement.
  // Jarvis repair: a bare "why"/"what happened" opener is conversational —
  // it asks for explanation of the prior reply. It must only continue an
  // OPERATIONAL goal when the IMMEDIATELY PRECEDING assistant message is
  // itself a live problem report, investigation, or failed action. Historical
  // mentions anywhere in the window ("there are 10 failed tasks in the
  // backlog") are informational, not a retry/investigation referent.
  if (/^(why|what happened|what did you find)\b/i.test(p) && recent.length > 0) {
    const lastAssistant = recent.split('\n').reverse().find((l) => /^agent:/.test(l)) || '';
    const operationalContext =
      /(investigate|inspection|inspecting|i inspected|problem report|runtime state|frontend state)/i.test(lastAssistant) ||
      /(failed|failure|error|broken|timed out|didn'?t work|doesn'?t work|still (broken|failing|wrong)|crashed|threw (an |a )?error)/i.test(lastAssistant);
    if (operationalContext) {
      return { resolved: 'continue_goal', referent: 'prior statement' };
    }
    return { resolved: 'unresolved' };
  }

  return { resolved: 'unresolved' };
}

/**
 * §15 Case F: destructive/irreversible requests are the LEGITIMATE exception
 * to \"clarification is last resort\". When the object is a bare deictic
 * (\"Delete it.\", \"Remove that.\") and recent context contains MULTIPLE
 * plausible objects, asking is correct. When exactly one referent is clear,
 * resolve it instead.
 */
export function isDestructiveAmbiguous(prompt: string, recentText?: string): boolean {
  const p = prompt.toLowerCase().replace(/\s+/g, ' ').trim();
  if (!/(delete|remove|drop|erase|kill|terminate|overwrite)\b/.test(p)) return false;
  if (!/\b(it|this|that|these|those)\b/.test(p)) return false;
  const recent = (recentText || '').toLowerCase();
  // Count DISTINCT referent phrases. Adjacent keywords describing ONE object
  // ("log entry", "transcript panel") must not inflate the count — group them
  // by capturing the head noun of each contiguous referent mention.
  const refGroups: string[] = [];
  const refRe = /\b(?:the |that |this |a )?((?:[a-z0-9_/.-]+ ){0,3}(?:panel|transcript|composer|orb|file|task|run|card|board|section|workspace|repository|history|log|entry|row))\b/gi;
  let m: RegExpExecArray | null;
  while ((m = refRe.exec(recent)) !== null) {
    const phrase = m[1].trim();
    // Collapse to the LAST content noun so "stale log entry" → "entry".
    const words = phrase.split(/\s+/);
    const head = words[words.length - 1];
    if (head && !refGroups.includes(head)) refGroups.push(head);
    // Prevent infinite loop on zero-width matches.
    if (m.index === refRe.lastIndex) refRe.lastIndex++;
  }
  return refGroups.length >= 2;
}

/**
 * Context-aware investigation signals — vague statements that only read as
 * problem reports when recent conversation establishes AgenticOS-state talk
 * ("That value shouldn't be there anymore.", "Why is Laguna still there?",
 * "It changed back."). Requires `recentText` (recent Jarvis turns) to contain
 * a known AgenticOS entity / operation — never globally classifies vague
 * negatives.
 */
const CONTEXTUAL_SIGNAL_PATTERNS: RegExp[] = [
  new RegExp(`\\b(shouldn${APOSTROPHE}?t|should not)\\s+be\\s+(there|here|shown|displayed|visible)\\b`),
  new RegExp(`\\b(isn${APOSTROPHE}?t|is not|ain${APOSTROPHE}?t)\\s+what\\s+(we|i|you|it)\\s+(configured|selected|set|chose|picked|asked)\\b`),
  /\b(not|no longer)\s+what\s+(we|i|you)\s+(configured|selected|set|chose|picked|asked)\b/,
  /\bchanged\s+back\b/,
  /\bstill\s+(there|here|shown|displayed)\b/,
  /\b(the old one|it|that)\s+is\s+(there|back)\s+again\b/,
  new RegExp(`\\b(that${APOSTROPHE}?s|thats|this is)\\s+not\\s+what\\b`),
  /\b(why\s+the\s+hell|how\s+the\s+hell|what\s+the\s+hell|the\s+hell|why|how come)\s+(is|does|did)\s+([a-z0-9][a-z0-9 -]{0,30})\s+still\b/,
];

/** Known AgenticOS entities/state tokens used to establish app context. */
const APP_ENTITY_RE =
  /\b(model|provider|gateway|badge|runtime|agent|task|board|card|stream|operation|status|assignment|selection|config|setting|option|button|panel|orb|voice|mic|tts|stt|hermes|codex|jarvis|qwen|deepseek|laguna|openrouter|ollama|llama|poolside)\b/i;

export function isContextualInvestigationRequest(prompt: string, recentText?: string): boolean {
  const p = prompt.toLowerCase().replace(/\s+/g, ' ').trim();
  if (/\b(speak|sprich|vorbește|deutsch|română|romanian|german|english|hallo|salut|bună|hello|hi|hey)\b/i.test(p)) {
    return false;
  }
  if (!CONTEXTUAL_SIGNAL_PATTERNS.some((re) => re.test(p))) return false;
  if (!recentText) return false;
  const cleanRecent = recentText
    .replace(/Runtime diagnostics for.*$/s, '')
    .replace(/•.*$/gm, '')
    .replace(/I checked the live AgenticOS state.*$/gm, '')
    .trim();
  if (!cleanRecent) return false;
  return APP_ENTITY_RE.test(p) || APP_ENTITY_RE.test(cleanRecent);
}


/**
 * Live AgenticOS system/runtime/UI state inspection.
 *
 * Explicit inspection verbs targeting CURRENT runtime/system/UI state route to
 * INVESTIGATE (Jarvis reads backend runtime + frontend diagnostic state) —
 * they are NOT generic conversation and NOT repository analysis.
 *
 * Guards:
 *  - "How does X work?" explanations stay direct (informational).
 *  - Strong code signals (source/code/repository/paths/components) block this
 *    and let the CODE analysis rules take over.
 *  - The phrase "read-only" alone never implies repository analysis here.
 */
const LIVE_STATE_TARGET_RE =
  /\b(model|models|provider|providers|gateway|gateways|hermes|codex|jarvis|agenticos|agentic os|agentico os|revenue operator|operator|ollama|openrouter|runtime|runtimes|ui|frontend|backend|stream|streams|task|tasks|operation|operations|error|errors|failure|failures|health|status|state|config|configuration|badge|assignment|selection|agent|agents|registry|mismatch|agree|active model|selected model|displayed model|voice|logs|log|file|files|workspace|crash|crashing|500|broken)\b/i;
const LIVE_STATE_VERB_RE =
  /\b(check|inspect|verify|investigate|diagnose|compare|monitor|probe|find out|tell me whether|tell me if|see if|look at|why is|what is|how is)\b/i;
const LIVE_STATE_PREDICATE_RE =
  /\b(is|are|does|do|what is|what are)\s+[a-z0-9 ,&/.-]{0,60}\b(online|working|up|running|active|down|offline|responding|reachable|stuck|broken|doing|executing|working on)\b/i;
const CODE_SIGNAL_RE =
  /\b(source|code|codebase|repository|repo|component|function|class|module|implementation|workspace)\b|\.(tsx?|jsx?|json|md|css)\b/i;

export function isLiveSystemInvestigationRequest(prompt: string): boolean {
  const p = prompt.toLowerCase().replace(/\s+/g, ' ').trim();
  // Informational "how does X work" explanations stay direct.
  if (/^how\s+(does|do|is|are|can|would|should|come)\b/.test(p)) return false;
  // General explanation/role questions stay direct ("What is CodeX for?", "What does Hermes do?").
// "What is X working on?" and "How is X doing?" are worker_STATUS questions —
// exempting them sends them to the conversational worker-status handler, not
// the runtime-investigation path. "What is X doing?" (present-progressive
// state) is intentionally NOT exempt: it must reach the investigation branch.
  if (/\bwhat is \w+ for\b/i.test(p) || /\bwhat is the purpose of\b/i.test(p) || /\bexplain what \w+ does\b/i.test(p) || /\bwhat does \w+ do\b/i.test(p) || /\bwhat does \w+ mean\b/i.test(p) || /\bwhat is \w+ working on\b/i.test(p) || /\bhow is \w+ doing\b/i.test(p)) return false;
  // Bare informational "What is <concept>?" stays direct (no live-state
  // predicate present). Anchored so "What is CodeX doing?" still falls through
  // to the predicate-based investigation branch below.
  if (/^what is(?: the)? (?:a |an )?(openrouter|provider|gateway|model|llm|runtime|capability|agent|hermes|codex|argus|jarvis|ollama|deepseek|qwen|revenue operator|operator)[?]?$/i.test(p)) return false;
  // Project/milestone/goal/plan tracking belongs to Hermes orchestration,
  // not live runtime investigation.
  if (/\b(project|milestone|goal|plan|sprint|roadmap)\b/.test(p)) return false;
  // Conversational model questions ("What model are you using?", "Which model are you running?", "What provider is this?") are direct conversation
  if (/\b(?:what|which)\s+(?:model|provider|llm|engine|architecture)\s+(?:and\s+(?:model|provider)\s+)?(?:are|am|is|do)\s+(?:you|i|we|it)\s+(?:actually\s+|currently\s+)?(?:using|running|on|configured with|have)\b/i.test(p) || /\b(?:what|which)\s+model\s+are\s+you\s+(?:using|running)\b/i.test(p)) return false;
  if (/\b(?:who\s+are\s+you|what\s+are\s+you|how\s+are\s+you|what\s+is\s+\d+\s*[\+\-\*\/]|what's\s+\d+\s*[\+\-\*\/])\b/i.test(p)) return false;
  // Explicit operational actions (application open, screenshot, memory save) must never be hijacked into live system investigation
  if (/\b(?:open|launch|save|screenshot|snapshot|screen\s+capture|comet|telegram|memory)\b/i.test(p)) return false;
  const hasLiveVerb = LIVE_STATE_VERB_RE.test(p) || /^(check|inspect|verify|investigate|diagnose|trace|probe|why is)\b/.test(p) || /\b(health|status)\b/.test(p) || LIVE_STATE_PREDICATE_RE.test(p);
  if (!hasLiveVerb) return false;
  if (!LIVE_STATE_TARGET_RE.test(p)) return false;
  if (CODE_SIGNAL_RE.test(p)) return false;
  return true;
}

export class IntentRouter {
  /**
   * Fast, heuristic-based intent routing.
   * Promoted to an independent service layer for future ML replacement.
   */
  async routeIntent(prompt: string, context?: { recentText?: string; confidence?: number; sourceLabel?: string }): Promise<IntentResult> {
    const delegationSignals = detectDelegationSignals(prompt);
    const p = prompt.toLowerCase().replace(/\s+/g, ' ').trim();
    const hasAny = (...terms: string[]) => terms.some(term => p.includes(term));
    const hasFileTarget = hasAny('.ts', '.tsx', '.js', '.json', '.md', 'file', 'component', 'router', 'implementation', 'workspace', 'repository', 'repo', 'source', 'code', 'codebase', 'branch', 'commit');

    if (delegationSignals.prohibitedWorkers.includes('codex') && hasFileTarget) {
      return {
        route: 'direct',
        semanticIntent: 'repository_analysis',
        executionMode: 'direct_conversation',
        selectedCapability: 'none',
        category: 'repository_analysis',
        mode: 'direct_conversation',
        confidence: 0.99,
        reason: 'Explicit non-delegation instruction requires Jarvis direct handling',
        selectedAgent: 'Jarvis',
        requiresWorkspace: false,
        requiresApproval: false
      };
    }

    const result = await this._routeIntent(prompt, context);
    if (
      result.route !== 'direct' &&
      ((delegationSignals.globalNonDelegationRequested && !delegationSignals.explicitWorkerRequested) ||
       delegationSignals.prohibitedWorkers.includes(result.route as any))
    ) {
      return {
        ...result,
        route: 'direct',
        mode: 'direct_conversation',
        confidence: 0.99,
        reason: 'Explicit non-delegation instruction requires Jarvis direct handling',
        selectedAgent: 'Jarvis',
        requiresWorkspace: false,
        requiresApproval: false,
        plan: undefined
      };
    }
    return result;
  }

  async _routeIntent(prompt: string, context?: { recentText?: string; confidence?: number; sourceLabel?: string }): Promise<IntentResult> {
    const p = prompt.toLowerCase().replace(/\s+/g, ' ').trim();
    const words = p.split(' ').filter(Boolean);
    const recentText = context?.recentText;

    const { classifyInputAuthority } = await import('./conversationalAuthority.js');
    const auth = classifyInputAuthority(prompt, {
      confidence: context?.confidence,
      sourceHeader: context?.sourceLabel,
    });

    const clarify = (reason: string, voiceIssue?: string): IntentResult => ({
      route: 'clarification_required',
      semanticIntent: 'conversation',
      executionMode: 'direct_conversation',
      selectedCapability: 'none',
      category: 'conversation',
      mode: 'direct_conversation',
      confidence: typeof context?.confidence === 'number' ? context.confidence : 0.35,

      reason,
      voiceIssue,
      requiresWorkspace: false,
      requiresApproval: false,
      selectedAgent: 'Jarvis',
    });

    if (auth.rejectionDetected) {
      return clarify(auth.reason, auth.clarificationPrompt);
    }

    if (!auth.isOperationalAuthorized && auth.clarificationPrompt) {
      return clarify(auth.reason, auth.clarificationPrompt);
    }

    const direct = (category: IntentResult['category'], confidence: number, reason: string, plan?: string[]): IntentResult => ({
      route: 'direct',
      semanticIntent: category,
      executionMode: 'direct_conversation',
      selectedCapability: 'none',
      category,
      mode: 'direct_conversation',
      confidence,
      reason,
      requiresWorkspace: false,
      requiresApproval: false,
      selectedAgent: 'Jarvis',
      plan
    });

    if (auth.source === 'SYSTEM_EVENT' || auth.source === 'AGENT_EVENT') {
      return direct('system_status', 1.0, auth.reason);
    }

    const operational = (
      route: IntentResult['route'],
      category: IntentResult['category'],
      confidence: number,
      reason: string,
      selectedAgent: IntentResult['selectedAgent'],
      plan: string[],
      requiresWorkspace = true,
      requiresApproval = false,
      selectedCapability?: IntentResult['selectedCapability']
    ): IntentResult => {
      const cap: IntentResult['selectedCapability'] = selectedCapability || (route === 'magnitude' ? 'magnitude' : route === 'hermes' ? 'hermes' : route === 'codex' ? 'codex' : route === 'agent_teams' ? 'agent_teams' : 'none');
      return {
        route,
        semanticIntent: category,
        executionMode: 'operational_execution',
        selectedCapability: cap,
        category,
        mode: 'operational_execution',
        confidence,
        reason,
        requiresWorkspace,
        requiresApproval,
        selectedAgent,
        plan
      };
    };

    const investigate = (confidence: number, reason: string, plan: string[]): IntentResult => ({
      route: 'investigate',
      semanticIntent: 'investigation',
      executionMode: 'operational_execution',
      selectedCapability: 'none',
      category: 'investigation',
      mode: 'operational_execution',
      confidence,
      reason,
      requiresWorkspace: false,
      requiresApproval: false,
      selectedAgent: 'Jarvis',
      plan,
    });

    const hasAny = (...terms: string[]) => terms.some(term => p.includes(term));
    const hasWord = (...terms: string[]) => terms.some(term => new RegExp(`\\b${term}\\b`).test(p));
    const delegationSignals = detectDelegationSignals(prompt);
    const hasFileTarget = hasAny('.ts', '.tsx', '.js', '.json', '.md', 'file', 'component', 'router', 'implementation', 'workspace', 'repository', 'repo', 'source', 'code', 'codebase');
    const cleanedForReadOnly = p
      .replace(/\b(?:without changing|without modifying|do not change|do not modify)\s+(?:the\s+)?(?:expected\s+)?(?:behavior\s+of\s+the\s+)?tests?\b[^.?!]*/gi, '');
    const hasReadOnlyConstraint = (
      /\b(?:do not|don't|no|without|never)\s+(?:modify|write|edit|change|touch|patch|update)\s+(?:any\s+)?(?:code|codebase|files?|implementation|anything)?\b/i.test(p) ||
      /\b(?:without\s+(?:modifying|writing|editing|changing|touching)\s+(?:anything|any\s+(?:code|codebase|files?|implementation))?)\b/i.test(p) ||
      /\b(?:no\s+(?:code\s+changes?|file\s+changes?|changes?))\b/i.test(p) ||
      /\b(?:analysis\s+only|read\s*-?\s*only|inspection\s+only)\b/i.test(p)
    ) && !/\b(?:repair|fix|patch|update|modify|refactor)\b/.test(cleanedForReadOnly);

    const cleanedForWriteVerbs = p
      .replace(/\b(?:do not|don't|without|no|never)\s+(?:modify|change|edit|touch|write|patch|update|refactor|delete|remove|create|add|implement)\s+(?:any\s+)?(?:other\s+)?(?:code|codebase|files?|implementation|anything)?\b/gi, '')
      .replace(/\b(?:without\s+(?:modifying|changing|editing|touching|writing|patching|updating|deleting|removing|creating|adding|implementing)\s+(?:any\s+)?(?:code|codebase|files?|implementation|anything)?)\b/gi, '')
      .replace(/\b(?:no\s+(?:code\s+changes?|file\s+changes?|changes?))\b/gi, '')
      .replace(/\b(?:analysis\s+only|read\s*-?\s*only|inspection\s+only)\b/gi, '');

    const hasAnyIn = (text: string, ...terms: string[]) => terms.some(term => text.includes(term));
    const hasWordIn = (text: string, ...terms: string[]) => terms.some(term => new RegExp(`\\b${term}\\b`).test(text));

    const hasWriteVerb = hasAnyIn(cleanedForWriteVerbs, 'fix', 'change', 'modify', 'update', 'patch', 'refactor', 'delete', 'remove', 'write', 'create', 'repair', 'correct') || hasWordIn(cleanedForWriteVerbs, 'add', 'implement');
    const effectiveHasWriteVerb = hasWriteVerb && !hasReadOnlyConstraint;
    const hasReadVerb = hasAny('inspect', 'find', 'trace', 'read', 'search in', 'look through', 'why', 'analyze', 'analyse', 'review', 'list', 'rank');
    const isReadOnlyRepositoryRequest = hasReadOnlyConstraint || (hasReadVerb && !effectiveHasWriteVerb);

    // ── 0. EXPLICIT WORKER & DELEGATION PRECEDENCE ──

    // 00. Explicit Language Preference / Switch Command
    const { detectLanguageSwitchRequest } = await import('./conversationLanguage.js');
    const langSwitch = detectLanguageSwitchRequest(prompt);
    if (langSwitch.isLanguageSwitch) {
      return direct('conversation', 0.99, `Language preference instruction: ${langSwitch.targetLanguage}`);
    }

    // 0A. Global non-delegation ("answer directly", "do not delegate")

    if (delegationSignals.globalNonDelegationRequested && !delegationSignals.explicitWorkerRequested) {
      return direct(
        hasFileTarget || hasAny('branch', 'commit', 'repository', 'repo')
          ? 'repository_analysis'
          : 'conversation',
        0.99,
        'Explicit direct handling requested'
      );
    }

    // 0B. Explicit Hermes delegation ("use hermes...", "ask hermes...")
    if (delegationSignals.explicitWorkerRequested === 'hermes' && !delegationSignals.prohibitedWorkers.includes('hermes')) {
      const isPlanning = /\b(plan|planning|affiliate|roadmap|decompose|strategy)\b/i.test(p);
      const hermesHasCodeXWrite = !isReadOnlyRepositoryRequest && (p.includes('codex') || effectiveHasWriteVerb);
      return operational(
        'hermes',
        isPlanning ? 'project_planning' : 'research',
        0.98,
        'Explicit Hermes delegation requested',
        'Hermes',
        ['Initialize canonical Hermes task', 'Execute research / planning loop', 'Deliver verified evidence to Jarvis'],
        true,
        false,
        'hermes'
      );
    }

    // 0C. Explicit Magnitude delegation ("use magnitude...", "ask magnitude...")
    if (delegationSignals.explicitWorkerRequested === 'magnitude' && !delegationSignals.prohibitedWorkers.includes('magnitude')) {
      return operational(
        'magnitude',
        'browser_automation',
        0.98,
        'Explicit Magnitude browser inspection requested',
        'Jarvis',
        ['Validate target URL', 'Launch headless Chromium browser', 'Navigate and extract page content', 'Deliver structured result to Jarvis'],
        false,
        false,
        'magnitude'
      );
    }

    // 0D. Explicit CodeX delegation ("use codex...", "ask codex...")
    if (delegationSignals.explicitWorkerRequested === 'codex' && !delegationSignals.prohibitedWorkers.includes('codex')) {
      return operational(
        'codex',
        isReadOnlyRepositoryRequest ? 'repository_analysis' : 'repository_change',
        0.98,
        'Explicit CodeX delegation requested',
        'CodeX',
        ['Confirm selected repository', 'Prepare CodeX goal', 'Execute and report findings'],
        true,
        !isReadOnlyRepositoryRequest,
        'codex'
      );
    }

    // 0E. Explicit Agent Teams delegation ("use teams...", "delegate to agent teams...")
    if (delegationSignals.explicitWorkerRequested === 'agent_teams' && !delegationSignals.prohibitedWorkers.includes('agent_teams')) {
      return operational(
        'agent_teams',
        'agent_team_execution',
        0.98,
        'Explicit Agent Teams delegation requested',
        'Agent Teams',
        ['Design Team Sheet', 'Create role-specific plan', 'Request approval before execution'],
        true,
        true,
        'agent_teams'
      );
    }

    // 0F. Explicit AntiGravity delegation ("delegate to antigravity...", "give this task to antigravity...")
    if (delegationSignals.explicitWorkerRequested === 'antigravity' && !delegationSignals.prohibitedWorkers.includes('antigravity')) {
      return operational(
        'antigravity',
        'repository_analysis',
        0.99,
        'Explicit AntiGravity delegation requested',
        'AntiGravity',
        ['Discover local AntiGravity session', 'Initiate handoff of repository task', 'Stream execution events to engineering console'],
        true,
        false,
        'antigravity'
      );
    }

    // ── CLOSED-WORLD LOCAL AGENTICOS BOUNDARY ──
    const isExplicitWebSearch = /\b(?:search (?:the )?(?:web|internet|online|google|bing)|look up online|search online|browse the web|google (?:for )?)\b/i.test(p);
    const mentionsLocalEntities = /\b(agenticos|agentic os|agentico os|jarvis|codex|hermes|revenue operator|operator|local agents?|providers?|models?|builds?|repository|repo|tasks?|queues?|approvals?|workers?|local status)\b/i.test(p);

    // ── HERMES RESEARCH & PROJECT PLANNING CHECK (Pattern-based) ──
    // Public web search and generic external research are NEVER triggered for local entities unless explicitly requested.
    const isHermesResearchOrPlan = !mentionsLocalEntities &&
      /\b(research (this|the|a|these|our)?|analy[sz]e (the|these|our)? competitors|analy[sz]e (the|this|these)? market|competitor analysis|market analysis|investigate what .* is for|research-backed plan|plan for (an?|this|the)|project plan|affiliate-commerce|turn this objective into a structured (execution )?plan|compare (these|the)? business opportunities|lead research|recruiting research|campaign planning)\b/i.test(p);

    if (isHermesResearchOrPlan && !delegationSignals.prohibitedWorkers.includes('hermes') && (!hasFileTarget || isReadOnlyRepositoryRequest)) {
      const isPlanning = /\b(plan|planning|affiliate|roadmap|decompose|strategy)\b/i.test(p);
      return operational(
        'hermes',
        isPlanning ? 'project_planning' : 'research',
        0.95,
        'Research and project planning request routed to Hermes',
        'Hermes',
        ['Initialize canonical Hermes task', 'Execute research / planning loop', 'Deliver verified evidence to Jarvis'],
        false,
        false,
        'hermes'
      );
    }

    // ── MAGNITUDE BROWSER & WEB INSPECTION CHECK (Pattern-based) ──
    const hasUrl = /https?:\/\/[^\s"'<>]+/i.test(prompt);
    // A7/M9: accept bare domains ("inspect example.com and tell me the title")
    // as browser targets even without an explicit scheme.
    const hasBareDomain = !hasUrl && /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|org|net|io|dev|ai|gov|edu|co|uk|app|me|info|xyz|site)\b/i.test(prompt);
    const mentionsMagnitude = /\bmagnitude\b/i.test(p);
    const isBrowserInspect = /\b(open|browse|navigate|visit|inspect|scrape|read|check|view|fetch|tell me what is on|what is on)\b/i.test(p) &&
      (/\b(page|site|website|webpage|web page|url|dom|web)\b/i.test(p) || hasUrl || hasBareDomain);

    // ── MAGNITUDE BROWSER & WEB INSPECTION CHECK ──
    // Autonomous routing to Magnitude is disabled per architectural directive until audit.
    // Magnitude may ONLY be selected if the user explicitly requests magnitude by name.
    if (!delegationSignals.prohibitedWorkers.includes('magnitude') && mentionsMagnitude) {
      return operational(
        'magnitude',
        'browser_automation',
        0.96,
        'Browser automation request explicitly routed to Magnitude',
        'Jarvis',
        ['Validate target URL', 'Launch headless Chromium browser', 'Navigate and extract page content', 'Deliver structured result to Jarvis'],
        false,
        false,
        'magnitude'
      );
    }

    // 1. Memory checks — only genuine memory QUERIES route to memory.
    // A bare "remember" in an ordinary statement ("Please remember that…",
    // "I remember when…") is NOT a memory operation: it is conversational
    // context that the direct-chat LLM now receives via history. Routing it
    // to memory tooling produced stale "From what I remember" dumps for
    // completely unrelated user statements (live runtime investigation).
    // Bare "what happened?" (no subject) is a conversational follow-up — the
    // continuation resolver routes it against recent context; only subject-
    // bearing recall ("what happened in our last search") is a memory query.
    const isPriorTurnRecall = /^(what did (?:i|you) (?:just |recently )?(?:say|ask|tell)(?: to you| me)?(?:[?!.]*)$|what was (?:my|your) (?:last|previous) (?:message|question|prompt)|what did i ask you)/i.test(p.trim());
    const isMemoryQuery = !isPriorTurnRecall && (
      p.includes('my preferences')
      || /\b(what (do|does) (you|we) remember|do you remember|do we remember|what did (?:i|we) (?:say|do|decide|find|learn) about|whats? our (?:last|most recent))\b/i.test(p)
      || (/\bwhat happened\b/i.test(p) && !/^what happened[?!.]*$/i.test(p.trim()))
    );


    if (isMemoryQuery) {
      return operational('memory', 'file_operation', 0.9, 'Explicit memory operation detected', 'Jarvis', ['Validate memory service availability', 'Route the request to memory tooling'], false, hasWriteVerb);
    }

    if (hasAny('what can you do', 'capabilities', 'available right now', 'which runtimes are online', 'what is currently running', 'system status')) {
      return direct('system_status', 0.92, 'Live Agentic OS capability/status request', ['Read registered agents', 'Read registered runtimes', 'Summarize available tools']);
    }

    if (hasAny('latest documentation', 'search the latest', 'research ', 'look up documentation', 'find current docs', 'search the web', 'search the internet', 'search online', 'look up online')) {
      if (!delegationSignals.prohibitedWorkers.includes('hermes')) {
        return operational(
          'hermes',
          'research',
          0.92,
          'Research request routed to canonical Hermes worker',
          'Hermes',
          ['Initialize canonical Hermes task', 'Execute research loop', 'Deliver verified evidence to Jarvis'],
          false,
          false,
          'hermes'
        );
      }
      return direct('research', 0.82, 'Research request that can be answered through Jarvis without workspace execution', ['Identify research target', 'Use available research/search capability if configured', 'Summarize findings with source constraints']);
    }

    // 2. Agent Teams checks (team, agents, multi-agent)
    const hasAgentKeyword = p.includes('team') || p.includes('agents') || p.includes('multi-agent') || p.includes('agent team');
    const hasExecutionVerb = p.includes('build') || p.includes('create') || p.includes('implement') || p.includes('investigate') || p.includes('execute') || p.includes('analyze') || p.includes('assemble') || p.includes('verify');
    const isConversational = p.includes('what is') || p.includes('explain') || p.includes('who') || p.includes('which') || p.includes('write a message to') || p.includes('what are');

    if (!delegationSignals.prohibitedWorkers.includes('agent_teams') && hasAgentKeyword && hasExecutionVerb && !isConversational) {
      return operational('agent_teams', 'agent_team_execution', 0.95, 'Request benefits from explicit multi-agent execution', 'Agent Teams', ['Design Team Sheet', 'Create role-specific plan', 'Request approval before execution'], true, true);
    }

    if (!delegationSignals.prohibitedWorkers.includes('agent_teams') && hasAny('builder and verifier', 'researcher and analyst', 'architect and implementer', 'implementer and reviewer')) {
      return operational('agent_teams', 'agent_team_execution', 0.92, 'Request names multiple execution roles', 'Agent Teams', ['Create role-based team', 'Prepare handoffs', 'Request approval before execution'], true, true);
    }

    if (!delegationSignals.prohibitedWorkers.includes('codex') && hasAny('ask codex', 'have codex', 'delegate to codex')) {
      if (isReadOnlyRepositoryRequest) {
        return operational('codex', 'repository_analysis', 0.96, 'Explicit read-only CodeX delegation request', 'CodeX', ['Package read-only request for CodeX', 'Attach selected repository', 'Create CodeX inspection goal'], true, false);
      }
      return operational('codex', 'codex_delegation', 0.96, 'Explicit CodeX delegation request', 'CodeX', ['Package user request for CodeX', 'Attach selected repository', 'Create CodeX goal'], true, true);
    }

    // ── LIVE AGENTICOS SYSTEM/RUNTIME/UI STATE INSPECTION ──
    // Explicit inspection verbs targeting CURRENT runtime/system/UI state
    // (model/provider/gateway/Hermes/Ollama/OpenRouter/frontend/stream/tasks/
    // errors/health) route to INVESTIGATE — NOT direct chat and NOT CodeX.
    // This runs BEFORE the broad read-only repository-analysis rule so
    // "read-only" alone never implies repository analysis. Explicit CodeX
    // delegation (above) still wins.
    if (isLiveSystemInvestigationRequest(prompt)) {
      return investigate(
        0.9,
        'Live AgenticOS runtime/system/UI state inspection request',
        ['Inspect active runtime/gateway/frontend state', 'Compare selected vs gateway-resolved vs displayed state', 'Report evidence and resolve when safe']
      );
    }

    if (hasAny('run the deployment pipeline', 'start deployment', 'trigger pipeline', 'run pipeline')) {
      return operational('hermes', 'pipeline_operation', 0.9, 'Pipeline operation requires an execution gate', 'Jarvis', ['Inspect pipeline registry', 'Request approval for side effects', 'Start pipeline if approved'], false, true);
    }

    if (hasAny('show pipeline status', 'pipeline status')) {
      return operational('hermes', 'pipeline_operation', 0.86, 'Pipeline status request', 'Jarvis', ['Inspect pipeline registry', 'Report current status'], false, false);
    }

    // ── §15 CASE I: file-problem reports ──
    // "Why does it keep saying file not found?" / "no such file" / "file
    // missing" are PROBLEM reports about workspace/file resolution — route to
    // INVESTIGATE (which now includes file-resolution evidence) BEFORE the
    // generic read-only CodeX analysis rule would swallow them.
    const isFileProblem = /\b(file|not found|no such file|missing file|cannot find|can'?t find)\b/i.test(prompt) &&
      /\b(why|keep|still|error|saying|says|not found|no such|missing|failed|problem)\b/i.test(prompt);
    if (isFileProblem && !hasWriteVerb) {
      return investigate(
        0.82,
        'File-resolution problem report — inspect workspace/file evidence before answering',
        ['Check the canonical workspace root', 'Resolve the referenced file', 'Report what was searched and what exists']
      );
    }

    // ── §15 CASE J: task-state questions ──
    // "Is Hermes finished?", "Is the task done?", "What happened with the
    // run?" are questions about ACTUAL run/task state — route to INVESTIGATE
    // (which reads the background task manager + execution record) so the
    // answer distinguishes ACTIVE vs HISTORICAL. Never a generic direct reply.
    const isTaskStateQuestion = /^(is|are|did|has|was)\s+(hermes|codex|jarvis|the (task|run|job|goal|agent)|it)\s+(finished|done|still running|working|complete|completed|failed|stuck|queued)\b/i.test(prompt) ||
      /^(what happened|what is (the |its )?(status|state) of|is (the )?(task|run|job|goal) (done|finished|still running))\b/i.test(prompt);
    if (isTaskStateQuestion) {
      return investigate(
        0.8,
        'Task/run state question — inspect the actual run state (active vs historical)',
        ['Inspect background task manager state', 'Report active vs historical run truth', 'Explain the most recent result']
      );
    }

    // Questions about findings, reports, problems, or evidence from a prior/completed task:
    const isFindingsOrEvidenceQuery =
      /\b(what did (?:codex|hermes|it) (?:find|report|see|conclude|say)|where did (?:codex|hermes|it) find|why did (?:codex|hermes|it) (?:say|list|claim|name)|explain the (?:first|second|third|fourth|fifth|\d+(?:st|nd|rd|th)?)\s+(?:problem|finding|issue|blocker)|what (?:are|were) the (?:findings|problems|blockers|issues|results)|why did the (?:code|test|run|agent|task|goal|it) fail)\b/i.test(p);
    if (isFindingsOrEvidenceQuery) {
      return direct('conversation', 0.95, 'Inquiry regarding grounded worker findings/evidence');
    }

    if (!delegationSignals.prohibitedWorkers.includes('codex')) {
      if (hasFileTarget && isReadOnlyRepositoryRequest) {
        return operational('codex', 'repository_analysis', 0.9, 'Read-only repository analysis request', 'CodeX', ['Confirm selected repository', 'Inspect relevant files', 'Report findings'], true, false);
      }

      if (hasFileTarget && effectiveHasWriteVerb) {
        const destructive = hasAny('delete', 'remove', 'overwrite');
        return operational(
          'codex',
          destructive ? 'approval_required' : 'repository_change',
          destructive ? 0.96 : 0.93,
          destructive ? 'Destructive repository operation requires approval' : 'Repository change request',
          'CodeX',
          ['Confirm selected repository', 'Prepare implementation plan', 'Request approval before file changes'],
          true,
          true
        );
      }

      // 3. CodeX checks (build, deploy, code, ui, app)
      if (
        p.includes('build a') ||
        p.includes('make a') ||
        p.includes('create a new') ||
        p.includes('deploy') ||
        p.includes('refactor') ||
        p.includes('fix the bug') ||
        (p.includes('code') && p.includes('write'))
      ) {
        return operational('codex', 'repository_change', 0.95, 'Explicit software engineering request', 'CodeX', ['Confirm selected repository', 'Create CodeX goal', 'Request approval before side effects'], true, true);
      }
    }

    // 4. Hermes checks (projects, goals, plans, milestones, tasks, dependencies, execution tracking)
    // Status/state QUESTIONS about projects/tasks ("What project are we
    // working on?", "What is the current project?") are informational — the
    // direct-chat LLM answers them from conversation history + runtime state.
    // Only actionable project commands ("create a plan", "update the
    // milestone", "track execution") route to the Hermes orchestration worker.
    const isProjectStateQuestion =
      /^(what|which|how|who|where|when|is|are|does|do|why)\b/i.test(p.trim()) &&
      /\b(project|goal|milestone|task|plan|status|progress)\b/.test(p);
    if (isProjectStateQuestion) {
      return direct('conversation', 0.62, 'Project/task status question — direct conversation');
    }
    // Only ACTIONABLE project/plan commands route to the Hermes orchestration
    // worker. A bare keyword mention ("My project codename is Atlas.",
    // "What is the goal?") is conversation — the action verb is what makes it
    // an orchestration command ("create a plan", "update the milestone",
    // "track execution").
    const projectActionSignal =
      hasWriteVerb ||
      /\b(track|plan|schedule|assign|start|stop|pause|resume|execute|run|continue|create a plan|update the|show me the|list all|list tasks)\b/i.test(p) ||
      /\b(status of|set up|setup|project status|sprint)\b/i.test(p);

    if (
      projectActionSignal &&
      (p.includes('project') ||
        p.includes('goal') ||
        p.includes('milestone') ||
        p.includes('task') ||
        p.includes('pipeline') ||
        p.includes('dependency') ||
        p.includes('dependencies') ||
        p.includes('track execution') ||
        p.includes('status of the plan'))
    ) {
      return operational('hermes', 'pipeline_operation', 0.90, 'Project/pipeline orchestration command detected', 'Jarvis', ['Check orchestration service availability', 'Route to project execution subsystem'], false, hasWriteVerb);
    }

    // 5. Ambiguous intent handling
    // Short imperative commands are NOT ambiguous — "Jarvis, say hello.",
    // "Show status.", "Repeat that." are complete requests. They go to
    // direct conversation instead of the clarification wall (§11).
    // Checked EARLY: before contextual-investigation signals, so an agent
    // name in the command ("Jarvis, …") cannot trip the entity heuristic.
    const isShortCommand = /\b(say|tell|show|repeat|speak|read|open|run|start|stop|send|play|write|give|describe|summarize|explain)\b/.test(p);
    if (words.length <= 3 && isShortCommand) {
      return direct('conversation', 0.6, 'Short imperative command — direct conversation');
    }

    // Greetings are always direct conversation, never clarification
    const isGreeting = /^(hi|hello|hey|yo|sup|howdy|greetings|good\s+(morning|afternoon|evening))\b/.test(p);
    if (isGreeting) {
      return direct('conversation', 0.6, 'Greeting detected — direct conversation');
    }

    // Bare agent-name invocations ("Jarvis", "Hermes", ...) are direct conversation
    const agentNames = ['jarvis', 'hermes', 'codex', 'athena', 'sentinel', 'qwable', 'qwythos'];
    if (words.length === 1 && agentNames.includes(words[0])) {
      return direct('conversation', 0.6, 'Agent invocation — direct conversation');
    }

    // Direct model identity and conversational / math questions ("what model are you using", "what is 2 plus 2", "who are you")
    const isModelOrDirectQuestion =
      /\b(?:what|which)\s+(?:model|provider|llm|engine|architecture)\s+(?:and\s+(?:model|provider)\s+)?(?:are|am|is|do)\s+(?:you|i|we|it)\s+(?:actually\s+|currently\s+)?(?:using|running|on|configured with|have)\b/i.test(p) ||
      /\b(?:what|which)\s+model\s+are\s+you\s+(?:using|running)\b/i.test(p) ||
      /\b(?:what\s+is|what's|calculate|compute)\s+\d+\s*[\+\-\*\/]/i.test(p) ||
      /\b(?:what\s+is|what's)\s+(?:two|one|three|four|five|six|seven|eight|nine|ten)\s+plus/i.test(p) ||
      /\b(?:who\s+are\s+you|what\s+are\s+you|how\s+are\s+you)\b/i.test(p);
    if (isModelOrDirectQuestion) {
      return direct('conversation', 0.95, 'Direct conversational question');
    }

    // ── §8 (stabilization): complaints ABOUT Jarvis/AgenticOS itself ──
    // MUST run BEFORE the question gate: "Why are you asking me again?" and
    // "What the hell is going on?" are complaints, not informational
    // questions — they route INVESTIGATE (inspect runtime state, report),
    // never clarification, never "I didn't quite understand".
    if (isAssistantComplaint(prompt)) {
      return investigate(
        0.8,
        'Complaint about Jarvis/AgenticOS — inspect runtime state and report',
        ['Inspect active runtime/gateway/frontend state', 'Identify what is failing', 'Report evidence and next step']
      );
    }

    // ── UI/interface/layout CHANGE or PROBLEM requests (operational) ──
    // "Change the chat interface.", "Fix the layout.", "Why does the UI
    // still look wrong?", "The transcript is overlapping the controls."
    // are OPERATIONAL problem reports in AgenticOS — Jarvis inspects
    // runtime/frontend state and can delegate engineering work. They must
    // never fall to generic chat ("I cannot modify the UI") or to the
    // clarification wall. Runs BEFORE the question gate so "Why does the
    // UI still look wrong?" does not become an informational question.
    if (isUIChangeOrProblemRequest(prompt, recentText)) {
      return investigate(
        0.85,
        'UI/interface/layout change or problem request — inspect AgenticOS frontend state and delegate',
        ['Inspect active frontend/runtime state', 'Identify the affected UI component', 'Explain what is wrong', 'Offer or start the engineering task per approval rules']
      );
    }

    // ── §15 Case F: destructive-ambiguous override ──
    // "Delete it." with TWO plausible objects in recent context is the
    // legitimate clarification exception — running BEFORE continuation
    // resolution so an ambiguous destructive deictic is never auto-resolved
    // to the wrong target.
    if (isDestructiveAmbiguous(prompt, recentText)) {
      return clarify(
        'Destructive request with multiple plausible referents — clarification is required before acting'
      );
    }

    // §15 Case F2: destructive deictic with a SINGLE clear referent must NOT
    // be clarified — it routes to the approval-gated change path so the
    // operation can actually proceed under approval rules.
    if (/^(delete|remove|drop|erase|kill|terminate|overwrite)\b/.test(prompt.trim().toLowerCase()) && /\b(it|this|that)\b/i.test(prompt) && recentText) {
      return operational(
        'codex',
        'approval_required',
        0.7,
        'Destructive request with a resolvable referent — proceed under approval',
        'CodeX',
        ['Resolve the deictic referent from recent context', 'Confirm the target', 'Request approval before destructive change'],
        true,
        true,
        'codex'
      );
    }

    // ── §4/§5: contextual continuation resolution ──
    // Short follow-ups ("Continue.", "Fix it.", "Can you change that?",
    // "try again", "yes") are resolved against recent turns BEFORE the
    // question gate and the short-prompt clarification wall. When recent
    // context establishes a single referent, we route operationally
    // (investigate/continue) or direct-with-subject — never a canned
    // "Could you clarify?". Runs after the UI classifier (so "Fix it."
    // with a prior UI problem still goes operational) but before
    // questions/ambiguity handling.
    const continuation = resolveContinuationIntent(prompt, recentText);
    if (continuation.resolved === 'investigate_ui') {
      return investigate(
        0.85,
        `Follow-up resolved to prior UI problem (${continuation.referent}) — inspect AgenticOS frontend state`,
        ['Inspect active frontend/runtime state', 'Identify the affected UI component', 'Explain what is wrong', 'Offer or start the engineering task per approval rules']
      );
    }
    if (continuation.resolved === 'continue_goal' || continuation.resolved === 'retry_goal') {
      return investigate(
        0.8,
        `Follow-up resolved to ${continuation.referent} — continue/retry the prior operational goal`,
        ['Inspect the prior goal/task state', 'Continue or retry the most recent unresolved action', 'Report evidence and resolve when safe']
      );
    }

    // Context-aware investigation: vague statements that read as problem
    // reports ONLY when recent context establishes AgenticOS-state talk
    // ("Why is Laguna still there?", "That value shouldn't be there anymore.").
    // Runs before the question check so problem-questions route to
    // INVESTIGATE while informational questions stay direct.
    if (isContextualInvestigationRequest(prompt, recentText)) {
      return investigate(
        0.8,
        'Contextual AgenticOS problem report (recent conversation context) — implicit investigation request',
        ['Resolve the referent from recent conversation context', 'Inspect active runtime/gateway/frontend state', 'Report evidence and resolve when safe']
      );
    }

    // ── Continuation of an ongoing problem (P7/P8, coherence milestone) ──
    // "So right now…", "it still…", "it's just sitting there", "nothing is
    // happening" — a deictic/summary opener that only makes sense as a
    // continuation. Gated on RECENT CONVERSATION CONTEXT (the prior complaint
    // about a malfunction), never on the prompt alone. Placed BEFORE the
    // question/direct branch so a continuation question like "What the hell is
    // it doing?" does not reset to a generic DIRECT answer.
    const CONTINUATION_CUES =
      /\b(so right now|it still|this is still|still not working|still shows?|what is it doing|what'?s it doing|i still don'?t know|it'?s just sitting there|nothing is happening|it'?s just stuck|what the hell is it doing|what the hell is going on|it won'?t do anything)\b/i;
    if (CONTINUATION_CUES.test(prompt)) {
      const contextSignal =
        recentText &&
        /(wrong|broken|stuck|failed|not working|mismatch|not showing|still|issue|problem|waiting|laguna|model|provider|error)/i.test(recentText);
      // Active execution also establishes continuation: while a task is
      // running or Jarvis is waiting for the user, a deictic opener cannot
      // reset to a generic DIRECT answer (conversation-state milestone).
      let activeExecution = false;
      try {
        const { getCurrent } = await import('../../services/executionState.js');
        activeExecution = Boolean(getCurrent());
      } catch { /* import cycle safety — context text remains the gate */ }
      if (contextSignal || activeExecution) {
        return investigate(
          0.82,
          'Continuation of an ongoing problem report (uses recent conversation context + active execution)',
          ['Inspect active runtime/gateway/frontend state', 'Report evidence and resolve when safe']
        );
      }
    }

    // Questions (wh- words or auxiliary + subject) are direct conversation
    const isQuestion = /^(what|who|how|why|where|when|which)\b/.test(p) ||
      /^(do|does|did|can|could|will|would|is|are|am)\s+(you|i|we|they)\b/.test(p) ||
      p.endsWith('?');
    if (isQuestion) {
      return direct('conversation', 0.55, 'Question detected — direct conversation');
    }

    // ── 6. Implicit BUG_REPORT / INVESTIGATE (contextual operational requests) ──
    // Statements describing a malfunction, inconsistency, unexpected UI state,
    // incorrect value, failed operation, or broken AgenticOS behavior are
    // IMPLICIT operational requests — no imperative verb required. Jarvis is
    // running inside AgenticOS, so "it"/"this"/"that"/"the <subject>" resolve
    // against the application context. The INVESTIGATE path inspects runtime/
    // application state first and only asks the user when state cannot
    // resolve the ambiguity (inspect-before-question).
    if (isBugReportStatement(p)) {
      return investigate(
        0.85,
        'Contextual AgenticOS problem report — implicit investigation request',
        ['Inspect active runtime/gateway state', 'Compare with displayed/expected state', 'Report evidence and resolve when safe']
      );
    }

    // ── Voice-transcription issues (conversation-state milestone) ──
    // When the transcript is obviously corrupted — repeated fragments,
    // abrupt mid-word truncation, impossible letter-run "words" — do NOT
    // reset the conversation and do NOT say "I don't understand". The user
    // is still in the SAME conversation; ask them to repeat the last part.
    const voiceIssue = detectVoiceTranscriptionIssue(prompt);
    if (voiceIssue) {
      return clarify('voice_transcription', voiceIssue);
    }

    // Short or vague prompts that aren't greetings, invocations, questions,
    // or imperative commands need clarification. They must not create a goal
    // or silently default to conversation. §11 budget: only when the previous
    // turn was ALSO a clarification do we ask again — otherwise interpret.
    if (words.length <= 3) {
      const recent = (recentText || '').toLowerCase();
      const previousWasClarification = /(could you|can you).*(rephrase|repeat|clarify)|didn['\u2019]?t quite understand/.test(recent);
      if (!previousWasClarification && recent.length > 0) {
        // There IS conversation context and Jarvis has not already asked —
        // attempt interpretation via direct conversation instead of asking.
        return direct('conversation', 0.45, 'Short prompt with active context — interpret rather than clarify');
      }
      return clarify('Ambiguous short prompt requires clarification');
    }

    // ── 7. Semantic fallback (PRIORITY 8) ──
    // When deterministic signals are exhausted, score the utterance into
    // semantic categories (live state / bug / delegation / repo / info) using
    // the utterance + recent conversation context. High-confidence categories
    // route instead of a blind direct fallback. Dynamic import avoids a
    // module cycle (semanticIntent imports the detectors from this module).
    const { scoreSemanticIntent, semanticRouteToIntent } = await import('./semanticIntent.js');
    const semantic = scoreSemanticIntent(prompt, recentText);
    if (semantic.bestScore >= 0.75) {
      const mapped = semanticRouteToIntent(semantic, prompt);
      if (mapped?.route === 'investigate') {
        return investigate(
          mapped.confidence,
          'Semantic intent: live AgenticOS state / problem report',
          ['Inspect active runtime/gateway/frontend state', 'Report evidence and resolve when safe']
        );
      }
      if (mapped?.route === 'codex') {
        // Refine delegation vs repository analysis by the worker target.
        const explicitHermes = /\b(ask|tell|have|give this to|hand this to|send this to)\s+hermes\b/.test(p) || /^give this to hermes/.test(p);
        if (explicitHermes) {
          return operational('hermes', 'pipeline_operation', mapped.confidence, 'Semantic intent: explicit Hermes delegation', 'Jarvis', ['Create Hermes task', 'Dispatch to Hermes worker'], false, false, 'hermes');
        }
        return operational('codex', 'repository_analysis', mapped.confidence, 'Semantic intent: repository/source analysis', 'CodeX', ['Confirm selected repository', 'Inspect relevant files', 'Report findings'], true, false, 'codex');
      }
    }

    // Fallback direct chat
    return direct('conversation', 0.55, 'No operational action requested');
  }
}

export const intentRouter = new IntentRouter();
