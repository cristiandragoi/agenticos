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

export function getEventExplanation(event: GoalEvent): string {
  if (event.eventType === 'tool_completed') {
    return `The tool '\${event.tool}' finished executing. CodeX is now reviewing the result before deciding whether another tool is required.`;
  }
  if (event.eventType === 'step_failed' || event.lifecycleState === 'retrying') {
    const reason = event.error || event.technicalMessage || 'an unknown error';
    if (event.retryCount && event.retryCount > 0) {
      return `The action failed because of \${reason}. CodeX is automatically retrying. No changes have been lost.`;
    }
    return `The action failed because of \${reason}. CodeX will attempt to recover.`;
  }
  if (event.lifecycleState === 'waiting_for_approval') {
    return "The planned changes require explicit user confirmation before proceeding.";
  }
  if (event.lifecycleState === 'planning') {
    return "CodeX is evaluating the current state of the workspace and formulating the next steps to achieve the goal.";
  }
  if (event.lifecycleState === 'running') {
    return `CodeX is actively executing the '\${event.tool}' tool to inspect or modify the workspace.`;
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
  const title = isTool ? `\${event.tool} \${event.filePath ? '- ' + event.filePath : ''}` : displayMessage;
  const badgeText = event.eventType ? event.eventType.replace(/_/g, ' ') : 'System Event';
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
