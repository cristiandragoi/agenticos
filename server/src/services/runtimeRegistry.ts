import { logger } from '../utils/logger.js';
import type { RuntimeAdapter } from '../types.js';
import { normalizeCapability, DispatchError } from '../types/capabilities.js';

export interface CapabilityMatchResult {
  adapter: RuntimeAdapter;
  rejectedCandidates: Array<{ id: string; reason: string; missingCapabilities: string[] }>;
}

export interface CapabilitySelectOptions {
  preferredId?: string;
  excludedIds?: string[];
  policyRequired?: string[];
}

class RuntimeRegistry {
  private adapters: Map<string, RuntimeAdapter> = new Map();

  register(adapter: RuntimeAdapter): void {
    this.adapters.set(adapter.id, adapter);
    const caps = adapter.capabilities?.length ? adapter.capabilities.join(', ') : 'none declared';
    logger.info(`[Registry] Registered runtime adapter: ${adapter.id} (capabilities: ${caps})`);
  }

  getAdapter(runtimeId: string): RuntimeAdapter | undefined {
    return this.adapters.get(runtimeId);
  }

  listRuntimes(): { id: string; label: string; capabilities: string[] }[] {
    return Array.from(this.adapters.values()).map(a => ({
      id: a.id,
      label: a.label,
      capabilities: a.capabilities ?? [],
    }));
  }

  /**
   * Evaluates if a given adapter satisfies required capabilities.
   */
  adapterSatisfies(adapter: RuntimeAdapter, requiredCapabilities: string[]): { satisfied: boolean; missing: string[] } {
    if (!requiredCapabilities || requiredCapabilities.length === 0) {
      return { satisfied: true, missing: [] };
    }
    const adapterCaps = new Set((adapter.capabilities || []).map(normalizeCapability));
    const missing: string[] = [];

    for (const req of requiredCapabilities) {
      const norm = normalizeCapability(req);
      if (!adapterCaps.has(norm)) {
        missing.push(req);
      }
    }

    return {
      satisfied: missing.length === 0,
      missing,
    };
  }

  /**
   * Selects a compatible runtime adapter enforcing requiredCapabilities ⊆ adapterCapabilities.
   * If a preferred adapter is specified but incompatible, it records CAPABILITY_MISMATCH,
   * excludes it, and automatically picks the next compatible executor.
   */
  selectByCapabilities(
    required: string[],
    options: CapabilitySelectOptions = {}
  ): CapabilityMatchResult {
    const rejectedCandidates: Array<{ id: string; reason: string; missingCapabilities: string[] }> = [];
    const excluded = new Set(options.excludedIds || []);

    // 1. If a preferred adapter was requested, evaluate it first
    if (options.preferredId && !excluded.has(options.preferredId)) {
      const preferred = this.adapters.get(options.preferredId);
      if (preferred) {
        const check = this.adapterSatisfies(preferred, required);
        if (check.satisfied) {
          logger.info(`[Registry] Preferred adapter ${preferred.id} satisfies [${required.join(', ')}]`);
          return { adapter: preferred, rejectedCandidates };
        } else {
          logger.warn(`[Registry] Preferred adapter ${preferred.id} lacks required capabilities [${check.missing.join(', ')}] -> CAPABILITY_MISMATCH`);
          rejectedCandidates.push({
            id: preferred.id,
            reason: `CAPABILITY_MISMATCH: missing [${check.missing.join(', ')}]`,
            missingCapabilities: check.missing,
          });
          excluded.add(preferred.id);
        }
      }
    }

    // 2. Iterate through all registered adapters
    for (const adapter of this.adapters.values()) {
      if (excluded.has(adapter.id)) continue;

      const check = this.adapterSatisfies(adapter, required);
      if (check.satisfied) {
        logger.info(`[Registry] Capability match: ${adapter.id} satisfies [${required.join(', ')}]`);
        return { adapter, rejectedCandidates };
      } else {
        rejectedCandidates.push({
          id: adapter.id,
          reason: `CAPABILITY_MISMATCH: missing [${check.missing.join(', ')}]`,
          missingCapabilities: check.missing,
        });
      }
    }

    // 3. If no adapter found, throw structured DispatchError
    const available = Array.from(this.adapters.values()).map(a => ({
      id: a.id,
      caps: a.capabilities ?? [],
    }));

    throw new DispatchError(
      'NO_CAPABLE_RUNTIME',
      `No available runtime satisfies [${required.join(', ')}]. Rejected: ${rejectedCandidates.map(r => `${r.id} (${r.reason})`).join(', ')}`,
      { required, available, rejectedCandidates }
    );
  }
}

export const runtimeRegistry = new RuntimeRegistry();
