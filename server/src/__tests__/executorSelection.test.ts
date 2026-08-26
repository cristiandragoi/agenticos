/**
 * executorSelection.test.ts — Phase 2D capability-aware executor selection.
 * Pure logic tests (no DB).
 */
import { describe, it, expect } from 'vitest';
import {
  selectExecutor, mapExecutorToWorker, workerSatisfies, normalizeCapability,
  WORKER_CAPABILITY_PROFILE,
} from '../services/revenueOperator/executorSelection.js';

describe('mapExecutorToWorker', () => {
  it('maps rt-hermes → hermes', () => expect(mapExecutorToWorker('rt-hermes')).toBe('hermes'));
  it('maps rt-codex → codex', () => expect(mapExecutorToWorker('rt-codex')).toBe('codex'));
  it('maps bare worker kinds', () => {
    expect(mapExecutorToWorker('hermes')).toBe('hermes');
    expect(mapExecutorToWorker('codex')).toBe('codex');
    expect(mapExecutorToWorker('magnitude')).toBe('magnitude');
  });
  it('returns null for non-revenue hosts (jarvis/video)', () => {
    expect(mapExecutorToWorker('rt-jarvis')).toBeNull();
    expect(mapExecutorToWorker('rt-video')).toBeNull();
    expect(mapExecutorToWorker(null)).toBeNull();
  });
});

describe('normalizeCapability', () => {
  it('normalizes dotted → underscore aliases', () => {
    expect(normalizeCapability('filesystem.read')).toBe('filesystem_read');
    expect(normalizeCapability('process.execute')).toBe('process_exec');
    expect(normalizeCapability('tool.node')).toBe('node');
  });
});

describe('workerSatisfies', () => {
  it('codex satisfies build capabilities', () => {
    expect(workerSatisfies('codex', ['filesystem_write', 'process_exec', 'node', 'build', 'test']).satisfied).toBe(true);
  });
  it('codex does NOT satisfy external_web (research-only cap)', () => {
    expect(workerSatisfies('codex', ['external_web']).satisfied).toBe(false);
  });
  it('hermes satisfies research capabilities', () => {
    expect(workerSatisfies('hermes', ['filesystem_read', 'external_web']).satisfied).toBe(true);
  });
});

describe('selectExecutor (capability-aware selection + redispatch)', () => {
  it('selects the preferred worker when compatible', () => {
    const sel = selectExecutor(['filesystem_write', 'process_exec', 'node', 'build'], { preferredExecutorId: 'rt-codex' });
    expect(sel.worker).toBe('codex');
    expect(sel.autoRedispatched).toBe(false);
    expect(sel.rejectedCandidates).toEqual([]);
  });

  it('records CAPABILITY_MISMATCH and redispatches to a compatible worker', () => {
    // A preferred worker lacking the required capability is rejected.
    const sel = selectExecutor(['external_web'], { preferredExecutorId: 'rt-codex' });
    expect(sel.worker).toBe('hermes'); // hermes has external_web
    expect(sel.autoRedispatched).toBe(true);
    expect(sel.rejectedCandidates.some((r) => r.id === 'codex')).toBe(true);
  });

  it('research actions select hermes (preferred rt-hermes)', () => {
    const sel = selectExecutor(['filesystem_read', 'external_web'], { preferredExecutorId: 'rt-hermes' });
    expect(sel.worker).toBe('hermes');
  });

  it('throws NO_CAPABLE_EXECUTOR when no worker satisfies', () => {
    expect(() => selectExecutor(['nonexistent_capability'])).toThrow(/NO_CAPABLE_EXECUTOR/);
  });

  it('excludes a listed executor id', () => {
    expect(() => selectExecutor(['external_web'], { preferredExecutorId: 'rt-hermes', excludedExecutorIds: ['rt-hermes', 'hermes'] })).toThrow(/NO_CAPABLE_EXECUTOR/);
  });
});

describe('WORKER_CAPABILITY_PROFILE', () => {
  it('declares the real codex builder capabilities (process_exec/node/build/test)', () => {
    const caps = WORKER_CAPABILITY_PROFILE.codex;
    for (const c of ['filesystem_write', 'process_exec', 'node', 'build', 'test']) {
      expect(caps).toContain(c);
    }
  });
});
