/**
 * capabilities.ts — Authoritative Closed-World Capability Model for Jarvis V2.
 *
 * All capabilities known to the system are registered here.
 * Separates:
 *   - registered: capability exists in system definition
 *   - available: capability is currently eligible for execution (derived from health & policy)
 *   - health: live runtime status ('healthy' | 'unhealthy' | 'unknown')
 *
 * Invariants:
 * 1. A tool is NEVER claimed to have failed unless registered, invoked, and returned an error.
 * 2. An unavailable capability is NOT a failed capability.
 * 3. Direct browser and terminal operations are explicitly marked unavailable for Jarvis.
 * 4. Delegation requires the target worker to be healthy before proposing or executing tasks.
 */

export type HealthStatus = 'healthy' | 'unhealthy' | 'unknown';

export interface CapabilityRecord {
  id: string;
  name: string;
  executionOwner: string;
  registered: boolean;
  available: boolean;
  health: HealthStatus;
  requiresApproval: boolean;
  readOnly: boolean;
  description: string;
  detail?: string;
}

// In-memory test override for simulated health in tests
const healthOverrides = new Map<string, HealthStatus>();

export function setWorkerHealthOverride(worker: string, status: HealthStatus | null): void {
  const key = worker.toLowerCase();
  if (status === null) {
    healthOverrides.delete(key);
  } else {
    healthOverrides.set(key, status);
  }
}

export function getWorkerHealthOverride(worker: string): HealthStatus | undefined {
  return healthOverrides.get(worker.toLowerCase());
}

export const V2_CAPABILITY_REGISTRY: Record<string, CapabilityRecord> = {
  'memory.read': {
    id: 'memory.read',
    name: 'Memory Read',
    executionOwner: 'AgenticOS',
    registered: true,
    available: true,
    health: 'healthy',
    requiresApproval: false,
    readOnly: true,
    description: 'Read persistent user memory, preferences, and decisions.'
  },
  'project.read': {
    id: 'project.read',
    name: 'Project Store Read',
    executionOwner: 'AgenticOS',
    registered: true,
    available: true,
    health: 'healthy',
    requiresApproval: false,
    readOnly: true,
    description: 'Read authoritative project priorities and active projects.'
  },
  'revenueOperator.read': {
    id: 'revenueOperator.read',
    name: 'Revenue Operator Store Read',
    executionOwner: 'AgenticOS',
    registered: true,
    available: true,
    health: 'healthy',
    requiresApproval: false,
    readOnly: true,
    description: 'Read revenue opportunities, active missions, and experiment data.'
  },
  'hermes.delegate': {
    id: 'hermes.delegate',
    name: 'Hermes Delegation',
    executionOwner: 'Hermes',
    registered: true,
    available: false, // health-derived dynamically
    health: 'unknown',
    requiresApproval: true,
    readOnly: false,
    description: 'Delegate deep planning, research, architectural strategy, and multi-agent coordination.'
  },
  'codex.delegate': {
    id: 'codex.delegate',
    name: 'CodeX Delegation',
    executionOwner: 'Codex',
    registered: true,
    available: false, // health-derived dynamically
    health: 'unknown',
    requiresApproval: true,
    readOnly: false,
    description: 'Delegate repository inspection, code modifications, bug fixes, and tests.'
  },
  'browser.direct': {
    id: 'browser.direct',
    name: 'Direct Browser Control',
    executionOwner: 'NONE/Jarvis',
    registered: true,
    available: false,
    health: 'unhealthy',
    requiresApproval: true,
    readOnly: false,
    description: 'Jarvis does not directly execute browser operations. Browser tasks belong to worker capabilities.'
  },
  'terminal.direct': {
    id: 'terminal.direct',
    name: 'Direct Terminal Execution',
    executionOwner: 'NONE/Jarvis',
    registered: true,
    available: false,
    health: 'unhealthy',
    requiresApproval: true,
    readOnly: false,
    description: 'Jarvis does not directly execute terminal commands. Terminal operations belong to CodeX.'
  }
};

/**
 * Probes Hermes gateway health using the authoritative hermesApiService.
 */
