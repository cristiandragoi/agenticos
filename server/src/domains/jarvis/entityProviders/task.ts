/**
 * task.ts — Background task entity provider (§5 of plan).
 *
 * Resolves active background tasks (e.g. "the Hermes task") to EntityRefs.
 * Prefers active tasks; matches on title/objective short codes.
 */

import { backgroundTaskRepo } from '../../../services/backgroundTasks/store.js';
import { normalizeText, type EntityProvider, type EntityRef } from '../entityResolver.js';

export const TaskEntityProvider: EntityProvider = {
  domain: 'tasks',

  resolve(query: string): EntityRef | null {
    const q = normalizeText(query);
    if (!q) return null;

    // Short task ID pattern: T-XXXXXX (from taskShortId)
    const shortMatch = q.match(/^(?:task\s+)?([a-z]-\w{4,10})$/i);
    const shortRef = shortMatch ? shortMatch[1].toUpperCase() : null;

    let tasks: Array<{ taskId: string; title: string; objective: string; status: string }> = [];
    try {
      tasks = backgroundTaskRepo.listTasks({ limit: 30 }) || [];
    } catch {
      return null;
    }

    // Match short ID first e.g. "T-ABCDEF" or "bg-abc123"
    for (const t of tasks) {
      if (shortRef && normalizeText(t.taskId).includes(shortRef.toLowerCase())) {
        return toRef(t);
      }
    }

    // Then title/objective phrase match
    const qTokens = q.split(' ').filter((t) => t && t.length >= 3);
    for (const t of tasks) {
      const hay = normalizeText(`${t.title} ${t.objective}`);
      const allInHay = qTokens.length > 0 && qTokens.every((tok) => hay.includes(tok));
      if (allInHay) return toRef(t);
    }

    return null;
  },

  listAll(): EntityRef[] {
    try {
      return (backgroundTaskRepo.listTasks({ limit: 30 }) || []).map(toRef);
    } catch {
      return [];
    }
  },
};

function toRef(t: { taskId: string; title: string; status: string }): EntityRef {
  return {
    id: t.taskId,
    type: 'task',
    domain: 'tasks',
    displayName: t.title || t.taskId,
  };
}