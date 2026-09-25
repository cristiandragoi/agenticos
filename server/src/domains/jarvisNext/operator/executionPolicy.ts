export type ActionCategory = 'SAFE_INTERNAL' | 'EXTERNAL_APPROVAL_REQUIRED' | 'PROHIBITED';

export interface ActionEvaluation {
  actionName: string;
  category: ActionCategory;
  canExecuteAutomatically: boolean;
  reason: string;
}

const SAFE_INTERNAL_PATTERNS = [
  'read_memory',
  'read_project_data',
  'check_integration_health',
  'retrieve_read_only_status',
  'analyze_opportunities',
  'research',
  'plan',
  'create_task',
  'schedule_monitoring',
  'delegate_hermes',
  'delegate_codex_internal',
  'run_tests',
  'update_internal_status',
  'list_opportunities',
  'probe_status',
];

const EXTERNAL_APPROVAL_PATTERNS = [
  'submit_survey',
  'complete_earning_action',
  'spend_money',
  'accept_offer',
  'change_account_settings',
  'send_external_message',
  'publish',
  'make_purchase',
  'transfer_funds',
  'irreversible_external_action',
];

const PROHIBITED_PATTERNS = [
  'bypass_captcha',
  'bypass_kyc',
  'impersonate_user',
  'evade_antibot',
];

export function evaluateActionPolicy(actionName: string): ActionEvaluation {
  const normalized = actionName.toLowerCase().replace(/[\s\-]/g, '_');

  for (const p of PROHIBITED_PATTERNS) {
    if (normalized.includes(p)) {
      return {
        actionName,
        category: 'PROHIBITED',
        canExecuteAutomatically: false,
        reason: 'Security & Safety Violation: Action is strictly prohibited by platform invariants.',
      };
    }
  }

  for (const p of EXTERNAL_APPROVAL_PATTERNS) {
    if (normalized.includes(p)) {
      return {
        actionName,
        category: 'EXTERNAL_APPROVAL_REQUIRED',
        canExecuteAutomatically: false,
        reason: 'Approval boundary crossed: External earning or account actions require explicit human authorization.',
      };
    }
  }

  return {
    actionName,
    category: 'SAFE_INTERNAL',
    canExecuteAutomatically: true,
    reason: 'Safe internal operational task: permitted to execute without human approval.',
  };
}
