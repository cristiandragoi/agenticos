/**
 * fastLocalReplies — deterministic LOCAL reply paths for the Jarvis stream
 * route, BEFORE any LLM/tool invocation.
 *
 * Voice-reliability closure (Phases 4–5): presence checks ("Jarvis, are you
 * there?"), bare greetings ("Hello?"), and pauses ("Wait.") must NOT pay the
 * full model round-trip and must NEVER be routed to investigate / CodeX /
 * Hermes / maintenance or answered with runtime telemetry. They are answered
 * from local, grounded knowledge — no LLM, no tools, no memory recall.
 *
 * P0 hardening: the presence set is expanded so "Still there?", a bare
 * "Hello/Hi/Hey", and pauses ("Wait", "One second") are caught. Every
 * greeting/pause/ack pattern is ANCHORED so a task-bearing continuation
 * ("Okay, fix it", "Wait, don't change anything yet") is never misread as a
 * bare presence turn — those keep their existing approval/task semantics.
 */
import { getActiveLanguage } from '../../services/language/activeLanguageState.js';

export interface LocalFastReply {
  /** Human-visible reply text (also spoken by the caller's TTS path). */
  reply: string;
  /** Pattern matched, for diagnostics. */
  matched: string;
}

export function getTimeAwareGreeting(name: string = 'Christian'): string {
  const isGerman = getActiveLanguage() === 'de';
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) {
    return isGerman ? `Guten Morgen, ${name}.` : `Good morning, ${name}.`;
  } else if (hour >= 12 && hour < 18) {
    return isGerman ? `Guten Tag, ${name}.` : `Good afternoon, ${name}.`;
  } else {
    return isGerman ? `Guten Abend, ${name}.` : `Good evening, ${name}.`;
  }
}

/** Ordered presence rules; the first match wins. Anchored rules come after the
 *  un-anchored "are you there / still there" check. */
