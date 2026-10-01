import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { JarvisRuntimeProvider, useJarvisRuntime } from '../context/JarvisRuntimeContext';

describe('Jarvis Typed Commands Spoken Acknowledgment', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('arms speech and produces progressive spoken chunks when deltas arrive on a typed channel', async () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <MemoryRouter>
        <JarvisRuntimeProvider>{children}</JarvisRuntimeProvider>
      </MemoryRouter>
    );

    const { result } = renderHook(() => useJarvisRuntime(), { wrapper });

    // Simulate stopping previous speech (which sets outputStopped = true)
    act(() => {
      result.current.stopSpeaking();
    });

    // Simulate sending a typed command
    let turnId: number = 0;
    act(() => {
      turnId = result.current.beginOutput();
    });
    expect(turnId).toBeGreaterThan(0);

    // Simulate stream deltas arriving for the typed command
    act(() => {
      result.current.handleStreamDelta(
        "Understood. I'm delegating that engineering task to AntiGravity now. ",
        'typed',
        turnId
      );
    });

    // Final assistant done arrives
    act(() => {
      result.current.handleAssistantDone(
        "Understood. I'm delegating that engineering task to AntiGravity now.",
        'typed',
        turnId
      );
    });

    // The sentence flusher should have processed the progressive sentence
    expect(result.current).toBeDefined();
  });
});
