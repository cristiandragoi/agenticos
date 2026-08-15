import type { GoalEvent, EventCategory } from '../../server/src/types';

export type EventIconKey = 
  | 'planning'
  | 'tool'
  | 'file'
  | 'terminal'
  | 'validation'
  | 'warning'
  | 'error'
  | 'completed'
  | 'system';

export interface PresentedEventDetails {
  input?: string;
  output?: string;
  error?: string;
}

export interface PresentedEvent {
  iconKey: EventIconKey;
  colorClass: string;
  borderClass: string;
  backgroundClass: string;
  badgeText: string;
  title: string;
  description: string;
  explanation: string;
  category: EventCategory;
  searchableText: string;
  expandableDetails?: PresentedEventDetails;
}

export function getStatusPresentation(status: string) {
  switch(status) {
    case 'active': return { backgroundClass: 'bg-[#091E16]', borderClass: 'border-emerald-500/30', colorClass: 'text-emerald-400' };
    case 'completed': return { backgroundClass: 'bg-[#0D1829]', borderClass: 'border-blue-500/30', colorClass: 'text-blue-400' };
    case 'attention': return { backgroundClass: 'bg-[#2A1F16]', borderClass: 'border-amber-500/30', colorClass: 'text-amber-400' };
    case 'planning': return { backgroundClass: 'bg-[#1B162B]', borderClass: 'border-purple-500/30', colorClass: 'text-purple-400' };
    case 'failed': return { backgroundClass: 'bg-[#251016]', borderClass: 'border-rose-500/30', colorClass: 'text-rose-400' };
    case 'idle': default: return { backgroundClass: 'bg-[#111823]', borderClass: 'border-slate-700/50', colorClass: 'text-slate-400' };
  }
}

export function getEventCategory(event: GoalEvent): EventCategory {
  if (event.lifecycleState === 'planning') return 'planning';
  if (event.tool === 'readFile' || event.tool === 'writeFile') return 'file';
  if (event.tool === 'runCommand') return 'command';
  if (event.tool === 'reasoningQuery') return 'validation';
  if (event.eventType?.includes('tool')) return 'tool';
  if (event.error || event.normalizedStatus === 'failed') return 'error';
  if (event.lifecycleState === 'retrying' || event.normalizedStatus === 'attention') return 'warning';
  return 'system';
}

export function getIconKey(event: GoalEvent): EventIconKey {
  if (event.normalizedStatus === 'failed') return 'error';
  if (event.normalizedStatus === 'attention') return 'warning';
  if (event.normalizedStatus === 'completed') return 'completed';
  if (event.tool === 'readFile' || event.tool === 'writeFile') return 'file';
  if (event.tool === 'runCommand') return 'terminal';
  if (event.tool === 'reasoningQuery') return 'validation';
  if (event.lifecycleState === 'planning') return 'planning';
  if (event.eventType?.includes('tool')) return 'tool';
  return 'system';
}

/** Human-readable label for a tool name. */
export function getToolLabel(tool?: string): string {
  switch (tool) {
    case 'readFile': return 'Read File';
    case 'writeFile': return 'Write File';
    case 'runCommand': return 'Run Command';
    case 'reasoningQuery': return 'Reasoning Query';
    case 'finish': return 'Finish';
    default: return tool || 'Tool';
  }
}

/**
 * Hermes-style readable activity phrase for an event.
 * Always renders real values — never raw template expressions.
 */
export function getActivityPhrase(event: GoalEvent): string {
  const file = event.filePath || '';
  const cmd = event.command || '';

  if (event.eventType === 'planning_completed' && event.payload?.reasonCode === 'EXECUTION_PROVIDER_REQUIRED') {
    return 'Local planning completed. Tool execution requires a capable execution provider — assign one in Run Settings.';
  }

  if (event.errorCode === 'CODEX_TOOL_PARSE_FAILED') {
    if (event.lifecycleState === 'retrying' || event.normalizedStatus === 'attention') {
      return 'The local model did not return valid tool JSON. Retrying once with strict instructions…';
    }
    return 'Execution stopped because the model response was invalid after retry.';
  }


  switch (event.eventType) {
    case 'task_resumed': return 'Resuming the task from the last checkpoint…';
    case 'task_started': return 'Starting execution…';
    case 'planning_started': {
      const providerLabel = event.provider && !['unassigned', 'auto'].includes(event.provider) ? event.provider : 'model';
      return `Waiting for the ${providerLabel} response…`;
    }
    case 'model_request_started': return 'Waiting for the model response…';
    case 'model_request_completed': return 'The model responded.';
    case 'model_request_timed_out': return 'The model did not respond in time.';
    case 'retry_started': return 'Retrying the previous step…';
    case 'tool_started': {
      if (event.tool === 'readFile') return `Reading ${file || 'a file'}…`;
      if (event.tool === 'writeFile') return `Writing ${file || 'a file'}…`;
      if (event.tool === 'runCommand') return `Running ${cmd || 'a command'}…`;
      if (event.tool === 'reasoningQuery') return 'Consulting the validation provider…';
      if (event.tool === 'finish') return 'Finishing the task…';
      return `Running ${getToolLabel(event.tool)}…`;
    }
    case 'tool_completed': {
      if (event.tool === 'readFile') return `Found ${file || 'the file'}.`;
      if (event.tool === 'writeFile') return `Saved ${file || 'the file'}.`;
      if (event.tool === 'runCommand') return event.error ? 'The command failed.' : 'The command finished.';
      if (event.tool === 'reasoningQuery') return 'The validation provider responded.';
      if (event.tool === 'finish') return 'Task completed.';
      return `${getToolLabel(event.tool)} finished.`;
    }
    case 'validation_started': return 'Evaluating the result with the validation provider…';
    case 'validation_passed': return 'Validation passed.';
    case 'validation_failed': return 'Validation failed.';
    case 'approval_requested': return 'Waiting for your approval before continuing…';
    case 'approval_received': return 'Approval received. Continuing…';
    case 'checkpoint_written': return 'Checkpoint saved.';
    case 'artifact_created': return `Artifact verified${file ? `: ${file}` : '.'}`;
    case 'handoff_created': return 'Handoff payload generated.';
    case 'verification_completed': return 'Verification report generated.';
    case 'agent_completed': return 'Task completed.';
    case 'task_completed': return 'Task completed.';
    case 'task_failed': return 'Execution failed.';
    case 'task_paused': return 'Execution paused.';
    case 'task_stopped': return 'Execution stopped.';
    case 'step_failed': return event.error ? `Step failed: ${event.error}` : 'A step failed. CodeX will try to recover.';
    default: break;
  }

  if (event.lifecycleState === 'waiting_for_approval') return 'Waiting for your approval before continuing…';
  if (event.lifecycleState === 'retrying') return 'Retrying after a failure…';
  if (event.lifecycleState === 'planning') return 'Reviewing the previous result and deciding the next step…';

  return event.userMessage || event.message || 'System event recorded during execution.';
}

