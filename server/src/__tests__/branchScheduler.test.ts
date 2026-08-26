/**
 * branchScheduler.test.ts — Phase 2D fair selection + retry/backoff semantics.
 * Runs against an isolated throwaway SQLite DB (via AGENTICOS_DATA_DIR).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

type BranchScheduler = typeof import('../services/revenueOperator/branchScheduler.js').branchScheduler;

describe('branchScheduler (isolated temp DB)', () => {
  let branchScheduler: BranchScheduler;

  beforeAll(async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'agenticos-branch-'));
    process.env.AGENTICOS_DATA_DIR = dir;
    process.env.AGENT_TEAMS_DB_PATH = path.join(dir, 'agentic-os.db');
    ({ branchScheduler } = await import('../services/revenueOperator/branchScheduler.js'));
  });

  it('selects the stable-first branch when all are equally eligible', () => {
    expect(branchScheduler.selectNext(['c', 'a', 'b'])).toBe('a');
  });

  it('fair: least-recently-selected branch wins next (no starvation)', () => {
    branchScheduler.recordSuccess('a', 'ACTION', 'completed');
    // 'a' now has the newest lastSelectedAt; 'b' and 'c' still never selected.
    expect(branchScheduler.selectNext(['a', 'b', 'c'])).toBe('b');
    branchScheduler.recordSuccess('b', 'ACTION', 'completed');
    expect(branchScheduler.selectNext(['a', 'b', 'c'])).toBe('c');
    branchScheduler.recordSuccess('c', 'ACTION', 'completed');
    // Round-robin returns to 'a'.
    expect(branchScheduler.selectNext(['a', 'b', 'c'])).toBe('a');
  });

  it('transient failure backs off (branch temporarily ineligible)', () => {
    const r = branchScheduler.recordTransientFailure('x', 'ACTION', 'failed', 'boom');
    expect(r.retryCount).toBe(1);
    expect(r.exhausted).toBe(false);
    expect(branchScheduler.isEligible('x')).toBe(false);
    expect(branchScheduler.selectNext(['x', 'y'])).toBe('y');
  });

  it('success resets retry/backoff', () => {
    branchScheduler.recordSuccess('x', 'ACTION', 'completed');
    expect(branchScheduler.isEligible('x')).toBe(true);
    expect(branchScheduler.getState('x').retryCount).toBe(0);
  });

  it('permanent failure blocks forever', () => {
    branchScheduler.recordPermanentFailure('z', 'ACTION', 'failed', 'fatal');
    expect(branchScheduler.isEligible('z')).toBe(false);
    expect(branchScheduler.selectNext(['z'])).toBeNull();
  });

  it('retry exhaustion after MAX_RETRIES becomes permanent', () => {
    const id = 'exhaust';
    branchScheduler.recordTransientFailure(id, 'A', 'failed', 'e1');
    branchScheduler.recordTransientFailure(id, 'A', 'failed', 'e2');
    const r3 = branchScheduler.recordTransientFailure(id, 'A', 'failed', 'e3');
    expect(r3.exhausted).toBe(true);
    expect(branchScheduler.getState(id).permanentFailure).toBe(true);
    expect(branchScheduler.isEligible(id)).toBe(false);
  });
});
