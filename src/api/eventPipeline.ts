import type { MemoryEntry } from '../types';
import { obsidianAdapter } from './obsidianAdapter';
import { API_BASE as BASE_URL, apiFetch } from './client';

export type OSEventType = 'RUN_COMPLETED' | 'DECISION_MADE' | 'ARTIFACT_GENERATED' | 'MANUAL_NOTE';

export interface OSEvent {
  type: OSEventType;
  payload: any;
  timestamp: string;
}


class OSEventPipeline {
  private listeners: ((event: OSEvent) => void)[] = [];

  constructor() {
    this.subscribe(this.handleEvent.bind(this));
  }

  subscribe(callback: (event: OSEvent) => void) {
    this.listeners.push(callback);
  }

  dispatch(event: OSEvent) {
    console.log('[OS Event Pipeline] Dispatched:', event.type);
    this.listeners.forEach(l => l(event));
  }

  private handleEvent(event: OSEvent) {
    let memoryEntry: MemoryEntry | null = null;

    if (event.type === 'RUN_COMPLETED') {
      memoryEntry = {
        id: `mem-${Date.now()}`,
        scopeId: 'scope-1',
        kind: 'note',
        title: `Run Result: ${event.payload.runId}`,
        content: `Completed run for agent ${event.payload.agentId} with output: ${event.payload.output || 'No output'}`,
        sourceRunId: event.payload.runId,
        sourceType: 'run',
        sourceId: event.payload.runId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        syncStatus: 'pending'
      } as MemoryEntry;
    }

    if (memoryEntry) {
      // POST directly to local backend for Obsidian Sync queueing
      apiFetch(`${BASE_URL}/sync/queue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          memoryEntry,
          config: obsidianAdapter.getConfig() 
        })
      }).catch(err => console.error('Failed to queue sync:', err));
    }
  }
}

export const osEventPipeline = new OSEventPipeline();