/** Readable label for an event type badge — never a raw snake_case name when a translation exists. */
export function getEventBadge(event: GoalEvent): string {
  switch (event.eventType) {
    case 'task_started': return 'Start';
    case 'task_resumed': return 'Resume';
    case 'planning_started': return 'Planning';
    case 'model_request_started': return 'Model';
    case 'model_request_completed': return 'Model';
    case 'model_request_timed_out': return 'Model';
    case 'retry_started': return 'Retry';
    case 'tool_started': return 'Tool';
    case 'tool_completed': return 'Tool';
    case 'validation_started': return 'Validation';
    case 'validation_passed': return 'Validation';
    case 'validation_failed': return 'Validation';
    case 'approval_requested': return 'Approval';
    case 'approval_received': return 'Approval';
    case 'checkpoint_written': return 'Checkpoint';
    case 'artifact_created': return 'Artifact';
    case 'handoff_created': return 'Handoff';
    case 'verification_completed': return 'Verification';
    case 'agent_completed': return 'Completed';
    case 'task_completed': return 'Completed';
    case 'task_failed': return 'Failed';
    case 'task_paused': return 'Paused';
    case 'task_stopped': return 'Stopped';
    case 'step_failed': return 'Error';
    default:
      return event.eventType ? event.eventType.replace(/_/g, ' ') : 'System';
  }
}

export function getEventExplanation(event: GoalEvent): string {
  const toolLabel = getToolLabel(event.tool);
  if (event.eventType === 'tool_completed') {
    return `The '${toolLabel}' tool finished executing. CodeX is now reviewing the result before deciding whether another tool is required.`;
  }
  if (event.eventType === 'step_failed' || event.lifecycleState === 'retrying') {
    const reason = event.error || event.technicalMessage || 'an unknown error';
    if (event.retryCount && event.retryCount > 0) {
      return `The action failed because of ${reason}. CodeX is automatically retrying. No changes have been lost.`;
    }
    return `The action failed because of ${reason}. CodeX will attempt to recover.`;
  }
  if (event.lifecycleState === 'waiting_for_approval') {
    return "The planned changes require explicit user confirmation before proceeding.";
  }
  if (event.lifecycleState === 'planning') {
    return "CodeX is evaluating the current state of the workspace and formulating the next steps to achieve the goal.";
  }
  if (event.lifecycleState === 'running') {
    return `CodeX is actively executing the '${toolLabel}' tool to inspect or modify the workspace.`;
  }
  if (event.lifecycleState === 'failed') {
    return "A critical error occurred that prevented CodeX from continuing. Please review the error details.";
  }
  return "System event recorded during execution.";
}

export function presentEvent(event: GoalEvent, previousEvent?: GoalEvent): PresentedEvent {
  const status = event.normalizedStatus || 'idle';
  const colors = getStatusPresentation(status);
  const iconKey = getIconKey(event);
  const category = getEventCategory(event);
  
  const isTool = event.eventType?.includes('tool');
  const displayMessage = event.userMessage || event.message || event.technicalMessage || '';
  const toolTarget = event.filePath || event.command || '';
  const title = isTool
    ? `${getToolLabel(event.tool)}${toolTarget ? ` — ${toolTarget}` : ''}`
    : (displayMessage || getActivityPhrase(event));
  const badgeText = getEventBadge(event);
  const explanation = getEventExplanation(event);

  let input = '';
  if (event.eventType === 'tool_completed' && previousEvent?.eventType === 'tool_started') {
    input = previousEvent.technicalMessage || previousEvent.message || '';
  }

  const searchableText = [
    event.userMessage,
    event.technicalMessage,
    event.tool,
    event.filePath,
    event.command,
    event.provider,
    event.model,
    event.error,
    event.eventType,
    title,
    explanation
  ].filter(Boolean).join(' ').toLowerCase();

  return {
    iconKey,
    ...colors,
    badgeText,
    title,
    description: displayMessage,
    explanation,
    category,
    searchableText,
    expandableDetails: {
      input,
      output: event.technicalMessage,
      error: event.error
    }
  };
}
