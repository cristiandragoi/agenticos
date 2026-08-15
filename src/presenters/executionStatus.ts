import type { GoalEvent } from '../../server/src/types';
import { getToolLabel } from './EventPresenter';
import { CODEX_PROVIDER } from '../config/codexRuntime';

/**
 * Normalized run-status colors used across CodeX Studio:
 * - GREEN  = actively working
 * - BLUE   = completed
 * - YELLOW = waiting or processing
 * - PURPLE = reviewing / deciding next action
 * - RED    = failure or stopped
 * - GREY   = idle or unavailable
 */
export type RunStatusColor = 'green' | 'blue' | 'yellow' | 'purple' | 'red' | 'grey';

export type ConnectionState = 'idle_connected' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'backend_unreachable';

export interface CurrentActionInfo {
  color: RunStatusColor;
  statusLabel: string;
  message: string;
  isActive: boolean;
  agent: string;
  provider?: string;
  model?: string;
  tool?: string;
  filePath?: string;
  command?: string;
  nextAction: string;
  error?: string;
  executionProvider?: string;
  toolsRun?: number;
  filesChanged?: number;
}

export const TERMINAL_GOAL_STATES = ['completed', 'failed', 'stopped', 'cancelled', 'timed_out'];

export const RUN_STATUS_STYLES: Record<RunStatusColor, { dot: string; text: string; border: string; bg: string; ring: string }> = {
  green:  { dot: 'bg-emerald-500', text: 'text-emerald-400', border: 'border-emerald-500/40', bg: 'bg-emerald-500/10', ring: 'ring-emerald-500/30' },
  blue:   { dot: 'bg-blue-500',    text: 'text-blue-400',    border: 'border-blue-500/40',    bg: 'bg-blue-500/10',    ring: 'ring-blue-500/30' },
  yellow: { dot: 'bg-amber-500',   text: 'text-amber-400',   border: 'border-amber-500/40',   bg: 'bg-amber-500/10',   ring: 'ring-amber-500/30' },
  purple: { dot: 'bg-purple-500',  text: 'text-purple-400',  border: 'border-purple-500/40',  bg: 'bg-purple-500/10',  ring: 'ring-purple-500/30' },
  red:    { dot: 'bg-rose-500',    text: 'text-rose-400',    border: 'border-rose-500/40',    bg: 'bg-rose-500/10',    ring: 'ring-rose-500/30' },
  grey:   { dot: 'bg-slate-500',   text: 'text-slate-400',   border: 'border-slate-600/50',   bg: 'bg-slate-700/20',   ring: 'ring-slate-600/30' }
};

function lastEventWithTool(events: GoalEvent[]): GoalEvent | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].tool) return events[i];
  }
  return undefined;
}

function lastEventWithRuntime(events: GoalEvent[]): GoalEvent | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if ((e.provider && e.provider !== 'unknown') || (e.model && e.model !== 'unknown')) return e;
  }
  return undefined;
}

function toolActionPhrase(event: GoalEvent): string {
  const file = event.filePath || '';
  const cmd = event.command || '';
  switch (event.tool) {
    case 'readFile': return `Reading ${file || 'a file'}`;
    case 'writeFile': return `Writing ${file || 'a file'}`;
    case 'runCommand': return `Running ${cmd || 'a command'}`;
    case 'reasoningQuery': return 'Validating the previous result';
    case 'finish': return 'Finishing the task';
    default: return `Running ${getToolLabel(event.tool)}`;
  }
}

/**
 * Derive the single "what is CodeX doing right now" descriptor from the
 * goal status, the event history, and the SSE connection state.
 */
