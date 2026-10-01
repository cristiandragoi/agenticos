/**
 * navigationTransactions.ts — ONE navigation transaction model (D14 §3).
 *
 * Every transport (typed SSE, voice LiveKit) registers the SAME transaction here
 * and resolves it with the SAME ACK shape. The transaction is what makes a
 * success claim possible or impossible:
 *
 *   REQUEST → CLIENT RECEIVED → ROUTER CHANGED → VIEW CHANGED → ACK → VERIFIED
 *
 * `verified` requires the ACK to PROVE state: the actual route must match the
 * requested route and, for project navigation, the mounted project must match
 * the requested project. Calling router.navigate() is not proof (§5).
 */

import { bump } from '../../domains/jarvisNext/jarvisHealth.js';

export interface NavigationRequest {
  navId: string;
  conversationId?: string;
  targetRoute: string;
  entityId?: string;
  entityName?: string;
  entityType?: string;
  source: 'typed' | 'voice' | 'internal';
  sentAt: number;
}

/** The ONE canonical navigation packet both transports must use (§2). */
export interface NavigationPacket {
  type: 'navigation_request';
  navId: string;
  conversationId?: string;
  targetRoute: string;
  entityId?: string;
  entityName?: string;
  entityType?: string;
  source: 'typed' | 'voice' | 'internal';
}

export function buildNavigationPacket(
  req: Omit<NavigationRequest, 'navId' | 'sentAt'> & { navId: string },
): NavigationPacket {
  return {
    type: 'navigation_request',
    navId: req.navId,
    conversationId: req.conversationId,
    targetRoute: req.targetRoute,
    entityId: req.entityId,
    entityName: req.entityName,
    entityType: req.entityType,
    source: req.source,
  };
}

export interface NavigationAck {
  navId: string;
  success: boolean;
  actualRoute?: string;
  visibleEntityId?: string;
  activeProjectId?: string;
  error?: string;
}

export interface NavigationTransaction {
  req: NavigationRequest;
  receivedAt?: number;
  completedAt?: number;
  ack?: NavigationAck;
  verified: boolean;
  error?: string;
  /** Resolver of the awaiting caller (server-side verifier). */
  settle?: (result: NavigationResult) => void;
}

export interface NavigationResult {
  verified: boolean;
  actualRoute?: string;
  visibleEntityId?: string;
  activeProjectId?: string;
  error?: string;
}

const MAX_TRANSACTIONS = 200;
const transactions = new Map<string, NavigationTransaction>();

function prune(): void {
  if (transactions.size <= MAX_TRANSACTIONS) return;
  const oldest = [...transactions.values()].sort((a, b) => a.req.sentAt - b.req.sentAt);
  for (const t of oldest.slice(0, transactions.size - MAX_TRANSACTIONS)) transactions.delete(t.req.navId);
}

