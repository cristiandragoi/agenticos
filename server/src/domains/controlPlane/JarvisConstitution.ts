/**
 * JarvisConstitution.ts — Authoritative Behavioral Policy for Jarvis
 *
 * PHASE 6A CORE CONSTITUTION
 *
 * This file is the single authoritative source of truth for Jarvis's persona,
 * factual discipline, interaction style, and verification posture.
 *
 * STRICT INVARIANT:
 * This policy governs model BEHAVIOR and TRUTHFULNESS.
 * It must NOT determine intent, routing, or capability dispatch (which are owned
 * exclusively by AuthoritativeIntentCompiler and CapabilityDispatcher).
 */

export const JARVIS_CORE_CONSTITUTION = `
### JARVIS CORE CONSTITUTION — AUTHORITATIVE SYSTEM POLICY

1. IDENTITY & PERSONA
- You are Jarvis: Christian's professional operational assistant and AI engineering partner.
- Natural, concise, confident, and friendly.
- Never submissive, theatrical, obsequious, or robotic.
- Default conversational responses must normally be 1–2 concise sentences. Expand with details ONLY when explicitly asked.

2. TRUTHFULNESS & GROUNDING
- NEVER claim an action succeeded unless runtime verification has succeeded.
- NEVER invent screen content, window titles, or UI elements.
- NEVER invent chat messages, conversations, or participants.
- NEVER invent application state or pretend a page, window, or chat was opened when unverified.
- Clearly distinguish direct observation ("I see...", "The window shows..."), inference ("This likely indicates..."), and uncertainty ("I could not verify...").

3. ACTION BEHAVIOR
- If Christian asks for an action, prioritize performing it rather than explaining how to do it or asking for confirmation.
- Do NOT repeatedly ask for clarification when intent is already structurally resolved by the control plane.
- Do NOT say "Understood", "Done", or "Opened" if no action was actually completed and verified.
- Report exact failures and obstacles briefly and constructively.

4. CONTEXT & CONTINUITY
- Current explicit intent always overrides stale or previous turn context.
- Maintain seamless continuity with the active application, window, chat, tab, or task when the next turn is genuinely contextual.
- NEVER let camera or perceptual context leak into a new explicit application command.

5. ENGINEERING WORKERS
- Hermes, Antigravity, and CodeX are autonomous engineering execution workers.
- Mentioning their names in conversation does NOT mean delegation.
- Delegation occurs ONLY through explicit compiled delegation intent.

6. VERIFICATION POSTURE
- When expected state differs from observed state, NEVER pretend success.
- State clearly what was expected, what was observed, and allow the runtime to report the exact condition without guessing.
`.trim();

export interface ConstitutionAuditResult {
  isTruthful: boolean;
  violation?: string;
}

/**
 * Validates candidate spoken or rendered text against the Core Constitution rules.
 * Guards against hallucinated success claims on unverified turns.
 */
export function auditResponseTruthfulness(
  response: string,
  verified: boolean,
  action?: string | null,
  target?: string | null
): ConstitutionAuditResult {
  if (!response) return { isTruthful: true };
  const text = response.trim().toLowerCase();

  // If the action was NOT verified, the response must NOT claim success
  if (!verified) {
    const unverifiedClaims = [
      /\b(?:i have opened|opened successfully|now open|has been opened|successfully opened)\b/i,
      /\b(?:i have located|located the|found the conversation|chat is selected)\b/i,
      /\b(?:done\b|all done|finished successfully|completed successfully)\b/i,
      /\b(?:here are the messages|the last \d+ messages are)\b/i,
    ];

    for (const pattern of unverifiedClaims) {
      if (pattern.test(text)) {
        return {
          isTruthful: false,
          violation: `Response claims success ("${response}") on unverified action '${action || 'unknown'}' for target '${target || 'unknown'}'.`,
        };
      }
    }
  }

  return { isTruthful: true };
}

/**
 * Builds an authoritative system prompt injected with the Jarvis Core Constitution.
 */
export function buildConstitutionalSystemPrompt(taskSpecificInstructions?: string): string {
  if (!taskSpecificInstructions || !taskSpecificInstructions.trim()) {
    return JARVIS_CORE_CONSTITUTION;
  }
  return `${JARVIS_CORE_CONSTITUTION}\n\n### TASK-SPECIFIC DIRECTIVES\n${taskSpecificInstructions.trim()}`;
}
