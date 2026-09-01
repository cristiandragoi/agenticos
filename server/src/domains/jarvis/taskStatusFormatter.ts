/**
 * server/src/domains/jarvis/taskStatusFormatter.ts
 *
 * Deterministic canonical task snapshot formatting and query detection.
 * Guarantees exact numeric counts and active task names across English, German, and Romanian,
 * completely preventing vague hallucinations or ungrounded future promises.
 */

import { CanonicalTaskSnapshot } from '../../services/backgroundTasks/canonicalSnapshot.js';

const TASK_STATUS_PATTERNS = [
  /\b(what|which|show|list|get|tell me)\s+(?:are\s+)?(?:the\s+)?(?:active|running|pending|queued|current|all)\s+tasks?\b/i,
  /\b(how many|what)\s+tasks?\s+(?:are\s+)?(?:active|running|queued|in progress|there)\b/i,
  /\btask\s+(?:status|summary|counts?|overview)\b/i,
  /\bwhat('s| is) (?:the )?(?:task|system) status\b/i,
  // German patterns
  /\b(welche|wie viele)\s+aufgaben\s+(?:sind\s+)?(?:aktiv|in der warteschlange|am laufen|aktuell)\b/i,
  /\b(aufgaben|task)[\s-]?(?:status|übersicht|stand)\b/i,
  /\bwas für aufgaben sind aktiv\b/i,
  // Romanian patterns
  /\b(ce|care|câte)\s+sarcini\s+(?:sunt\s+)?(?:active|în coadă|în derulare|curente)\b/i,
  /\b(?:statusul|starea)\s+(?:sarcinilor|taskurilor)\b/i,
  /\barată(?:-mi)?\s+sarcinile\s+active\b/i,
];

export function isTaskStatusQuery(prompt: string): boolean {
  if (!prompt || typeof prompt !== 'string') return false;
  const trimmed = prompt.trim().toLowerCase();
  return TASK_STATUS_PATTERNS.some((p) => p.test(trimmed));
}

export function formatCanonicalSnapshotAnswer(
  snapshot: CanonicalTaskSnapshot,
  language: 'en' | 'de' | 'ro' = 'en'
): string {
  const {
    activeCount,
    queuedCount,
    awaitingApprovalCount,
    blockedCount,
    completedCount,
    failedCount,
    cancelledCount,
    totalCount,
    activeTasks,
  } = snapshot;

  const formatActiveList = (quoteOpen: string, quoteClose: string) => {
    if (!activeTasks || activeTasks.length === 0) return '';
    const items = activeTasks.map((t) => `${t.worker}: ${quoteOpen}${t.title}${quoteClose}`);
    return ` (${items.join(', ')})`;
  };

  if (language === 'de') {
    const activeList = formatActiveList('„', '“');
    return `Es gibt derzeit ${activeCount} aktive Aufgaben${activeList}, ${queuedCount} in der Warteschlange, ${awaitingApprovalCount} warten auf Genehmigung, ${blockedCount} blockiert, ${completedCount} abgeschlossen, ${failedCount} fehlgeschlagen und ${cancelledCount} abgebrochen (Gesamt: ${totalCount}).`;
  }

  if (language === 'ro') {
    const activeList = formatActiveList('„', '”');
    return `În prezent sunt ${activeCount} sarcini active${activeList}, ${queuedCount} în coadă, ${awaitingApprovalCount} în așteptarea aprobării, ${blockedCount} blocate, ${completedCount} finalizate, ${failedCount} eșuate și ${cancelledCount} anulate (total: ${totalCount}).`;
  }

  // Default: English
  const activeList = formatActiveList('"', '"');
  return `There are currently ${activeCount} active tasks${activeList}, ${queuedCount} queued, ${awaitingApprovalCount} awaiting approval, ${blockedCount} blocked, ${completedCount} completed, ${failedCount} failed, and ${cancelledCount} cancelled (total: ${totalCount}).`;
}
