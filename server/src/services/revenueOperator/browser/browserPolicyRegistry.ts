/**
 * browserPolicyRegistry.ts — In-memory and configuration registry for provider account policies.
 *
 * Enforces hard architectural defaults:
 * - spendingLimit = 0
 * - hourlyActionLimit = 120
 * - dailyActionLimit = 1000
 * - routine actions: NAVIGATE, READ_DOM, SCROLL, CLICK, FORM_FILL, WAIT, VERIFY_STATE
 * - unexpectedStateBehavior = 'GATE'
 */

import type { ProviderAccountPolicy, RoutineActionType } from './types.js';

export const DEFAULT_ROUTINE_ACTIONS: RoutineActionType[] = [
  'NAVIGATE',
  'READ_DOM',
  'SCROLL',
  'CLICK',
  'FORM_FILL',
  'WAIT',
  'VERIFY_STATE',
];

export function createDefaultPolicy(
  providerId: string,
  providerAccountId: string,
  overrides?: Partial<ProviderAccountPolicy>
): ProviderAccountPolicy {
  return {
    providerId,
    providerAccountId,
    enabled: true,
    spendingLimit: 0, // Hard default: 0
    allowedDomains: [],
    allowedActionTypes: [...DEFAULT_ROUTINE_ACTIONS],
    hourlyActionLimit: 120,
    dailyActionLimit: 1000,
    unexpectedStateBehavior: 'GATE',
    ...overrides,
  };
}

export class BrowserPolicyRegistry {
  private policies = new Map<string, ProviderAccountPolicy>();

  private key(providerId: string, providerAccountId: string): string {
    return `${providerId}:::${providerAccountId}`;
  }

  /**
   * Register or overwrite a policy for a provider account.
   */
  registerPolicy(policy: ProviderAccountPolicy): void {
    const key = this.key(policy.providerId, policy.providerAccountId);
    this.policies.set(key, { ...policy });
  }

  /**
   * Retrieve the policy for a given provider and provider account.
   */
  getPolicy(providerId: string, providerAccountId: string): ProviderAccountPolicy | undefined {
    return this.policies.get(this.key(providerId, providerAccountId));
  }

  /**
   * Get an existing policy, or create and register a default policy with overrides.
   */
  getOrCreateDefaultPolicy(
    providerId: string,
    providerAccountId: string,
    overrides?: Partial<ProviderAccountPolicy>
  ): ProviderAccountPolicy {
    const existing = this.getPolicy(providerId, providerAccountId);
    if (existing) {
      if (overrides) {
        const updated = { ...existing, ...overrides };
        this.registerPolicy(updated);
        return updated;
      }
      return existing;
    }
    const created = createDefaultPolicy(providerId, providerAccountId, overrides);
    this.registerPolicy(created);
    return created;
  }

  /**
   * Remove a policy from the registry.
   */
  removePolicy(providerId: string, providerAccountId: string): boolean {
    return this.policies.delete(this.key(providerId, providerAccountId));
  }

  /**
   * Clear all registered policies.
   */
  clear(): void {
    this.policies.clear();
  }
}

export const browserPolicyRegistry = new BrowserPolicyRegistry();
