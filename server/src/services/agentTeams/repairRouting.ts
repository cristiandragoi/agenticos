/**
 * Role-based repair routing for Agent Teams.
 *
 * The team sheet's `id` values are LLM-generated ("a2", "builder2", ...) and
 * must never be used for routing decisions. Repair targets are resolved from
 * the canonical `role` field, case-insensitively.
 */

export interface RepairTarget {
  agentId: string;
  index: number;
  reason: string;
}

/** Roles accepted as repair-capable, in preference order. */
const REPAIR_ROLES = ['builder', 'implementer', 'developer'];

export function findRepairTarget(teamSheet: any, missingArtifacts: string[] = []): RepairTarget | null {
  const agents: any[] = Array.isArray(teamSheet?.agents) ? teamSheet.agents : [];
  const sequence: string[] = Array.isArray(teamSheet?.executionSequence) ? teamSheet.executionSequence : [];

  const indexOf = (agentId: string) => {
    const idx = sequence.indexOf(agentId);
    return idx === -1 ? agents.findIndex(a => a.id === agentId) : idx;
  };

  // 1. Prefer an exact Builder role, then Implementer / Developer.
  for (const wanted of REPAIR_ROLES) {
    const match = agents.find(a => String(a?.role || '').trim().toLowerCase() === wanted);
    if (match) {
      return { agentId: match.id, index: indexOf(match.id), reason: `role '${match.role}'` };
    }
  }

  // 2. Fall back to the agent that declared a failed artifact as its output.
  if (missingArtifacts.length > 0) {
    const wanted = new Set(missingArtifacts);
    const producer = agents.find(a =>
      Array.isArray(a?.outputArtifacts) && a.outputArtifacts.some((p: string) => wanted.has(p))
    );
    if (producer) {
      return { agentId: producer.id, index: indexOf(producer.id), reason: `declared output artifact(s): ${missingArtifacts.join(', ')}` };
    }
  }

  // 3. No routable repair target.
  return null;
}
