/**
 * Conversational Acknowledgement Generator (Jarvis Conversational Supervisor Milestone).
 *
 * Generates an immediate conversational acknowledgement explaining:
 *   1. What Jarvis understood from the user request.
 *   2. What Jarvis is doing / which worker it is deploying (Hermes for planning/research,
 *      CodeX for implementation/verification).
 *   3. That Jarvis will provide real-time updates as work unfolds.
 *
 * Must be returned immediately before waiting for worker results.
 */
import type { WorkerKind } from '../../services/backgroundTasks/types.js';

export function buildConversationalAcknowledgement(
  prompt: string,
  workerKind: WorkerKind | string,
  readOnly = false
): string {
  const p = prompt.trim();
  const lower = p.toLowerCase();

  // 1. Read-only code / repository inspection
  if (
    readOnly ||
    /\b(?:read\s*-?\s*only|readonly|do not change|without modifying|analysis only|inspection only|do not modify|don't change|without changing)\b/i.test(lower)
  ) {
    return `Understood. I'll inspect the repository without making changes and report the findings.`;
  }

  // 2. Specific Revenue / Business / Strategy goals
  if (/\b(?:make|earn|first)\s+(?:€|\$|£)?\s*\d+|\b(?:revenue|first \d+|business strategy|make money)\b/i.test(lower)) {
    return `Understood. I'll have Hermes compare realistic options that fit our current capabilities. I'll keep you updated as the work progresses.`;
  }

  // 3. Planning, Research, Strategy, or Market Analysis (Hermes)
  if (workerKind === 'hermes' || /\b(?:plan|roadmap|strategy|research|analyze|compare|investigate|find|niche)\b/i.test(lower)) {
    return `Understood. I'm sending this to Hermes for planning and analysis.`;
  }

  // 4. CodeX Implementation / Engineering / Refactor / Bug fix / Tests
  if (workerKind === 'codex' || /\b(?:implement|fix|add|create|refactor|build|test|update|modify|edit)\b/i.test(lower)) {
    return `Understood. I'm delegating the implementation to CodeX. I'll report back when the execution result is verified.`;
  }

  // 5. Magnitude browser automation
  if (workerKind === 'magnitude' || /\b(?:browser|website|web page|url)\b/i.test(lower)) {
    return `Understood. I'm delegating the web inspection to Magnitude.`;
  }

  // 6. Agent Teams
  if (workerKind === 'team' || workerKind === 'agent_teams') {
    return `Understood. I'm assembling the agent team to coordinate and execute this request.`;
  }

  // 7. Generic Default
  const workerName = workerKind === 'hermes' ? 'Hermes' : workerKind === 'codex' ? 'CodeX' : 'the worker';
  return `Understood. I'm deploying ${workerName} to handle this task. I'll keep you updated on progress.`;
}
