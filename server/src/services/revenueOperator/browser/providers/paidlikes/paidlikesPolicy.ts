/**
 * PaidLikes Provider Policy.
 * Enforces strict domain allowlists, routine allowed action types,
 * zero spending limits, and mandatory human gates for CAPTCHA/KYC/Payouts.
 */

import type { ProviderAccountPolicy } from '../../types.js';

export function createPaidLikesPolicy(providerAccountId: string): ProviderAccountPolicy {
  return {
    providerId: 'paidlikes',
    providerAccountId,
    enabled: true,
    spendingLimit: 0, // Strict zero spending limit

    // Allowed domains (PaidLikes + required external platform domains for supported canary tasks)
    allowedDomains: [
      { domain: 'paidlikes.de', allowSubdomains: true },
      { domain: 'youtube.com', allowSubdomains: true },
      { domain: 'youtu.be', allowSubdomains: true },
    ],

    // Allowed external redirects needed to reach supported tasks
    allowedRedirectDomains: [
      { domain: 'youtube.com', allowSubdomains: true },
      { domain: 'youtu.be', allowSubdomains: true },
      { domain: 'paidlikes.de', allowSubdomains: true },
    ],

    // Permitted autonomous routine action types
    allowedActionTypes: [
      'NAVIGATE',
      'CLICK',
      'READ_DOM',
      'SCROLL',
      'WAIT',
      'VERIFY_STATE',
      'FORM_FILL',
    ],

    // Action-specific rate limits matching PaidLikes platform guidelines (max 15 likes/hr, 40 likes/day)
    actionRules: {
      CLICK: {
        allowed: true,
        maxPerHour: 15,
        maxPerDay: 40,
      },
      NAVIGATE: {
        allowed: true,
        maxPerHour: 60,
        maxPerDay: 200,
      },
      FORM_FILL: {
        allowed: true,
        maxPerHour: 5,
        maxPerDay: 10,
      },
    },

    hourlyActionLimit: 30,
    dailyActionLimit: 80,
    minuteActionLimit: 5,

    // Unexpected states must pause for gate rather than guess or crash
    unexpectedStateBehavior: 'GATE',

    knownLoginUrls: [
      'https://www.paidlikes.de/login',
      'https://paidlikes.de/login',
    ],

    knownStates: [
      'LOGIN',
      'MEMBERAREA',
      'TASK_LIST',
      'EXTERNAL_TASK',
      'VERIFYING',
    ],

    tracingMode: true,
  };
}