export function deriveCurrentAction(
  goalStatus: string | null,
  events: GoalEvent[],
  connectionState: ConnectionState
): CurrentActionInfo {
  const last = events.length > 0 ? events[events.length - 1] : undefined;
  const lastToolEvent = lastEventWithTool(events);
  const lastRuntimeEvent = lastEventWithRuntime(events);

  const base: CurrentActionInfo = {
    color: 'grey',
    statusLabel: 'Idle',
    message: 'No active execution. Describe a goal to begin.',
    isActive: false,
    agent: 'CodeX Agent',
    provider: lastRuntimeEvent?.provider || CODEX_PROVIDER,
    model: lastRuntimeEvent?.model || 'Unassigned',
    tool: lastToolEvent?.tool,
    filePath: lastToolEvent?.filePath,
    command: lastToolEvent?.command,
    nextAction: 'Waiting for a goal.'
  };

  if (!goalStatus) {
    if (connectionState === 'backend_unreachable') {
      return {
        ...base,
        color: 'red',
        statusLabel: 'Backend unavailable',
        message: 'CodeX backend is not reachable.',
        nextAction: 'Retry connection.'
      };
    }
    if (connectionState === 'connecting') {
      return {
        ...base,
        color: 'yellow',
        statusLabel: 'Connecting',
        message: 'Checking CodeX backend.',
        nextAction: 'Wait for backend health check.'
      };
    }
    if (connectionState === 'idle_connected' || connectionState === 'connected') {
      return {
        ...base,
        color: 'green',
        statusLabel: 'Ready',
        message: 'No active execution. Describe a goal to begin.',
        nextAction: 'Waiting for a goal.'
      };
    }
    return base;
  }

  // Connection loss never hides the run: show the last known action, flagged.
  if (connectionState === 'backend_unreachable') {
    return {
      ...base,
      color: 'red',
      statusLabel: 'Backend unavailable',
      message: last ? `${toolOrStatusPhrase(last)} (backend unreachable)` : 'CodeX backend is not reachable.',
      isActive: false,
      nextAction: 'Retry connection.',
      error: last?.error
    };
  }

  if (connectionState === 'disconnected') {
    return {
      ...base,
      color: 'grey',
      statusLabel: 'Disconnected',
      message: last ? `${toolOrStatusPhrase(last)} (connection lost — last known state)` : 'Connection lost. No events received yet.',
      isActive: false,
      nextAction: 'Reconnect the event stream to resume live updates.',
      error: last?.error
    };
  }

  const status = goalStatus.toLowerCase();

  if (status === 'waiting_for_approval' || status === 'waiting') {
    const localPlanEvent = [...events].reverse().find(
      e => e.eventType === 'planning_completed' && e.payload?.reasonCode === 'EXECUTION_PROVIDER_REQUIRED'
    );
    if (localPlanEvent) {
      return {
        ...base,
        color: 'blue',
        statusLabel: 'Plan Ready',
        message: 'Planning completed. Tool execution requires a capable provider.',
        nextAction: 'Choose an execution provider',
        provider:
          localPlanEvent.payload?.planningProvider ??
          localPlanEvent.provider,
        model:
          localPlanEvent.payload?.planningModel ??
          localPlanEvent.model,
        executionProvider: 'Not configured',
        toolsRun: localPlanEvent.payload?.toolsRun ?? 0,
        filesChanged: localPlanEvent.payload?.filesChanged ?? 0
      };
    }
  }

  if (status === 'completed') {
    return {
      ...base,
      color: 'blue',
      statusLabel: 'Completed',
      message: 'Task completed.',
      nextAction: 'Review the result summary below.'
    };
  }


  if (status === 'failed') {
    const lastError = [...events].reverse().find(e => e.error)?.error;
    return {
      ...base,
      color: 'red',
      statusLabel: 'Failed',
      message: 'Execution failed.',
      nextAction: 'Open the error details or resume the run.',
      error: lastError || last?.error
    };
  }

  if (status === 'stopped' || status === 'cancelled') {
    return {
      ...base,
      color: 'red',
      statusLabel: 'Stopped',
      message: 'Execution stopped.',
      nextAction: 'New Task, Resume when a checkpoint exists, or View logs.'
    };
  }

  if (status === 'paused' || status === 'pause_requested') {
    return {
      ...base,
      color: 'yellow',
      statusLabel: 'Paused',
      message: status === 'pause_requested' ? 'Pausing after the current step…' : 'Execution paused.',
      nextAction: 'Resume to continue from the last checkpoint.'
    };
  }

  if (status === 'stopping') {
    return {
      ...base,
      color: 'yellow',
      statusLabel: 'Stopping',
      message: 'Stopping execution...',
      nextAction: 'Wait for the backend to persist the stopped state.'
    };
  }

  if (status === 'waiting_for_approval' || last?.lifecycleState === 'waiting_for_approval') {
    return {
      ...base,
      color: 'yellow',
      statusLabel: 'Waiting',
      message: 'Waiting for your approval before continuing.',
      isActive: true,
      nextAction: 'Approve or reject the pending change.'
    };
  }

  // Active run — inspect the latest event for fine-grained state.
  if (last) {
    if (last.lifecycleState === 'retrying' || last.eventType === 'retry_started') {
      return {
        ...base,
        color: 'yellow',
        statusLabel: 'Retrying',
        message: last.errorCode === 'CODEX_TOOL_PARSE_FAILED'
          ? 'The model returned invalid tool JSON. Retrying once…'
          : 'Retrying after a failure…',
        isActive: true,
        nextAction: 'Retry the model request with strict instructions.',
        error: last.error
      };
    }

    // A finished tool means the engine is reviewing the result and
    // deciding the next step — checked before the generic running branch
    // because tool_completed events still carry lifecycleState 'running'.
    if (last.eventType === 'tool_completed' || last.eventType === 'agent_completed' || last.normalizedStatus === 'completed') {
      return {
        ...base,
        color: 'purple',
        statusLabel: 'Reviewing',
        message: 'Reviewing the previous result and deciding the next step',
        isActive: true,
        nextAction: 'Select the next tool to run.'
      };
    }

    if (last.eventType === 'tool_started' || (last.lifecycleState === 'running' && last.tool)) {
      return {
        ...base,
        color: 'green',
        statusLabel: 'Working',
        message: toolActionPhrase(last),
        isActive: true,
        tool: last.tool || base.tool,
        filePath: last.filePath || base.filePath,
        command: last.command || base.command,
        nextAction: 'Review the tool result and decide the next step.'
      };
    }

    if (last.eventType === 'model_request_started' || last.eventType === 'planning_started') {
      const providerLabel = last.provider && !['unassigned', 'auto'].includes(last.provider) ? last.provider : 'model';
      return {
        ...base,
        color: 'yellow',
        statusLabel: 'Waiting',
        message: `Waiting for ${providerLabel} response`,
        isActive: true,
        nextAction: 'Parse the model response and run the next tool.'
      };
    }

    if (last.lifecycleState === 'planning' || last.normalizedStatus === 'planning' || last.eventType === 'validation_started') {
      return {
        ...base,
        color: 'purple',
        statusLabel: 'Reviewing',
        message: 'Reviewing the previous result and deciding the next step',
        isActive: true,
        nextAction: 'Select the next tool to run.'
      };
    }
  }

  // Default for an active run with no better signal.
  return {
    ...base,
    color: 'green',
    statusLabel: 'Working',
    message: last ? toolOrStatusPhrase(last) : 'Starting execution…',
    isActive: true,
    nextAction: 'Continue executing the plan.'
  };
}

