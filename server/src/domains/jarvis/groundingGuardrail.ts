/**
 * Grounding Guardrail — Architectural enforcement of:
 * 1. "NO REPOSITORY CLAIM WITHOUT EVIDENCE"
 * 2. "NO COMPLETION CLAIM WITHOUT VERIFIED EXECUTION EVIDENCE" (UNDERSTANDING != EXECUTION)
 * 3. Sanitization of repetitive canned suffixes ("How can I assist you further", etc.)
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

const ACTION_REQUEST_PATTERNS = [
  /\b(?:install|setup|set up|deploy|download|configure|enable|disable|delete|remove|create|edit|modify|patch|build|run|execute|delegate|ask hermes|tell hermes|write|save|make|touch|open|launch|start|send)\b/i,
  /\b(?:speak german|speak romanian|sprich deutsch|vorbește română)\b/i,
  /\b(?:erstelle|erstellen|anlegen|installiere|konfiguriere|arbeitsbereich|neuen arbeitsbereich|schreibe|speichere|lösche)\b/i,
  /\b(?:configurează|creează|instalează|proiectul|noul proiect|scrie|salvează|șterge)\b/i,
];

const COMPLETION_CLAIM_PATTERNS = [
  /\b(?:has been|have been|is now|was|successfully)\s+(?:installed|configured|enabled|disabled|changed|fixed|created|switched|updated|completed|set up|written|saved|opened|started|sent|deleted|launched)\b/i,
  /\b(?:I have|I've)\s+(?:installed|configured|enabled|disabled|changed|fixed|created|switched|updated|completed|set up|written|saved|opened|started|sent|deleted|launched)\b/i,
  /\bI\s+(?:created|opened|sent|started|launched|deleted|wrote|saved|completed)\b/i,
  /\b(?:done|installed|configured|completed|created|written|saved|sent)!?\b/i,
  /\b(?:habe|haben|wurde|wurden|ist)\s+.*?\b(?:erstellt|konfiguriert|installiert|angelegt|eingerichtet|abgeschlossen|gespeichert|geschrieben|gelöscht)\b/i,
  /\b(?:ich habe schon|wir haben schon|ich habe bereits|habe ich erstellt|wurde erstellt)\b/i,
  /\b(?:am|au fost|a fost)\s+.*?\b(?:creat|configurat|instalat|finalizat|scris|salvat|șters)\b/i,
];


const FUTURE_PROMISE_PATTERNS = [
  /\b(?:I will|I'll|let me)\s+(?:coordinate|do that|handle this|create this|set this up|build this|execute this|perform this|start this)\b/i,
  /\b(?:I will inform you|I'll inform you|I will let you know|I'll let you know)\s+(?:as soon as|when|once)\b/i,
  /\b(?:ich werde|lass mich)\s+(?:das tun|dies tun|dies für dich koordinieren|das für Sie tun|dies erledigen|dies für Sie koordinieren|einen neuen arbeitsbereich|das übernehmen)\b/i,
  /\b(?:ich informiere dich|ich gebe dir bescheid|sobald .* bereit ist)\b/i,
  /\b(?:voi face|lasă-mă să fac|te voi anunța|te voi informa|imediat ce .* este gata)\b/i,
];


const CANNED_SUFFIX_PATTERNS = [
  /\s*(?:How can I assist you further(?:,?\s*operator)?\??|How can I help you further\??|Let me know what specific task or question you'd like to work on\.?|Is there anything else I can assist you with\??)\s*$/i,
  /\s*(?:How can I assist you today(?:,?\s*operator)?\??|How can I help you today\??)\s*$/i,
  // Strip the specific "I'm here and ready" suffix when appended after a real reply
  /\s*I'?m here and ready\.?\s*(?:How can I (?:assist|help) you\s*(?:today|further)?\??)?\s*$/i,
];

/**
 * Phrases that, when they compose the ENTIRE reply, indicate the model produced
 * pure assistant-greeting filler instead of an operational response.
 * Replaceable with a concise operational fallback.
 */
