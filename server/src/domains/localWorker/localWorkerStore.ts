/**
 * domains/localWorker/localWorkerStore.ts
 *
 * Persistent storage for LocalWorkerTask records.
 */

import fs from 'node:fs';
import path from 'node:path';
import { logger } from '../../utils/logger.js';
import type { LocalWorkerTask } from './types.js';

export class LocalWorkerStore {
  private tasks = new Map<string, LocalWorkerTask>();
  private storageFilePath: string;
  private saveTimeout: NodeJS.Timeout | null = null;

  constructor() {
    const cwd = process.cwd();
    const isServerCwd = cwd.endsWith('server') || cwd.endsWith('server\\') || cwd.endsWith('server/');
    const candidates = [
      process.env.AGENTICOS_DATA_DIR ? path.join(process.env.AGENTICOS_DATA_DIR, 'local_worker_tasks.json') : '',
      isServerCwd ? path.resolve(cwd, 'data', 'local_worker_tasks.json') : path.resolve(cwd, 'server', 'data', 'local_worker_tasks.json'),
      path.resolve(cwd, 'data', 'local_worker_tasks.json'),
      path.join(process.env.APPDATA || '', 'AgenticOS', 'data', 'local_worker_tasks.json'),
    ].filter(Boolean);

    let chosenPath = candidates[1];
    for (const cand of candidates) {
      const dir = path.dirname(cand);
      if (fs.existsSync(dir)) {
        chosenPath = cand;
        break;
      }
    }

    this.storageFilePath = chosenPath;
    this.loadFromDisk();
  }

  private loadFromDisk(): void {
    try {
      if (fs.existsSync(this.storageFilePath)) {
        const raw = fs.readFileSync(this.storageFilePath, 'utf8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            if (item && item.id) {
              this.tasks.set(item.id, item);
            }
          }
        }
      }
    } catch (err: any) {
      logger.warn('[LocalWorkerStore] Could not load tasks from disk, starting empty:', err?.message || err);
    }
  }

  private scheduleSave(): void {
    if (this.saveTimeout) return;
    this.saveTimeout = setTimeout(() => {
      this.saveTimeout = null;
      this.flushToDisk();
    }, 200);
  }

  public flushToDisk(): void {
    try {
      const dir = path.dirname(this.storageFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const data = Array.from(this.tasks.values());
      const tmpPath = `${this.storageFilePath}.tmp.${Date.now()}`;
      fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
      fs.renameSync(tmpPath, this.storageFilePath);
    } catch (err: any) {
      logger.error('[LocalWorkerStore] Failed to write tasks to disk:', err?.message || err);
    }
  }

  public saveTask(task: LocalWorkerTask): void {
    this.tasks.set(task.id, { ...task });
    this.scheduleSave();
  }

  public getTask(id: string): LocalWorkerTask | undefined {
    const t = this.tasks.get(id);
    return t ? { ...t } : undefined;
  }

  public listTasks(): LocalWorkerTask[] {
    return Array.from(this.tasks.values())
      .map((t) => ({ ...t }))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  public deleteTask(id: string): boolean {
    const deleted = this.tasks.delete(id);
    if (deleted) this.scheduleSave();
    return deleted;
  }

  public clear(): void {
    this.tasks.clear();
    this.scheduleSave();
  }
}

export const localWorkerStore = new LocalWorkerStore();
