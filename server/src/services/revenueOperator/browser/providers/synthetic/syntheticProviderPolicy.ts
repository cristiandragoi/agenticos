/**
 * syntheticProviderPolicy.ts — Policy configuration for Synthetic Revenue Provider.
 *
 * Scoped strictly to local loopback (127.0.0.1 and localhost).
 * Hard spending limit of 0 EUR.
 */

import type { ProviderAccountPolicy } from '../../types.js';

export function createSyntheticProviderPolicy(
  providerAccountId: string,
  overrides?: Partial<ProviderAccountPolicy>
): ProviderAccountPolicy {
  return {
    providerId: 'synthetic',
    providerAccountId,
    enabled: true,
    spendingLimit: 0, // Hard default: 0
    allowedDomains: [
      { domain: '127.0.0.1', allowSubdomains: false },
      { domain: 'localhost', allowSubdomains: false },
    ],
    allowedActionTypes: [
      'NAVIGATE',
      'READ_DOM',
      'SCROLL',
      'CLICK',
      'FORM_FILL',
      'WAIT',
      'VERIFY_STATE',
    ],
    hourlyActionLimit: 120,
    dailyActionLimit: 1000,
    unexpectedStateBehavior: 'GATE',
    knownStates: [
      'INITIALIZING',
      'AUTHENTICATED',
      'DASHBOARD',
      'TASK_BOARD',
      'TASK_RUNNING',
      'TASK_COMPLETED',
    ],
    knownLoginUrls: ['/login', '/auth'],
    ...overrides,
  };
}