function toolOrStatusPhrase(event: GoalEvent): string {
  if (event.tool) return toolActionPhrase(event);
  return event.userMessage || event.message || 'Working…';
}

/* ── Tool execution pairing ─────────────────────────────── */

export type ToolExecutionState = 'queued' | 'running' | 'completed' | 'failed';

export interface ToolExecution {
  id: string;
  tool: string;
  state: ToolExecutionState;
  filePath?: string;
  command?: string;
  args?: string;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  summary: string;
  input?: string;
  output?: string;
  error?: string;
  startSequence: number;
  endSequence?: number;
}

/**
 * Pair tool_started events with their matching completion/failure event
 * to build one ToolExecution card per tool call.
 */
export function pairToolExecutions(events: GoalEvent[], runIsActive: boolean): ToolExecution[] {
  const executions: ToolExecution[] = [];

  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (e.eventType !== 'tool_started') continue;

    const startedAtMs = new Date(e.timestamp).getTime();
    let match: GoalEvent | undefined;

    for (let j = i + 1; j < events.length; j++) {
      const candidate = events[j];
      if (candidate.eventType === 'tool_started') break; // superseded by a newer tool call
      const isCompletion = candidate.eventType === 'tool_completed' || candidate.eventType === 'agent_completed';
      const isFailure = candidate.eventType === 'step_failed' || candidate.eventType === 'task_failed';
      if (!isCompletion && !isFailure) continue;
      if (candidate.tool && e.tool && candidate.tool !== e.tool) continue;
      match = candidate;
      break;
    }

    const failed = !!match && (match.eventType === 'step_failed' || match.eventType === 'task_failed' || !!match.error);
    const finishedAtMs = match ? new Date(match.timestamp).getTime() : undefined;

    let summary = '';
    if (match) {
      summary = failed
        ? (match.error || match.message || 'Tool failed.')
        : (match.message || match.userMessage || 'Tool finished.');
      if (summary.startsWith('Tool Result:')) summary = summary.replace(/^Tool Result:\n?/, '');
    } else {
      summary = runIsActive ? 'Running…' : 'Interrupted before completion.';
    }

    executions.push({
      id: `${e.goalId}-${e.sequence}`,
      tool: e.tool || 'unknown',
      state: match ? (failed ? 'failed' : 'completed') : (runIsActive ? 'running' : 'failed'),
      filePath: e.filePath,
      command: e.command,
      startedAt: e.timestamp,
      finishedAt: match?.timestamp,
      durationMs: match?.durationMs ?? (finishedAtMs && !isNaN(startedAtMs) ? Math.max(0, finishedAtMs - startedAtMs) : undefined),
      summary,
      input: e.technicalMessage || e.message,
      output: match?.technicalMessage || match?.message,
      error: failed ? (match?.error || 'Tool execution failed.') : undefined,
      startSequence: e.sequence,
      endSequence: match?.sequence
    });
  }

  return executions;
}