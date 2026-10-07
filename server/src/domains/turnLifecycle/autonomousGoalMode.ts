import type { TurnEnvelope } from '../controlPlane/TurnEnvelope.js';

/** Shared dispatch decision: voice and lifecycle must agree on ownership. */
export function isAutonomousGoalEnvelope(envelope?: Readonly<TurnEnvelope>): boolean {
  const compiled = envelope?.compiledIntent;
  // Synchronous typed-chat envelopes do not run the async semantic compiler.
  // Their deterministic file operation still belongs to the canonical goal
  // executor, which supplies execution identity and verifies actual file bytes.
  const deterministicFileGoal = compiled?.action === 'OTHER' &&
    compiled.target === 'local_file_operation' && compiled.reason === 'Local file operation' &&
    compiled.isDirectCommand === true;
  return envelope?.structuredIntent?.executionMode === 'AUTONOMOUS_GOAL' ||
    compiled?.structuredIntent?.executionMode === 'AUTONOMOUS_GOAL' ||
    (compiled?.action as string) === 'AUTONOMOUS_GOAL' ||
    compiled?.structuredIntent?.goalIntent?.executionMode === 'AUTONOMOUS_GOAL' || deterministicFileGoal;
}
