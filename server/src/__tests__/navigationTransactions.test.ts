/**
 * navigationTransactions.test.ts — D14 §8 cases at the transaction layer.
 * The registry is the single place where "did the GUI really move?" is decided,
 * so its rules are tested directly: state must be PROVEN by the ACK, never
 * assumed from the fact that a client was asked to navigate.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  beginNavigation,
  completeNavigation,
  markReceived,
  registerImmediateFailure,
  getTransaction,
  listTransactions,
  _resetTransactions,
} from '../services/navigation/navigationTransactions.js';

const PROJECT_ROUTE = '/projects?project=proj-free-cash';
const base = { conversationId: 'conv-test', targetRoute: PROJECT_ROUTE, entityId: 'proj-free-cash', entityType: 'project', entityName: 'Free Cash', source: 'typed' as const };

describe('D14 — navigation transactions', () => {
  beforeEach(() => _resetTransactions());

  it('A: valid route + valid ACK → verified', async () => {
    const { navId, result } = beginNavigation(base, 500);
    const outcome = completeNavigation({ navId, success: true, actualRoute: PROJECT_ROUTE, activeProjectId: 'proj-free-cash' });
    expect(outcome.accepted).toBe(true);
    expect(outcome.verified).toBe(true);
    await expect(result).resolves.toMatchObject({ verified: true, actualRoute: PROJECT_ROUTE, activeProjectId: 'proj-free-cash' });
  });

  it('B: no client ever receives it → timeout, verified false', async () => {
    const { navId, result } = beginNavigation(base, 60);
    const res = await result;
    expect(res.verified).toBe(false);
    expect(res.error).toBe('ack_timeout');
    expect(getTransaction(navId)?.receivedAt).toBeUndefined(); // never received
  });

  it('C: client received but landed on the wrong route → verified false', async () => {
    const { navId, result } = beginNavigation(base, 500);
    markReceived(navId);
    const outcome = completeNavigation({ navId, success: true, actualRoute: '/mission-control', activeProjectId: 'proj-free-cash' });
    expect(outcome.verified).toBe(false);
    expect(outcome.reason).toBe('route_mismatch');
    await expect(result).resolves.toMatchObject({ verified: false });
  });

  it('D: correct route, wrong project mounted → verified false', async () => {
    const { navId, result } = beginNavigation(base, 500);
    const outcome = completeNavigation({ navId, success: true, actualRoute: PROJECT_ROUTE, activeProjectId: 'proj-shopify' });
    expect(outcome.verified).toBe(false);
    expect(outcome.reason).toBe('project_mismatch');
    await expect(result).resolves.toMatchObject({ verified: false });
  });

  it('E: ACK times out → verified false and no success is possible', async () => {
    const { result } = beginNavigation(base, 50);
    await expect(result).resolves.toMatchObject({ verified: false, error: 'ack_timeout' });
  });

  it('H: a duplicate ACK is idempotent — one navigation, one decision', async () => {
    const { navId, result } = beginNavigation(base, 500);
    const first = completeNavigation({ navId, success: true, actualRoute: PROJECT_ROUTE, activeProjectId: 'proj-free-cash' });
    const second = completeNavigation({ navId, success: true, actualRoute: '/somewhere-else' });
    expect(first.verified).toBe(true);
    expect(second.accepted).toBe(false);
    expect(second.reason).toBe('already_completed');
    expect(second.verified).toBe(true); // a late/duplicate ACK cannot flip a decision
    await expect(result).resolves.toMatchObject({ verified: true });
    expect(listTransactions().filter((t) => t.req.navId === navId)).toHaveLength(1);
  });

  it('I: a stale ACK for an unknown navigation is ignored', () => {
    const outcome = completeNavigation({ navId: 'nav-from-an-old-turn', success: true, actualRoute: PROJECT_ROUTE, activeProjectId: 'proj-free-cash' });
    expect(outcome.accepted).toBe(false);
    expect(outcome.verified).toBe(false);
    expect(outcome.reason).toBe('unknown_or_stale_navId');
  });

  it('no transport at all is recorded as an explicit failure, not silence', async () => {
    const { navId, result } = beginNavigation(base, 500);
    expect(registerImmediateFailure(navId, 'no_client_transport').verified).toBe(false);
    await expect(result).resolves.toMatchObject({ verified: false, error: 'no_client_transport' });
  });

  it('client-reported failure never yields success', async () => {
    const { navId, result } = beginNavigation(base, 500);
    const outcome = completeNavigation({ navId, success: false, actualRoute: PROJECT_ROUTE, error: 'view_did_not_mount' });
    expect(outcome.verified).toBe(false);
    expect(outcome.reason).toBe('client_reported_failure');
    await expect(result).resolves.toMatchObject({ verified: false, error: 'view_did_not_mount' });
  });
});
