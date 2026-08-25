/**
 * Jarvis Conversational Authority & Context Isolation Module
 *
 * Implements strict authority labeling, confidence thresholding, context isolation,
 * and ambient speech filtering:
 *   1. Source labels: USER_EXPLICIT, USER_UNCERTAIN, AMBIENT_AUDIO, SYSTEM_EVENT, AGENT_EVENT, MEMORY_CONTEXT.
 *   2. Only USER_EXPLICIT may directly authorize new operational work (task creation, delegation, mutation).
 *   3. If intent confidence is below the execution threshold (0.60 / 60%), Jarvis asks for clarification.
 *   4. Ambient or uncertain speech asks: "Was that meant for me?" and is never written into operational memory.
 *   5. System/task/supervisor events are NEVER treated as user instructions.
 *   6. User rejection ("no, that wasn't for you") cleanly discards previous input from operational context.
 *   7. Revenue Supervisor autonomous cycles never inject into conversation unless asked or requiring gate approval.
 */

export type InputSourceLabel =
  | 'USER_EXPLICIT'
  | 'USER_UNCERTAIN'
  | 'AMBIENT_AUDIO'
  | 'SYSTEM_EVENT'
  | 'AGENT_EVENT'
  | 'MEMORY_CONTEXT';

export const EXECUTION_CONFIDENCE_THRESHOLD = 0.60;

export interface AuthorityClassification {
  source: InputSourceLabel;
  confidence: number;
  isAddressedToJarvis: boolean;
  isOperationalAuthorized: boolean;
  reason: string;
  rejectionDetected?: boolean;
  clarificationPrompt?: string;
}

// ── Pattern sets for ambient audio, third-party speech, media, and disavowals ──

