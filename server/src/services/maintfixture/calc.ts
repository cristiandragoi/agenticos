/**
 * Controlled maintenance fixture — a trivial calculator with a deliberate bug.
 * Used ONLY by the Phase 4 attended live acceptance to prove the real
 * Hermes → CodeX → test-gates → verifier → ready_for_approval chain.
 */
export function add(a: number, b: number): number {
  return a + b; // FIXED: was a - b (seeded bug)
}