const PRESENCE_RULES: Array<{ re: RegExp; reply: string | ((isContinuing?: boolean) => string) }> = [
  {
    // Presence check (German) — "bist du da", "kannst du mich hören", "wie geht es dir"
    re: /\b(bist du da|bist du hier|bist du noch da|hörst du mich|kannst du mich hören|bist du wach|noch da|noch hier|wie geht'?s|wie geht es dir)\b/i,
    reply: "Ja, ich bin da. Wie kann ich dir helfen?",
  },
  {
    // Presence check (English) — "are you there", "you there", "still there", "can you hear me", etc.
    re: /\b(are you there|are you here|you there|you here|you around|are you listening|are you awake|can you hear me|do you hear me|are you still there|still there|still here|still with me|still awake|still around|still listening|anyone there|anyone home|how are you|how are you doing|how's it going|how's life|how is it going)\b/i,
    reply: "Yeah, I'm here. What's up?",
  },
  {
    // Bare greeting (German) — "Hallo", "Hallo Jarvis", "Guten Tag", "Guten Morgen", "Guten Abend"
    re: /^(?:hallo|hi|hey|guten\s+(?:morgen|tag|abend))[,.!?\s]*(?:(?:da|jarvis)[,.!?]*)?$/i,
    reply: (isContinuing?: boolean) => (isContinuing ? "Ich bin hier." : getTimeAwareGreeting('Christian')),
  },
  {
    // Bare greeting (English) — "Hello", "Hi", "Hey", "Hey there", "Yo", "Howdy", "Good evening, Jarvis"
    re: /^(?:hey|hi|hello|hiya|yo|howdy|good\s+(?:morning|afternoon|evening))[,.!?\s]*(?:(?:there|jarvis)[,.!?]*)?$/i,
    reply: (isContinuing?: boolean) => (isContinuing ? "I'm here." : getTimeAwareGreeting('Christian')),
  },
  {
    // Pause / hold (German) — "Warte", "Einen Moment", "Eine Sekunde", "Kurz warten"
    re: /^(?:warte|moment|einen\s+moment|eine\s+sekunde|halt\s+kurz|stopp\s+kurz|kurz\s+warten)[,.!?]*$/i,
    reply: "Klar, nimm dir Zeit — ich bin hier, wenn du bereit bist.",
  },
  {
    // Pause / hold (English) — "Wait", "One second", "Hold on", "Give me a minute"
    re: /^(?:wait|hold on|hang on|one second|one sec|one moment|one minute|give me a (?:second|sec|moment|minute)|just a (?:second|sec|moment|minute)|gimme a (?:second|sec|moment|minute))[,.!?]*$/i,
    reply: "Sure, take your time — I'll be here when you're ready.",
  },
  {
    // Thanks / polite close (German) — "Danke, das reicht", "Danke, dass reicht", "Danke dir", "Vielen Dank"
    re: /^(?:danke[,\s]+das+s?\s+reicht|das+s?\s+reicht[,\s]+danke|danke\s+dir|vielen\s+dank|danke|perfekt\s+danke|super\s+danke|alles\s+klar)[,.!?\s]*(?:(?:jarvis)[,.!?]*)?$/i,
    reply: "Gerne. Sag einfach Bescheid, wenn du noch etwas brauchst.",
  },
  {
    // Bare acknowledgement (English) — "Okay", "Fine", "Got it", "Thanks" (no task verbs)
    re: /^(?:okay|ok|k|fine|alright|all right|sure|got it|gotcha|cool|perfect|great|nice|thanks|thank you|sounds good)[,.!?\s]*(?:(?:there|jarvis)[,.!?]*)?$/i,
    reply: "Got it. Just let me know what you'd like to do.",
  },
  {
    // Bare wake — "Jarvis", "Jarvis?", "Hey Jarvis", "Okay Jarvis"
    re: /^(?:hey\s+|ok(?:ay)?\s+|hi\s+|hello\s+|hallo\s+)?jarvis[,.!?]*$/i,
    reply: (isContinuing?: boolean) => (isContinuing ? (getActiveLanguage() === 'de' ? "Ich bin da." : "Yeah, I'm here. What's up?") : getTimeAwareGreeting('Christian')),
  },
];

const DIRECT_LOCAL_QUESTION_PATTERNS: Array<{ re: RegExp; reply: string | (() => string) }> = [
  {
    // Time inquiry (German) — "Wie spät ist es?", "Wie spät ist das?", "Wieviel Uhr ist es?"
    re: /\b(wie\s+spät\s+ist\s+(?:es|das)|wie\s+viel\s+uhr\s+ist\s+(?:es|das)|wieviel\s+uhr\s+ist\s+(?:es|das)|welche\s+uhrzeit\s+haben\s+wir)\b/i,
    reply: () => {
      const timeStr = new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
      return `Es ist ${timeStr} Uhr.`;
    },
  },
  {
    // Time inquiry (English) — "What time is it?", "What's the time?"
    re: /\b(what\s+time\s+is\s+it|what's\s+the\s+time|current\s+time)\b/i,
    reply: () => {
      const timeStr = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      return `It is ${timeStr}.`;
    },
  },
  {
    // Capabilities inquiry (German) — "Was kannst du tun?", "Was kannst du?"
    re: /\b(was\s+kannst\s+du\s+tun|was\s+kannst\s+du|was\s+machst\s+du|was\s+sind\s+deine\s+fähigkeiten)\b/i,
    reply: "Ich bin Jarvis, dein persönlicher Assistent für Agentic OS.",
  },
  {
    // Short joke (German) — "Erzähl mir einen kurzen Witz", "Erzähl einen Witz", Whisper "Ditz" variant
    re: /\b(erzähl\s+(?:mir\s+)?(?:einen\s+)?(?:kurzen\s+)?[wd]itz|hast\s+du\s+einen\s+[wd]itz|kennst\s+du\s+einen\s+[wd]itz)\b/i,
    reply: "Warum können Geister so schlecht lügen? Weil sie leicht zu durchschauen sind.",
  },
  {
    // Short joke (English) — "Tell me a short joke", "Tell me a joke"
    re: /\b(tell\s+me\s+(?:a\s+)?(?:short\s+)?joke|know\s+any\s+jokes?)\b/i,
    reply: "Why do programmers prefer dark mode? Because light attracts bugs.",
  },
  {
    // New project handoff (with immediate execution instruction)
    re: /\bi'll give you a (new\s+)?project\b.*\b(?:start now|has to start now|start)\b/i,
    reply: "Send it over. I'll turn it into an implementation task and delegate the code work to Codex.",
  },
  {
    // New project handoff (generic)
    re: /\bi'll give you a (new\s+)?project\b/i,
    reply: "Send it over.",
  },
  {
    // "What is Jarvis?" / "Who is Jarvis?" — grounded identity, no invented OS.
    re: /\bwhat\s+is\s+jarvis\b|\bwho\s+is\s+jarvis\b/i,
    reply:
      "I'm Jarvis, the operational commander of Agentic OS — the local AI-operations platform you're using. " +
      "I coordinate Hermes for research and inspection, CodeX for engineering work, and other capabilities, " +
      "manage tasks and schedules, and answer questions about your projects and the system.",
  },
  {
    // "What is Agentic OS?" / "What is Agenticos?" — local project grounding.
    re: /\bwhat\s+is\s+(?:agentic\s*os|agenticos|argentic\s*os|authentic\s*os)\b/i,
    reply:
      "Agentic OS is the local AI-operations platform you're running right now. It includes Jarvis as the " +
      "commander, Hermes for research and inspection, CodeX for engineering, the task board, scheduler, " +
      "memory, and the revenue pipeline — all running on this machine.",
  },
  {
    // "What does Jarvis do?" — capability explanation without a worker chain.
    re: /\bwhat\s+does\s+jarvis\s+do\b/i,
    reply:
      "I coordinate your AI operations: I answer questions, delegate research to Hermes, delegate engineering " +
      "to CodeX, run schedules and background tasks, and keep track of your projects and memory.",
  },
  {
    // "What does Hermes do?" / "What does CodeX do?"
    re: /\bwhat\s+does\s+(hermes|codex)\s+do\b/i,
    reply: "Hermes is our planning and research agent, while CodeX implements and modifies code in your repository. I coordinate both of them to help execute your goals.",
  },
];

/** Detect a presence/reassurance/greeting/pause prompt. */
export function detectPresencePrompt(text: string, options?: { isContinuing?: boolean }): LocalFastReply | null {
  const t = (text || '').trim();
  if (!t) return null;
  for (const rule of PRESENCE_RULES) {
    if (rule.re.test(t)) {
      const rep = typeof rule.reply === 'function' ? rule.reply(options?.isContinuing) : rule.reply;
      return { reply: rep, matched: rule.re.source };
    }
  }
  return null;
}

/** Detect a direct local-knowledge question (Jarvis / Agentic OS identity). */
export function detectDirectLocalQuestion(text: string): LocalFastReply | null {
  const t = (text || '').trim();
  if (!t) return null;
  for (const entry of DIRECT_LOCAL_QUESTION_PATTERNS) {
    if (entry.re.test(t)) {
      const rep = typeof entry.reply === 'function' ? entry.reply() : entry.reply;
      return { reply: rep, matched: entry.re.source };
    }
  }
  return null;
}

/** Unified fast-path entry: presence first, then local knowledge. */
export function detectLocalFastReply(text: string, options?: { isContinuing?: boolean }): LocalFastReply | null {
  return detectPresencePrompt(text, options) ?? detectDirectLocalQuestion(text);
}
