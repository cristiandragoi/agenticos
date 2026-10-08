/**
 * controlIntentDetector.ts — Dedicated low-latency local control command detector.
 *
 * Catches STOP / HALT / SHUT UP / BE QUIET / CANCEL instantly, including
 * natural spoken physical variations ("I say stop", "Jarvis stop", "please stop", "halt", "Javi stop").
 *
 * Ensures control commands are never dependent on conversational LLMs and never
 * route into "I couldn't make that out."
 */

export interface ControlIntentResult {
  isControl: boolean;
  intent: 'STOP' | 'NONE';
  confidence: number;
  normalizedPhrase: string;
  rawText: string;
  reason: string;
}

// All wake name variants recognized phonetically
const WAKE_VARIANTS = '(?:jarvis|javis|jarves|jarviss|javi|javvy|chavis|travis|service|jarv)';

// Prefixes common before stop commands
const PREFIX_PATTERN = '(?:(?:hey|ok(?:ay)?|hi|hello|please|i\\s+say|i\\s+said|just|can\\s+you|could\\s+you|will\\s+you|would\\s+you)\\s+)?';

// Canonical control actions (English and German)
const CONTROL_ACTIONS = '(?:stop(?:\\s+(?:it|speaking|talking|working|everything|listening|now|all\\s+work|work))?|stopp(?:\\s+(?:mal|jetzt|bitte|damit|auf|alles))?|halt(?:\\s+(?:mal|an|kurz))?|cancel(?:\\s+(?:it|all|operation|task|work|all\\s+work))?|abbrechen|shut\\s+up|be\\s+quiet|ruhe|sei\\s+still|h[öo]r\\s+auf|aufh[öo]ren|quiet|pause|silence|hold\\s+on)';

// 1. Wake word before command ("Jarvis stop", "Javi please stop", "Hey Javi halt", "Jarvis stopp")
const STRICT_STOP_WAKE_FIRST_RE = new RegExp(
  `^${PREFIX_PATTERN}${WAKE_VARIANTS}?\\s*[:.,]*\\s*(?:please\\s+|bitte\\s+)?${CONTROL_ACTIONS}\\s*(?:${WAKE_VARIANTS})?\\s*[\\s.!?]*$`,
  'i'
);

// 2. Command before wake word ("Stop Jarvis", "Halt Javi", "Stopp Jarvis", "Shut up Jarvis", "Stop please")
const STRICT_STOP_CMD_FIRST_RE = new RegExp(
  `^${PREFIX_PATTERN}${CONTROL_ACTIONS}\\s*[:.,]*\\s*(?:please\\s+|bitte\\s+)?(?:${WAKE_VARIANTS})?\\s*[\\s.!?]*$`,
  'i'
);

// Substring control keywords for short utterances (<= 6 words)
const CONTROL_KEYWORDS = ['stop', 'stopp', 'halt', 'cancel', 'abbrechen', 'ruhe', 'sei still', 'hör auf', 'aufhören', 'shut up', 'be quiet', 'quiet', 'silence', 'pause', 'hold on'];

// Phonetic / truncated acoustic variants from noisy Whisper output on short speech
const ACOUSTIC_VARIANTS: Record<string, string> = {
  'top': 'stop',
  'stopp': 'stop',
  'stoppe': 'stop',
  'stope': 'stop',
  'haut': 'halt',
  'holte': 'halt',
  'hold': 'halt',
  'cancle': 'cancel',
  'shutup': 'shut up',
  'shuttup': 'shut up',
  'quite': 'quiet',
};

/**
 * Returns true if the text resembles any control/interruption attempt,
 * used to suppress generic "I couldn't make that out" clarification prompts.
 */
export function isLikelyControlAttempt(rawText: string): boolean {
  if (!rawText || !rawText.trim()) return false;
  const lower = rawText.toLowerCase().trim();
  const clean = lower.replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
  
  if (/\b(?:stop|halt|cancel|shut\s*up|quiet|silence|pause|hold\s*on|say\s*stop)\b/i.test(clean)) {
    return true;
  }
  
  const tokens = clean.split(' ').filter(Boolean);
  if (tokens.length <= 4) {
    for (const token of tokens) {
      if (ACOUSTIC_VARIANTS[token] || CONTROL_KEYWORDS.includes(token)) {
        return true;
      }
    }
  }
  return false;
}

