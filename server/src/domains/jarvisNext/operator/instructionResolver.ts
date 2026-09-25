import { logger } from '../../../utils/logger.js';

export interface ResolvedInstructionSet {
  rawInstructions: string[];
  AUTOMATIC: string[];
  APPROVAL_REQUIRED: string[];
  PROHIBITED: string[];
  SCHEDULED: string[];
  NOTIFICATION_RULE: string[];
}

export const KNOWN_FREE_CASH_RULES = [
  'No earning action automatically.',
  'Check the status once per day.',
  'Notify me if earnings change.',
  'Notify me if account status changes.',
  'Human approval required before any external action.',
];

/**
 * Resolves instructions for a project into structured execution policy categories.
 */
export function resolveInstructions(
  projectId: string,
  customRules?: string[]
): ResolvedInstructionSet {
  const rules = (customRules && customRules.length > 0)
    ? customRules
    : KNOWN_FREE_CASH_RULES;

  const result: ResolvedInstructionSet = {
    rawInstructions: [...rules],
    AUTOMATIC: [
      'Read-only project and opportunity inspection',
      'Integration connectivity and health probes',
      'Daily monitoring schedule execution',
      'Safe internal research and planning delegation',
    ],
    APPROVAL_REQUIRED: [],
    PROHIBITED: [],
    SCHEDULED: [],
    NOTIFICATION_RULE: [],
  };

  for (const rule of rules) {
    const lower = rule.toLowerCase();

    // Check once per day / frequency rules
    if (lower.includes('once per day') || lower.includes('once a day') || lower.includes('daily') || lower.includes('schedule')) {
      result.SCHEDULED.push(rule);
    }

    // Notification rules
    if (lower.includes('notify') || lower.includes('tell me') || lower.includes('alert') || lower.includes('report change')) {
      result.NOTIFICATION_RULE.push(rule);
    }

    // Earning / external actions requiring approval
    if (lower.includes('no earning action automatically') || lower.includes('human approval') || lower.includes('ask me before') || lower.includes('approval required')) {
      result.APPROVAL_REQUIRED.push(rule);
    }

    // Prohibited actions
    if (lower.includes('never') || lower.includes('prohibited') || lower.includes('no automated earning') || lower.includes('do not bypass')) {
      result.PROHIBITED.push(rule);
    }
  }

  logger.info('[JarvisNext:InstructionResolver] Resolved instructions for project:', {
    projectId,
    totalRules: rules.length,
    scheduled: result.SCHEDULED.length,
    notifications: result.NOTIFICATION_RULE.length,
    approvalRequired: result.APPROVAL_REQUIRED.length,
  });

  return result;
}
