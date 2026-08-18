import type { GoalEvent } from '../../server/src/types';

export function normalizeExecutionEvent(rawEvent: any): GoalEvent {
  // Enforce schema version 1 for legacy events
  const eventSchemaVersion = rawEvent.eventSchemaVersion ?? 1;

  // Preserve unknown technical data
  const normalizedStatus = rawEvent.normalizedStatus || 'idle';
  const lifecycleState = rawEvent.lifecycleState || 'idle';
  const eventType = rawEvent.eventType || 'unknown';

  let payload = rawEvent.payload;
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload);
    } catch {}
  }

  return {
    ...rawEvent,
    payload,
    eventSchemaVersion,
    normalizedStatus,
    lifecycleState,
    eventType,
    provider: rawEvent.provider || 'unknown',
    model: rawEvent.model || 'unknown',
    // Fallbacks to avoid crashes
    timestamp: rawEvent.timestamp || new Date().toISOString(),
    message: rawEvent.message || '',
    state: rawEvent.state || 'queued',
    step: rawEvent.step || 0
  };
}