const BARE_FILLER_PATTERNS = [
  /^(?:understood|got it|okay|ok)(?:,?\s+(?:operator|christian))?[.!]*$/i,
  /^i(?: am|'m) ready(?: and (?:standing by|listening))?[.!]*$/i,
  /^i'?m here and ready\.?\s*(?:how can i (?:assist|help) you\s*(?:today|further)?\??)?$/i,
  /^hey[!.]?\s*i'?m here\.?\s*(?:what can i do for you\??)?$/i,
  /^how can i (?:assist|help) you today\??$/i,
  /^i am ready and listening\.?\s*(?:how can i help you today\??)?$/i,
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

export function isActionRequest(prompt: string): boolean {
  if (!prompt || typeof prompt !== 'string') return false;
  return ACTION_REQUEST_PATTERNS.some((pattern) => pattern.test(prompt));
}

export function containsCompletionClaims(reply: string): boolean {
  if (!reply || typeof reply !== 'string') return false;
  return COMPLETION_CLAIM_PATTERNS.some((pattern) => pattern.test(reply));
}

export function containsFuturePromises(reply: string): boolean {
  if (!reply || typeof reply !== 'string') return false;
  return FUTURE_PROMISE_PATTERNS.some((pattern) => pattern.test(reply));
}

export function getUngroundedGroundingStatement(): string {
  return 'I need to inspect the repository or use the result from the delegated CodeX task before I can answer that accurately.';
}

export function containsUngroundedRepositoryClaims(reply: string): boolean {
  if (!reply || typeof reply !== 'string') return false;
  return REPOSITORY_CLAIM_SIGNALS.some((pattern) => pattern.test(reply));
}

export function stripCannedSuffixes(text: string): string {
  if (!text) return text;
  let cleaned = text;
  for (const pat of CANNED_SUFFIX_PATTERNS) {
    cleaned = cleaned.replace(pat, '').trim();
  }
  return cleaned;
}

export function containsBareFiller(reply: string): boolean {
  if (!reply || typeof reply !== 'string') return false;
  const t = reply.trim();
  return BARE_FILLER_PATTERNS.some((p) => p.test(t));
}

/**
 * Sanitizes a direct-chat response against ungrounded hallucination, repetition,
 * false action completion claims, or model identity cross-contamination.
 */
export function sanitizeDirectResponse(
  reply: string,
  options: {
    prompt: string;
    hasGroundedEvidence: boolean;
    groundedResult?: string;
    isModelQuery?: boolean;
    isCorrection?: boolean;
    isAction?: boolean;
    hasExecutionEvidence?: boolean;
    actionDescription?: string;
  }
): string {
  if (!reply) return reply;

  let sanitized = reply;
  
  // A. Aggressively strip conversational acknowledgment and title prefixes
  // (e.g. "Understood, Master. I will..." -> "I will...")
  const prefixRegex = /^(?:understood|acknowledged|got it|okay|ok|certainly|yes|sure)[\s,.]*(?:master|commander|chief|executive|christian|operator)?[\s,.-]*/i;
  let prevSanitized = '';
  while (sanitized !== prevSanitized) {
    prevSanitized = sanitized;
    sanitized = sanitized.replace(prefixRegex, '');
    sanitized = sanitized.replace(/^(?:master|commander|chief|executive|christian|operator)[\s,.-]+/i, '');
  }
  
  // Ensure we didn't strip everything; if we did, return a minimal valid response.
  if (!sanitized.trim()) sanitized = reply;
  
  // Capitalize the first letter if it was stripped
  sanitized = sanitized.charAt(0).toUpperCase() + sanitized.slice(1);

  const prompt = options.prompt || '';
  const isModel = options.isModelQuery || isModelIdentityQuery(prompt);
  const isCorr = options.isCorrection || isConversationalCorrection(prompt);
  const isAction = options.isAction ?? isActionRequest(prompt);
  const hasExecEvidence = options.hasExecutionEvidence ?? false;

  // 0. Bare filler guard (FIX 4 — JARVIS-LIVE-RUNTIME-FIX-003):
  // If the ENTIRE reply is a canned greeting/filler phrase, replace it with a
  // concise operational acknowledgement. This prevents the model from emitting
  // "I'm here and ready. How can I assist you today?" in response to garbled
  // or unclear transcripts.
  if (containsBareFiller(sanitized)) {
    if (isAction || /\b(?:check|status)\b/i.test(prompt)) return options.groundedResult || 'No capability result was produced; this request has not been executed.';
    return "I didn't catch that — what would you like to do?";
  }

  // 1. Model Identity Query: model statement only. Strip any trailing hallucinated lists.
  if (isModel) {
    const lines = sanitized.split('\n');
    const modelLineIndex = lines.findIndex((l) => /I'm running .* via /i.test(l));
    if (modelLineIndex !== -1) {
      return lines[modelLineIndex].trim();
    }
  }

  // 2. Conversational Correction: "You said that already. Don't repeat it."
  if (isCorr) {
    if (containsUngroundedRepositoryClaims(sanitized) || /\b(top \d+|blockers?|production problems?)\b/i.test(sanitized)) {
      return 'Understood. I will not repeat that. Let me know what you would like to focus on next.';
    }
  }

  // 3. Action Request False Completion or Unsupported Execution Promise Guard:
  // If the user requested an action (e.g. "erstelle einen neuen Arbeitsbereich" or "install compiler") but NO execution occurred
  // (no taskId, no tool run, no system mutation), Jarvis MUST NOT say "done", "installed", or "I will do that / let me coordinate".
  if ((isAction || containsCompletionClaims(sanitized)) && !hasExecEvidence && (containsCompletionClaims(sanitized) || containsFuturePromises(sanitized))) {
    const isGerman = /\b(erstelle|neuen arbeitsbereich|arbeitsbereich|bitte|guten morgen|installiere)\b/i.test(prompt) || /\b(guten morgen|arbeitsbereich)\b/i.test(sanitized);
    const isRomanian = /\b(configurează|proiect|te rog|bună dimineața|instalează)\b/i.test(prompt) || /\b(bună dimineața|proiectul)\b/i.test(sanitized);

    if (isGerman) {
      return 'Ich habe Ihre Anfrage verstanden. Da jedoch kein automatisierter Executor für diese Aktion gestartet wurde, wurde die Aufgabe noch nicht ausgeführt. Möchten Sie, dass ich dafür eine Aufgabe erstelle?';
    }
    if (isRomanian) {
      return 'Am înțeles solicitarea dumneavoastră. Cu toate acestea, niciun executant automat nu a fost alocat pentru această acțiune, astfel încât sarcina nu a fost încă executată. Doriți să creez o sarcină pentru aceasta?';
    }
    const match = prompt.match(/\b(?:install|set up|setup|configure|enable|deploy|create|write|save|make|touch|delete|remove|open|launch|start|send)\s+([a-zA-Z0-9_\-\. ]+)/i);
    const actionTarget = match ? match[1].trim() : 'the requested action';
    return `I understood the request regarding ${actionTarget}, but no automated executor was dispatched to perform this action, so it has not been completed. Would you like me to create a task for this?`;
  }


  // 4. Repository-specific query with claims:
  if (isRepositorySpecificQuery(prompt)) {
    if (
      options.hasGroundedEvidence &&
      options.groundedResult &&
      /llama|lumber/i.test(prompt) &&
      !/llama|lumber/i.test(options.groundedResult)
    ) {
      if (
        /\bI found .* in (server\/|src\/|[a-zA-Z0-9_-]+\.[a-z]+) on line \d+/i.test(sanitized) ||
        /\b(Llama 3\.2 is indeed a problem|Llama 3\.2 causes issues)\b/i.test(sanitized)
      ) {
        return 'Codex did not report Llama 3.2 as one of those findings. The repository inspection did not identify Llama 3.2 as a production blocker.';
      }
      return stripCannedSuffixes(sanitized);
    }

    if (!options.hasGroundedEvidence) {
      if (
        containsUngroundedRepositoryClaims(sanitized) ||
        /\b(production blockers?|top \d+|I found .* in .* on line \d+)\b/i.test(sanitized)
      ) {
        return getUngroundedGroundingStatement();
      }
    }
  }

  // 5. Strip repetitive canned suffixes
  sanitized = stripCannedSuffixes(sanitized);

  return sanitized;
}
