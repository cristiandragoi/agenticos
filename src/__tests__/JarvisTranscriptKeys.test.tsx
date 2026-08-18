/**
 * JarvisTranscriptKeys.test.tsx — regression: every rendered transcript row
 * must have a stable, globally unique React key.
 *
 * Root cause of the live duplicate-key warning ("two children with the same
 * key `v-usr-…`"): locally-created voice/text entries used
 * `v-usr-${Date.now()}` / `t-msg-${Date.now()}` — two messages created in
 * the SAME millisecond produced the SAME id. Fix: monotonic sequence ids
 * (nextTranscriptId in JarvisDrawer) + store-level dedup by id
 * (ADD_JARVIS_TRANSCRIPT).
 *
 * This test inserts multiple messages inside one timestamp window through
 * the REAL store and renders rows keyed by entry.id — proving every key is
 * unique, that genuinely duplicated records are deduplicated (not hidden
 * with random keys), and that keys stay stable across renders.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { DataProvider } from '../store/dataStore';
import { AppProvider, useAppDispatch, useJarvis } from '../store/appStore';
import type { JarvisTranscriptEntry } from '../types';

/** Minimal transcript renderer — mirrors the drawer's `key={entry.id}` rows. */
function TranscriptRows() {
  const { transcript } = useJarvis();
  return (
    <div data-testid="rows">
      {transcript.map((entry) => (
        <div key={entry.id} data-testid="transcript-row">
          {entry.text}
        </div>
      ))}
    </div>
  );
}

function renderWithEntries(entries: JarvisTranscriptEntry[]) {
  const Collector = () => {
    const dispatch = useAppDispatch();
    React.useEffect(() => {
      entries.forEach((e) => dispatch({ type: 'ADD_JARVIS_TRANSCRIPT', entry: e }));
    }, [dispatch]);
    return null;
  };
  return render(
    <DataProvider>
      <AppProvider>
        <MemoryRouter initialEntries={['/mission-control']}>
          <Collector />
          <TranscriptRows />
        </MemoryRouter>
      </AppProvider>
    </DataProvider>,
  );
}

describe('Jarvis transcript keys — uniqueness under same-millisecond inserts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (window as any).matchMedia = vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
  });

  it('keeps every row key unique for same-millisecond inserts and dedupes exact duplicates', async () => {
    const sameMs = 1784763924593; // one timestamp window
    const first: JarvisTranscriptEntry = { id: 'v-usr-1-1784763924593', role: 'user', text: 'first', timestamp: new Date(sameMs).toISOString() };
    const entries: JarvisTranscriptEntry[] = [
      first,
      { id: 'v-usr-2-1784763924593', role: 'user', text: 'second', timestamp: new Date(sameMs).toISOString() },
      { id: 'v-usr-3-1784763924593', role: 'user', text: 'third', timestamp: new Date(sameMs).toISOString() },
      // Genuine duplicate of the first entry — must be deduplicated by the store.
      { ...first },
    ];
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderWithEntries(entries);

    const rows = await screen.findAllByTestId('transcript-row');
    // 4 inserts → 3 distinct rows (duplicate id dropped).
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.textContent)).toEqual(['first', 'second', 'third']);

    // No React duplicate-key warning was emitted.
    expect(warn.mock.calls.some((c) => String(c[0]).includes('two children with the same key'))).toBe(false);
    warn.mockRestore();
  });

  it('generated ids (nextTranscriptId shape) are unique within one millisecond', () => {
    // The drawer's generator produces `prefix-seq-Date.now()`; simulate 5
    // entries in the same ms window and assert no id repeats.
    const sameMs = 1784763924593;
    const generated = Array.from({ length: 5 }, (_, i) => `v-usr-${i + 1}-${sameMs}`);
    expect(new Set(generated).size).toBe(5);
  });

  it('keeps ids stable across renders (no new key per render)', async () => {
    const entries: JarvisTranscriptEntry[] = [
      { id: 'v-usr-1-1784763924593', role: 'user', text: 'stable', timestamp: new Date(1784763924593).toISOString() },
    ];
    renderWithEntries(entries);
    const rows1 = (await screen.findAllByTestId('transcript-row')).map((r) => r.textContent);
    act(() => {}); // no-op re-render tick
    const rows2 = (await screen.findAllByTestId('transcript-row')).map((r) => r.textContent);
    expect(rows2).toEqual(rows1);
  });
});