export function detectControlIntent(
  rawText: string,
  options: {
    isBargeIn?: boolean;
    sttConfidence?: number;
    isSpeaking?: boolean;
  } = {}
): ControlIntentResult {
  if (!rawText || !rawText.trim()) {
    return {
      isControl: false,
      intent: 'NONE',
      confidence: 0.0,
      normalizedPhrase: '',
      rawText: rawText || '',
      reason: 'empty_input',
    };
  }

  const trimmed = rawText.trim();
  const lower = trimmed.toLowerCase();
  const clean = lower.replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();

  // 1. Strict regex matches (highest confidence, e.g. "Can you stop speaking?", "Stop Jarvis", "Please be quiet")
  // These should ALWAYS be treated as control, even if phrased politely with a question mark.
  if (STRICT_STOP_WAKE_FIRST_RE.test(lower) || STRICT_STOP_CMD_FIRST_RE.test(lower)) {
    return {
      isControl: true,
      intent: 'STOP',
      confidence: 1.0,
      normalizedPhrase: 'stop',
      rawText: trimmed,
      reason: 'strict_stop_regex_match',
    };
  }

  // 2. Informational questions (e.g. "how do I stop this?", "what is stopping us?", "why did it stop?")
  // Exclude these from control intents so knowledge queries are never silenced.
  const isQuestion = trimmed.endsWith('?') ||
    /^(?:how|what|why|who|when|where|which|should\s+i|should\s+we|is\s+there|tell\s+me)\b/i.test(trimmed);

  if (isQuestion) {
    return {
      isControl: false,
      intent: 'NONE',
      confidence: 0.0,
      normalizedPhrase: '',
      rawText: trimmed,
      reason: 'question_not_control',
    };
  }

  // Project-level stop commands, application/process termination ("stop Notepad", "kill node"),
  // and media control ("pause it", "pause the video", "pause playback", "resume it")
  // are domain operations, NOT out-of-band audio control / barge-in.
  const SPEECH_CONTROL_FOLLOWERS = new Set(['talking', 'speaking', 'saying', 'reading', 'now', 'please', 'jarvis', 'javi', 'that', 'this', 'everything', 'it']);
  const isProcessOrAppStop = /^(?:stop|kill|terminate|close)\s+(?:the\s+)?([a-z0-9_.\-]+(?:\.exe)?)$/i.exec(clean);
  const isTargetedProcessStop = Boolean(isProcessOrAppStop && !SPEECH_CONTROL_FOLLOWERS.has(isProcessOrAppStop[1].toLowerCase()));

  const isTargetedDomainAction =
    isTargetedProcessStop ||
    /\b(?:pause\s+(?:it|the\s+video|playback|the\s+song|the\s+music|this)|resume\s+it)\b/i.test(clean) ||
    /\b(?:stop|pause|halt|cancel)\s+(?:working|operating|all\s+work|the\s+project|execution)\b/i.test(clean) ||
    /\b(?:stop|pause|cancel)\s+(?:on|in|inside)\s+[a-z0-9]+/i.test(clean) ||
    /\b(?:stop|kill|terminate|close)\s+(?:the\s+)?(?:process|app|application|program|service|server|backend|frontend|node|container|port)\b/i.test(clean);

  if (isTargetedDomainAction) {
    return {
      isControl: false,
      intent: 'NONE',
      confidence: 0.0,
      normalizedPhrase: '',
      rawText: trimmed,
      reason: 'targeted_domain_operation',
    };
  }


  // 2. Clean tokens without punctuation
  const tokens = clean.split(' ').filter(Boolean);

  // 3. Spoken interruption phrases ("I say stop", "I said stop", "I told you to stop")
  if (/^(?:i\s+(?:say|said|told\s+you\s+to))\s+(?:stop|halt|cancel|shut\s+up|be\s+quiet|quiet)$/i.test(clean)) {
    return {
      isControl: true,
      intent: 'STOP',
      confidence: 1.0,
      normalizedPhrase: 'stop',
      rawText: trimmed,
      reason: 'spoken_interruption_phrase',
    };
  }

  // 4. Check for exact control keywords in short utterances (<= 6 tokens)
  if (tokens.length <= 6) {
    for (const kw of CONTROL_KEYWORDS) {
      if (clean === kw || clean.startsWith(`${kw} `) || clean.endsWith(` ${kw}`) || clean.includes(` ${kw} `)) {
        return {
          isControl: true,
          intent: 'STOP',
          confidence: 0.98,
          normalizedPhrase: kw,
          rawText: trimmed,
          reason: `keyword_match_${kw}`,
        };
      }
    }

    // Check acoustic / truncated variants (e.g. "top", "haut", "shutup", "quite")
    for (const token of tokens) {
      if (ACOUSTIC_VARIANTS[token]) {
        const canonical = ACOUSTIC_VARIANTS[token];
        return {
          isControl: true,
          intent: 'STOP',
          confidence: options.isBargeIn ? 0.95 : 0.85,
          normalizedPhrase: canonical,
          rawText: trimmed,
          reason: `acoustic_variant_${token}_to_${canonical}`,
        };
      }
    }
  }

  // 5. If this occurred during Barge-In (while TTS was playing or immediately interrupted)
  // High priority to ANY utterance that contains a control keyword
  if (options.isBargeIn || options.isSpeaking) {
    if (/\b(?:stop|halt|cancel|shut\s+up|be\s+quiet|quiet|silence|pause)\b/i.test(clean)) {
      return {
        isControl: true,
        intent: 'STOP',
        confidence: 0.95,
        normalizedPhrase: 'stop',
        rawText: trimmed,
        reason: 'barge_in_contains_control_keyword',
      };
    }
  }

  return {
    isControl: false,
    intent: 'NONE',
    confidence: 0.0,
    normalizedPhrase: '',
    rawText: trimmed,
    reason: 'no_control_intent_detected',
  };
}
