import path from 'path';
import { fileURLToPath } from 'url';
import { EventEmitter } from 'events';
import type { RunRecord } from '../types.js';
import { JsonStore } from './store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(__dirname, '../../data');

class RunStore extends EventEmitter {
  private store: JsonStore<RunRecord>;

  constructor() {
    super();
    this.store = new JsonStore<RunRecord>(path.join(dataDir, 'runs.json'));
  }

  seed(runs: RunRecord[]): void {
    // Only seed if empty
    if (this.store.list().length === 0) {
      for (const run of runs) {
        this.store.upsert(run);
      }
    }
  }

  create(run: RunRecord): RunRecord {
    this.store.upsert(run);
    this.emit('run:created', run);
    return run;
  }

  update(id: string, patch: Partial<RunRecord>): RunRecord | undefined {
    const existing = this.store.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...patch, updatedAt: new Date().toISOString() };
    this.store.upsert(updated);
    this.emit('run:updated', updated);
    return updated;
  }

  appendLog(id: string, msg: string): RunRecord | undefined {
    const existing = this.store.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, logs: [...existing.logs, msg], updatedAt: new Date().toISOString() };
    this.store.upsert(updated);
    this.emit('run:updated', updated);
    return updated;
  }

  appendEvent(id: string, event: string): RunRecord | undefined {
    const existing = this.store.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, events: [...existing.events, event], updatedAt: new Date().toISOString() };
    this.store.upsert(updated);
    this.emit('run:updated', updated);
    return updated;
  }

  get(id: string): RunRecord | undefined {
    return this.store.get(id);
  }

  list(filter?: { agentId?: string; status?: string }): RunRecord[] {
    let results = this.store.list();
    if (filter?.agentId) results = results.filter(r => r.agentId === filter.agentId);
    if (filter?.status) results = results.filter(r => r.status === filter.status);
    return results.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }
}

export const runStore = new RunStore();
