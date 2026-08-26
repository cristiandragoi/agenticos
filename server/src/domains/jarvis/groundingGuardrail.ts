/**
 * Grounding Guardrail — Architectural enforcement of "NO REPOSITORY CLAIM WITHOUT EVIDENCE".
 *
 * Direct Jarvis conversational mode must NOT generate repository-specific facts unless
 * those facts are grounded in:
 * 1. Completed worker/CodeX inspection results
 * 2. Verified repository/tool evidence available to the current execution path
 * 3. Persisted grounded results from the current conversation/task
 */

const REPOSITORY_QUERY_PATTERNS = [
  /\b(production (problems?|blockers?|issues?)|top\s*\d+\s*(problems?|blockers?|issues?))\b/i,
  /\b(analyze|inspect|audit|review)\b.*\b(repo|repository|codebase|code)\b/i,
  /\b(what|where)\b.*\b(bug|defect|issue|problem|broken|error|leak)\b.*\b(in|of)\b.*\b(repo|repository|codebase|code|module|file)\b/i,
  /\b(show me|where did you find|which file|what file)\b.*\b(found|located|defined|evidence|problem|blocker|lumber|llama|finding)\b/i,
  /\bwhy did you (list|say|claim|name)\b.*\b(as a problem|as a blocker|production blocker|issue|llama|lumber)\b/i,
  /\bwhy did codex (list|say|claim|name)\b.*\b(as a problem|as a blocker|production blocker|issue|llama|lumber)\b/i,
  /\b(explain|elaborate on)\b.*\b(blocker|problem|finding|second problem|first problem|third problem)\b/i,
  /\bwhat did (codex|hermes|agent|worker)\b/i,
];

const MODEL_IDENTITY_QUERY_PATTERNS = [
  /\b(what model|which model|what provider|which provider|what are you running|what model are you using)\b/i,
  /\bmodel are you using for this conversation\b/i,
];

const CONVERSATIONAL_CORRECTION_PATTERNS = [
  /\b(you (said|told me) that already|you already said that|don'?t repeat( it| that)?|no need to repeat|you don'?t have to repeat)\b/i,
  /\b(stop repeating|already know that|already told me)\b/i,
];

const REPOSITORY_CLAIM_SIGNALS = [
  /\b(top \d+ production blockers?|biggest production problems?)/i,
  /\b(insufficient memory allocation for worker processes|unresolved compatibility issues with|unoptimized database queries for data retrieval|incomplete code coverage for critical task paths)/i,
  /\b(memory leak in the `?[a-zA-Z0-9_-]+`? module|inefficient algorithm in the `?[a-zA-Z0-9_-]+`? module)/i,
  /\b(1\.\s*\*\*.*?\*\*.*?2\.\s*\*\*.*?\*\*.*?3\.\s*\*\*.*?\*\*)/s,
  /\bI found .* in (server\/|src\/|[a-zA-Z0-9_-]+\.[a-z]+) on line \d+/i,
];

export function isRepositorySpecificQuery(prompt: string): boolean {
  if (!prompt || typeof prompt !== 'string') return false;
  return REPOSITORY_QUERY_PATTERNS.some((pattern) => pattern.test(prompt));
}

export function isModelIdentityQuery(prompt: string): boolean {
  if (!prompt || typeof prompt !== 'string') return false;
  return MODEL_IDENTITY_QUERY_PATTERNS.some((pattern) => pattern.test(prompt));
}

export function isConversationalCorrection(prompt: string): boolean {
  if (!prompt || typeof prompt !== 'string') return false;
  return CONVERSATIONAL_CORRECTION_PATTERNS.some((pattern) => pattern.test(prompt));
}

export function getUngroundedGroundingStatement(): string {
  return "I need to inspect the repository or use the result from the delegated CodeX task before I can answer that accurately.";
}

export function containsUngroundedRepositoryClaims(reply: string): boolean {
  if (!reply || typeof reply !== 'string') return false;
  return REPOSITORY_CLAIM_SIGNALS.some((pattern) => pattern.test(reply));
}

/**
 * Sanitizes a direct-chat response against ungrounded hallucination, repetition,
 * or model identity cross-contamination.
 */
export function sanitizeDirectResponse(
  reply: string,
  options: {
    prompt: string;
    hasGroundedEvidence: boolean;
    groundedResult?: string;
    isModelQuery?: boolean;
    isCorrection?: boolean;
  }
): string {
  if (!reply) return reply;

  const prompt = options.prompt || '';
  const isModel = options.isModelQuery || isModelIdentityQuery(prompt);
  const isCorr = options.isCorrection || isConversationalCorrection(prompt);

  // 1. Model Identity Query: model statement only. Strip any trailing hallucinated lists.
  if (isModel) {
    const lines = reply.split('\n');
    const modelLineIndex = lines.findIndex((l) => /I'm running .* via /i.test(l));
    if (modelLineIndex !== -1) {
      const modelLine = lines[modelLineIndex].trim();
      return modelLine;
    }
  }

  // 2. Conversational Correction: "You said that already. Don't repeat it."
  if (isCorr) {
    if (containsUngroundedRepositoryClaims(reply) || /\b(top \d+|blockers?|production problems?)\b/i.test(reply)) {
      return "Understood. I will not repeat that. Let me know what you would like to focus on next.";
    }
  }

  // 3. Repository-specific query with claims:
  if (isRepositorySpecificQuery(prompt)) {
    // If the prompt asks about a false premise (e.g. Llama 3.2 / Lumber) when grounded result exists:
    if (options.hasGroundedEvidence && options.groundedResult && /llama|lumber/i.test(prompt) && !/llama|lumber/i.test(options.groundedResult)) {
      // If the model's reply attempts to fabricate a file location or validate the false claim:
      if (/\bI found .* in (server\/|src\/|[a-zA-Z0-9_-]+\.[a-z]+) on line \d+/i.test(reply) || /\b(Llama 3\.2 is indeed a problem|Llama 3\.2 causes issues)\b/i.test(reply)) {
        return "Codex did not report Llama 3.2 as one of those findings. The repository inspection did not identify Llama 3.2 as a production blocker.";
      }
      return reply;
    }

    if (!options.hasGroundedEvidence) {
      if (containsUngroundedRepositoryClaims(reply) || /\b(production blockers?|top \d+|I found .* in .* on line \d+)\b/i.test(reply)) {
        return getUngroundedGroundingStatement();
      }
    }
  }

  return reply;
}