export function newNavigationId(): string {
  return `nav-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Register the request and return a handle whose promise resolves on ACK/timeout. */
export function beginNavigation(
  req: Omit<NavigationRequest, 'navId' | 'sentAt'> & { navId?: string },
  timeoutMs = 2500,
): { navId: string; result: Promise<NavigationResult>; transaction: NavigationTransaction } {
  const navId = req.navId || newNavigationId();
  const full: NavigationRequest = { ...req, navId, sentAt: Date.now() };

  const transaction: NavigationTransaction = { req: full, verified: false };
  transactions.set(navId, transaction);
  bump('navigation_requests');
  prune();

  const result = new Promise<NavigationResult>((resolve) => {
    transaction.settle = resolve;
    setTimeout(() => {
      if (transaction.completedAt) return; // already decided
      finishTransaction(navId, { verified: false, error: 'ack_timeout' });
    }, timeoutMs);
  });

  return { navId, result, transaction };
}

/** Inline (already-verified) resolution — used when no client can be reached. */
export function registerImmediateFailure(navId: string, error: string): NavigationResult {
  return finishTransaction(navId, { verified: false, error });
}

function finishTransaction(navId: string, outcome: NavigationResult): NavigationResult {
  const tx = transactions.get(navId);
  if (!tx) return outcome;
  tx.completedAt = Date.now();
  bump(outcome.verified ? 'navigation_verified' : 'navigation_failed');
  // Every unverified navigation is a success claim the runtime refused to make.
  if (!outcome.verified) bump('unverified_success_blocked');
  tx.verified = outcome.verified;
  tx.error = outcome.error;
  const settle = tx.settle;
  tx.settle = undefined;
  if (settle) settle(outcome);
  return outcome;
}

/** Mark that a client actually received the request (evidence, not success). */
export function markReceived(navId: string): boolean {
  const tx = transactions.get(navId);
  if (!tx || tx.completedAt) return false;
  tx.receivedAt = Date.now();
  return true;
}

export interface AckOutcome {
  accepted: boolean;
  verified: boolean;
  reason?: string;
  result?: NavigationResult;
}

/**
 * Resolve a transaction with a client ACK. Success requires PROVEN state:
 * route match AND (for project navigation) the matching active project.
 * Unknown navIds (including late ACKs from a superseded navigation) are rejected.
 */
export function completeNavigation(ack: NavigationAck): AckOutcome {
  const tx = transactions.get(ack.navId);
  if (!tx) {
    bump('navigation_ack_orphan');
    return { accepted: false, verified: false, reason: 'unknown_or_stale_navId' };
  }
  if (tx.completedAt) {
    // Idempotent: a duplicate ACK never re-opens or duplicates a navigation.
    bump('navigation_ack_duplicate');
    return { accepted: false, verified: tx.verified, reason: 'already_completed', result: { verified: tx.verified, actualRoute: tx.ack?.actualRoute, activeProjectId: tx.ack?.activeProjectId } };
  }
  tx.ack = ack;
  tx.receivedAt = tx.receivedAt ?? Date.now();

  const normalise = (u?: string) => (u || '').replace(/\/+$/, '').toLowerCase();
  const routeOk = normalise(ack.actualRoute) === normalise(tx.req.targetRoute);
  const wantsProject = (tx.req.entityType || '').toLowerCase() === 'project' && Boolean(tx.req.entityId);
  // Project proof: the ACK's explicit active project when the client reports one,
  // otherwise the project the client-reported ACTUAL route carries. The LiveKit
  // ACK shape has no activeProjectId field, but its actualRoute is real state.
  const routeProject = (() => {
    try {
      const q = (ack.actualRoute || '').split('?')[1] || '';
      return new URLSearchParams(q).get('project') || new URLSearchParams(q).get('projectId') || '';
    } catch { return ''; }
  })();
  const reportedProject = ack.activeProjectId || ack.visibleEntityId || routeProject;
  const projectOk = !wantsProject || (reportedProject || '').toLowerCase() === (tx.req.entityId || '').toLowerCase();

  if (!ack.success) {
    return { accepted: true, verified: false, reason: 'client_reported_failure', result: finishTransaction(ack.navId, { verified: false, error: ack.error || 'client_reported_failure', actualRoute: ack.actualRoute, activeProjectId: ack.activeProjectId }) };
  }
  if (!routeOk) {
    return { accepted: true, verified: false, reason: 'route_mismatch', result: finishTransaction(ack.navId, { verified: false, error: `route_mismatch:${ack.actualRoute || 'unknown'}`, actualRoute: ack.actualRoute, activeProjectId: ack.activeProjectId }) };
  }
  if (!projectOk) {
    return { accepted: true, verified: false, reason: 'project_mismatch', result: finishTransaction(ack.navId, { verified: false, error: `project_mismatch:${ack.activeProjectId || 'none'}`, actualRoute: ack.actualRoute, activeProjectId: ack.activeProjectId }) };
  }
  return {
    accepted: true,
    verified: true,
    result: finishTransaction(ack.navId, {
      verified: true,
      actualRoute: ack.actualRoute,
      visibleEntityId: ack.visibleEntityId,
      activeProjectId: ack.activeProjectId,
    }),
  };
}

export function getTransaction(navId: string): NavigationTransaction | undefined {
  return transactions.get(navId);
}

export function listTransactions(limit = 20): NavigationTransaction[] {
  return [...transactions.values()].sort((a, b) => b.req.sentAt - a.req.sentAt).slice(0, limit);
}

/** Test/diagnostic reset. */
export function _resetTransactions(): void {
  for (const tx of transactions.values()) tx.settle = undefined;
  transactions.clear();
}
