import { RunSummary, RunDiagnostics, GoalEvent, GoalRecord } from '../types.js';

export function computeRunSummary(goal: GoalRecord, events: GoalEvent[]): RunSummary {
  const startedAt = events.length > 0 ? events[0].timestamp : new Date().toISOString();
  const finishedAt = events.length > 0 ? events[events.length - 1].timestamp : new Date().toISOString();
  
  // Use timestamps only as a fallback for total duration
  const totalDurationMs = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
  
  const filesRead = events.filter(e => e.tool === 'readFile' && e.eventType === 'tool_completed').length;
  const filesModified = events.filter(e => e.tool === 'writeFile' && e.eventType === 'tool_completed').length;
  const commandsExecuted = events.filter(e => e.tool === 'runCommand' && e.eventType === 'tool_completed').length;
  
  const validationEvents = events.filter(e => e.eventType === 'validation_passed' || e.eventType === 'validation_failed');
  const validationStatus = validationEvents.length > 0 
    ? (validationEvents[validationEvents.length - 1].eventType === 'validation_passed' ? 'Passed' : 'Failed') 
    : 'Unknown';
  
  const retries = events.filter(e => e.lifecycleState === 'retrying').length;
  
  // 1. Prefer durationMs
  // 2. Fallback to correlation via operationId
  // 3. (Timestamp delta fallback is imprecise so we rely on operationId/durationMs)
  
  let maxDuration = 0;
  let longestOperation: RunDiagnostics['longestOperation'] = undefined;
  let modelCallMsTotal = 0;
  let modelCallCount = 0;

  const operationStarts = new Map<string, number>();

  for (const e of events) {
    if (e.eventType === 'tool_started' && e.operationId) {
      operationStarts.set(e.operationId, new Date(e.timestamp).getTime());
    }

    let currentOpDuration = e.durationMs || 0;

    if (!currentOpDuration && e.eventType === 'tool_completed' && e.operationId) {
      const startMs = operationStarts.get(e.operationId);
      if (startMs) {
        currentOpDuration = new Date(e.timestamp).getTime() - startMs;
      }
    }

    if (e.lifecycleState === 'planning' && e.durationMs) {
      modelCallMsTotal += e.durationMs;
      modelCallCount++;
    }

    if (currentOpDuration > maxDuration) {
      maxDuration = currentOpDuration;
      longestOperation = {
        eventId: e.goalId + "-" + e.sequence,
        eventType: e.eventType || ('unknown' as any),
        label: e.tool || e.eventType || 'Unknown',
        durationMs: maxDuration,
        tool: e.tool,
        filePath: e.filePath,
        command: e.command
      };
    }
  }

  const modelCalls = events.filter(e => e.lifecycleState === 'planning').length;
  const lastEvent = events[events.length - 1];
  
  return {
    runSummaryVersion: 1,
    runId: goal.id,
    startedAt,
    finishedAt,
    durationMs: totalDurationMs,
    status: goal.status,
    provider: lastEvent?.provider || 'Unknown',
    runtimeModel: lastEvent?.model || 'Unknown',
    filesRead,
    filesModified,
    commandsExecuted,
    validationStatus,
    retries,
    summary: lastEvent?.userMessage || lastEvent?.message || "Task finished.",
    changedFiles: [],
    finalUserMessage: lastEvent?.userMessage || "Task finished.",
    diagnostics: {
      totalEvents: events.length,
      totalModelCalls: modelCalls,
      totalToolCalls: events.filter(e => e.tool && e.eventType?.includes('tool')).length,
      totalRetries: retries,
      totalCommands: commandsExecuted,
      averageModelResponseMs: modelCallCount > 0 ? Math.floor(modelCallMsTotal / modelCallCount) : undefined,
      longestOperation
    }
  };
}