const MEDIA_OR_STREAM_PATTERNS: RegExp[] = [
  /\b(like and subscribe|leave a comment below|in today'?s video|welcome back to (my|the) channel)\b/i,
  /\b(smash that like button|hit the bell|turn on notifications|link in the description)\b/i,
  /\b(sponsorship|commercial break|subscribe for more|watch until the end)\b/i,
  /\b(today'?s sponsor|our sponsor for today|unboxing video|let'?s jump into the stream)\b/i,
  /\b(playing minecraft|gameplay walkthrough|tier list|reaction video)\b/i,
];

const THIRD_PARTY_CHATTER_PATTERNS: RegExp[] = [
  /\b(pass the salt|did you see the game|what do you want for dinner|can you pick up the kids)\b/i,
  /\b(honey are we having|who is at the door|the weather is nice today|did you feed the (dog|cat))\b/i,
  /\b(clean up your room|turn down the tv|dinner is ready|see you at work tomorrow)\b/i,
  /\b(mom said|dad said|call me when you get there|talk to you later bye)\b/i,
];

const SYSTEM_OR_EVENT_PATTERNS: RegExp[] = [
  /^\[(?:db|supervisor|system|bg-task|audit|event|build|test)\]/i,
  /\b(?:migration notice|supervisor state changed|table already exists|connection reset|unhandled rejection)\b/i,
  /^task-[\w-]+ (?:started|completed|failed|progress)/i,
  /^bgtask-[\w-]+ (?:started|completed|failed|progress)/i,
  /^(?:event:|data:)\s*\{/i,
];

const REJECTION_DISAVOWAL_PATTERNS: RegExp[] = [
  /\b(?:no,? )?(?:that )?wasn'?t (?:meant )?for you\b/i,
  /\bnot (?:for )?you\b/i,
  /\b(?:no,? )?ignore that\b/i,
  /\bdisregard(?: that)?\b/i,
  /\bsorry,?(?: was)? talking to someone else\b/i,
  /\bwasn'?t talking to you\b/i,
  /\bnever mind,?(?: that was)? (?:not for you|background)\b/i,
];

const DIRECT_ADDRESS_PATTERNS: RegExp[] = [
  /^(?:hey |ok |okay )?jarvis\b/i,
  /\bjarvis[,:]/i,
  /\b(?:please |can you |could you |have |tell |ask )?(?:codex|hermes|magnitude|agent teams)\b/i,
];

/**
 * Classify input authority and validate whether operational work is authorized.
 */
export function classifyInputAuthority(
  prompt: string,
  options: {
    inputChannel?: string;
    confidence?: number;
    sourceHeader?: string;
    isSystem?: boolean;
    isAgent?: boolean;
  } = {}
): AuthorityClassification {
  const p = (prompt || '').trim();

  // 1. Explicit Rejection / Disavowal ("no, that wasn't for you")
  if (REJECTION_DISAVOWAL_PATTERNS.some(re => re.test(p))) {
    return {
      source: 'USER_EXPLICIT',
      confidence: 1.0,
      isAddressedToJarvis: true,
      isOperationalAuthorized: false,
      rejectionDetected: true,
      reason: 'User explicitly stated previous input was not meant for Jarvis.',
      clarificationPrompt: "Understood. I've discarded that from our operational context.",
    };
  }

  // 2. System and Supervisor Events
  if (options.isSystem || options.sourceHeader === 'SYSTEM_EVENT' || SYSTEM_OR_EVENT_PATTERNS.some(re => re.test(p))) {
    return {
      source: 'SYSTEM_EVENT',
      confidence: 1.0,
      isAddressedToJarvis: false,
      isOperationalAuthorized: false,
      reason: 'System event or diagnostic log cannot be treated as user instruction.',
    };
  }

  // 3. Worker / Agent Events
  if (options.isAgent || options.sourceHeader === 'AGENT_EVENT') {
    return {
      source: 'AGENT_EVENT',
      confidence: 1.0,
      isAddressedToJarvis: false,
      isOperationalAuthorized: false,
      reason: 'Worker or agent event is an internal report, not direct user authorization.',
    };
  }

  // 4. Ambient Audio / Third-Party Chatter / Media Streams
  const isMediaStream = MEDIA_OR_STREAM_PATTERNS.some(re => re.test(p));
  const isThirdPartyChatter = THIRD_PARTY_CHATTER_PATTERNS.some(re => re.test(p));

  if (isMediaStream || isThirdPartyChatter || options.sourceHeader === 'AMBIENT_AUDIO') {
    return {
      source: 'AMBIENT_AUDIO',
      confidence: options.confidence ?? 0.3,
      isAddressedToJarvis: false,
      isOperationalAuthorized: false,
      reason: 'Ambient audio or background video speech detected.',
      clarificationPrompt: 'Was that meant for me?',
    };
  }

  // 5. Confidence Thresholding
  const passedConfidence = typeof options.confidence === 'number' ? options.confidence : 1.0;
  if (passedConfidence < EXECUTION_CONFIDENCE_THRESHOLD) {
    return {
      source: 'USER_UNCERTAIN',
      confidence: passedConfidence,
      isAddressedToJarvis: DIRECT_ADDRESS_PATTERNS.some(re => re.test(p)),
      isOperationalAuthorized: false,
      reason: `Intent confidence (${Math.round(passedConfidence * 100)}%) is below operational threshold (${Math.round(EXECUTION_CONFIDENCE_THRESHOLD * 100)}%).`,
      clarificationPrompt: "I'm not completely certain what you'd like me to do. Could you clarify your request?",
    };
  }

  // 6. Explicit User Input
  return {
    source: 'USER_EXPLICIT',
    confidence: passedConfidence,
    isAddressedToJarvis: true,
    isOperationalAuthorized: true,
    reason: 'Explicit direct user instruction.',
  };
}

/**
 * Identify internal events that actually require user attention
 * (approvals, unrecoverable failures, provider timeouts, security actions).
 * Routine internal events return false and are filtered from user chat.
 */
export function isEventRequiringAttention(prompt: string, metadata: any = {}): boolean {
  const p = (prompt || '').toLowerCase();
  if (p.includes('approval required') || p.includes('waiting for approval') || metadata?.approvalRequired) return true;
  if (p.includes('unrecoverable failure') || p.includes('circuit breaker open') || metadata?.unrecoverable) return true;
  if (p.includes('provider timeout') || p.includes('timed out after') || metadata?.providerTimeout) return true;
  if (p.includes('security sensitive') || metadata?.securitySensitive) return true;
  return false;
}

/**
 * State manager for Canonical Objectives and User Priority.
 */
class CanonicalObjectiveManager {
  private persistentStrategicObjective = 'Autonomous revenue generation and operational ecosystem management.';
  private currentUserTask: { taskId?: string; description: string; assignedAt: number } | null = null;
  private discardedTurns = new Set<string>();

  getStrategicObjective(): string {
    return this.persistentStrategicObjective;
  }

  getCurrentUserTask(): { taskId?: string; description: string; assignedAt: number } | null {
    return this.currentUserTask;
  }

  setCurrentUserTask(description: string, taskId?: string): void {
    this.currentUserTask = {
      description,
      taskId,
      assignedAt: Date.now(),
    };
  }

  clearCurrentUserTask(): void {
    this.currentUserTask = null;
  }

  discardTurn(content: string): void {
    this.discardedTurns.add(content.trim());
  }

  isTurnDiscarded(content: string): boolean {
    return this.discardedTurns.has(content.trim());
  }
}

export const canonicalObjectiveManager = new CanonicalObjectiveManager();
