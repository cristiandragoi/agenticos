export interface BuildCodexGoalPayloadInput {
  goal: string;
  repositoryRoot: string;
  approvalPolicy: string;
  validationProvider?: string | null;
  assignment?: {
    providerId: string;
    modelId?: string | null;
    routingMode: 'automatic' | 'preferred' | 'forced';
    enabled: boolean;
  } | null;
  explicitRoutingOverride?: boolean;
  executionProviderId?: string;
}

export function buildCodexGoalPayload(input: BuildCodexGoalPayloadInput): any {
  const payload: any = {
    goal: input.goal,
    repositoryRoot: input.repositoryRoot,
    approvalPolicy: input.approvalPolicy || 'auto',
    agentId: 'agent-codex'
  };

  if (input.validationProvider && input.validationProvider !== 'auto') {
    payload.validationProvider = input.validationProvider;
  }

  if (input.explicitRoutingOverride && input.assignment && input.assignment.enabled && input.assignment.routingMode !== 'automatic') {
    payload.routing = {
      mode: input.assignment.routingMode,
      providerId: input.assignment.providerId,
      modelId: input.assignment.modelId || null
    };

    if (input.assignment.routingMode === 'forced') {
      payload.executionOptions = {
        disableFallback: true
      };
    }
  }

  if (input.executionProviderId) {
    payload.executionOptions = payload.executionOptions || {};
    payload.executionOptions.executionProviderId = input.executionProviderId;
  }

  return payload;
}
