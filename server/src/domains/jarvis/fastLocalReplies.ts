/**
 * fastLocalReplies — deterministic LOCAL reply paths for the Jarvis stream
 * route, BEFORE any LLM/tool invocation.
 *
 * Voice-reliability closure (Phases 4–5): presence checks ("Jarvis, are you
 * there?") and direct local-knowledge questions ("What is Jarvis?",
 * "What is Agentic OS?") must NOT pay the full model round-trip. They are
 * answered from local, grounded knowledge — no LLM, no tools, no memory
 * recall, no research chain. Everything here is a canned-but-truthful local
 * reply keyed by an exact pattern; nothing is invented.
 */
export interface LocalFastReply {
  /** Human-visible reply text (also spoken by the caller's TTS path). */
  reply: string;
  /** Pattern matched, for diagnostics. */
  matched: string;
}

const PRESENCE_PATTERNS: RegExp[] = [
  /\b(are you there|are you here|you there|you here|you around|are you listening|are you awake|can you hear me|are you still there)\b/i,
  // Bare wake with optional punctuation: "Jarvis", "Jarvis?", "Hey Jarvis."
  // (mission Phase 4 — a wake is a presence check and gets a quick ack).
  /^(?:hey\s+|ok(?:ay)?\s+|hi\s+|hello\s+)?jarvis[,.!?]*$/i,
];

const DIRECT_LOCAL_QUESTION_PATTERNS: Array<{ re: RegExp; reply: string }> = [
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
];

/** Detect a presence/reassurance prompt ("Jarvis, are you there?"). */
export function detectPresencePrompt(text: string): LocalFastReply | null {
  const t = (text || '').trim();
  if (!t) return null;
  for (const re of PRESENCE_PATTERNS) {
    if (re.test(t)) return { reply: "Yes, I'm here.", matched: re.source };
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
