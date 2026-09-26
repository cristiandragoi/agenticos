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
export interface LocalFastReply {
  /** Human-visible reply text (also spoken by the caller's TTS path). */
  reply: string;
  /** Pattern matched, for diagnostics. */
  matched: string;
}

/** Ordered presence rules; the first match wins. Anchored rules come after the
 *  un-anchored "are you there / still there" check. */
const PRESENCE_RULES: Array<{ re: RegExp; reply: string }> = [
  {
    // Presence check — "are you there", "you there", "still there", "can you
    // hear me", etc. (un-anchored so "Jarvis, you there?" matches).
    re: /\b(are you there|are you here|you there|you here|you around|are you listening|are you awake|can you hear me|do you hear me|are you still there|still there|still here|still with me|still awake|still around|still listening|anyone there|anyone home|how are you|how are you doing|how's it going|how's life|how is it going)\b/i,
    reply: "Yeah, I'm here. What's up?",
  },
  {
    // Bare greeting — "Hello", "Hi", "Hey", "Hey there", "Yo", "Howdy"
    // (with or without "Jarvis").
    re: /^(?:hey|hi|hello|hiya|yo|howdy|good\s+(?:morning|afternoon|evening))[,.!?\s]*(?:(?:there|jarvis)[,.!?]*)?$/i,
    reply: "Hey — I'm here. What can I do for you?",
  },
  {
    // Pause / hold — "Wait", "One second", "Hold on", "Give me a minute".
    re: /^(?:wait|hold on|hang on|one second|one sec|one moment|one minute|give me a (?:second|sec|moment|minute)|just a (?:second|sec|moment|minute)|gimme a (?:second|sec|moment|minute))[,.!?]*$/i,
    reply: "Sure, take your time — I'll be here when you're ready.",
  },
  {
    // Bare acknowledgement — "Okay", "Fine", "Got it", "Thanks" (no task verbs).
    re: /^(?:okay|ok|k|fine|alright|all right|sure|got it|gotcha|cool|perfect|great|nice|thanks|thank you|sounds good)[,.!?\s]*(?:(?:there|jarvis)[,.!?]*)?$/i,
    reply: "Got it. Just let me know what you'd like to do.",
  },
  {
    // Bare wake — "Jarvis", "Jarvis?", "Hey Jarvis", "Okay Jarvis".
    re: /^(?:hey\s+|ok(?:ay)?\s+|hi\s+|hello\s+)?jarvis[,.!?]*$/i,
    reply: "Yeah, I'm here. What's up?",
  },
];

const DIRECT_LOCAL_QUESTION_PATTERNS: Array<{ re: RegExp; reply: string }> = [
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
export function detectPresencePrompt(text: string): LocalFastReply | null {
  const t = (text || '').trim();
  if (!t) return null;
  for (const rule of PRESENCE_RULES) {
    if (rule.re.test(t)) return { reply: rule.reply, matched: rule.re.source };
  }
  return null;
}

/** Detect a direct local-knowledge question (Jarvis / Agentic OS identity). */
export function detectDirectLocalQuestion(text: string): LocalFastReply | null {
  const t = (text || '').trim();
  if (!t) return null;
  for (const entry of DIRECT_LOCAL_QUESTION_PATTERNS) {
    if (entry.re.test(t)) return { reply: entry.reply, matched: entry.re.source };
  }
  return null;
}

/** Unified fast-path entry: presence first, then local knowledge. */
export function detectLocalFastReply(text: string): LocalFastReply | null {
  return detectPresencePrompt(text) ?? detectDirectLocalQuestion(text);
}