export async function checkHermesHealth(): Promise<{ healthy: boolean; status: HealthStatus; detail: string }> {
  const override = getWorkerHealthOverride('hermes');
  if (override !== undefined) {
    return {
      healthy: override === 'healthy',
      status: override,
      detail: `Simulated Hermes status: ${override}`
    };
  }

  try {
    const { hermesApiService } = await import('../../services/hermesApiService.js');
    const status = await hermesApiService.getStatus();
    if (status.reachable) {
      return {
        healthy: true,
        status: 'healthy',
        detail: status.detail || 'Hermes service reachable'
      };
    } else {
      return {
        healthy: false,
        status: 'unhealthy',
        detail: status.detail || 'Hermes service unreachable'
      };
    }
  } catch (err: any) {
    return {
      healthy: false,
      status: 'unknown',
      detail: `Hermes health check failed: ${err?.message || 'unknown error'}`
    };
  }
}

/**
 * Probes Codex Bridge health.
 */
export async function checkCodexHealth(): Promise<{ healthy: boolean; status: HealthStatus; detail: string }> {
  const override = getWorkerHealthOverride('codex');
  if (override !== undefined) {
    return {
      healthy: override === 'healthy',
      status: override,
      detail: `Simulated Codex status: ${override}`
    };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1200);
    const res = await fetch('http://127.0.0.1:20130/v1/models', { signal: controller.signal });
    clearTimeout(timeout);
    if (res.ok) {
      return {
        healthy: true,
        status: 'healthy',
        detail: 'Codex Bridge online on port 20130'
      };
    } else {
      return {
        healthy: false,
        status: 'unhealthy',
        detail: `Codex Bridge HTTP status: ${res.status}`
      };
    }
  } catch (err: any) {
    return {
      healthy: false,
      status: 'unhealthy',
      detail: `Codex Bridge offline: ${err?.message || 'connection refused'}`
    };
  }
}

/**
 * Get capability record synchronously (using static / last-known values).
 */
export function getCapability(id: string): CapabilityRecord | null {
  return V2_CAPABILITY_REGISTRY[id] || null;
}

/**
 * Get capability record with live health resolution for worker capabilities.
 */
export async function getCapabilityLive(id: string): Promise<CapabilityRecord | null> {
  const base = V2_CAPABILITY_REGISTRY[id];
  if (!base) return null;

  if (id === 'hermes.delegate') {
    const health = await checkHermesHealth();
    return {
      ...base,
      health: health.status,
      available: health.healthy,
      detail: health.detail
    };
  }

  if (id === 'codex.delegate') {
    const health = await checkCodexHealth();
    return {
      ...base,
      health: health.status,
      available: health.healthy,
      detail: health.detail
    };
  }

  return { ...base };
}

/**
 * Lists all registered capabilities with live health status.
 */
export async function listCapabilitiesLive(): Promise<CapabilityRecord[]> {
  const keys = Object.keys(V2_CAPABILITY_REGISTRY);
  const results = await Promise.all(keys.map(k => getCapabilityLive(k)));
  return results.filter(Boolean) as CapabilityRecord[];
}

export function listCapabilities(): CapabilityRecord[] {
  return Object.values(V2_CAPABILITY_REGISTRY);
}

/**
 * Validates a capability claim against the closed-world model.
 */
export function validateCapabilityClaim(
  capabilityId: string,
  invoked: boolean,
  error?: string | null
): { allowedToClaimFailure: boolean; explanation: string } {
  const cap = getCapability(capabilityId);
  if (!cap) {
    return {
      allowedToClaimFailure: false,
      explanation: `That capability is not available directly in this Jarvis session.`
    };
  }

  if (!cap.available) {
    return {
      allowedToClaimFailure: false,
      explanation: `That capability is not available directly in this Jarvis session.`
    };
  }

  if (!invoked) {
    return {
      allowedToClaimFailure: false,
      explanation: `The tool was not invoked; cannot make a failure claim.`
    };
  }

  if (error) {
    return {
      allowedToClaimFailure: true,
      explanation: `The tool call failed: ${error}`
    };
  }

  return {
    allowedToClaimFailure: false,
    explanation: `The tool was invoked successfully.`
  };
}
