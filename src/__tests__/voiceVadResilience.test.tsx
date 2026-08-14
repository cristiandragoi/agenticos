import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useVoiceIO } from '../hooks/useVoiceIO';

/**
 * VAD liveness / watchdog regression tests (multi-turn voice hardening):
 *
 * Root cause (live capture): the VAD analysis loop is driven entirely by
 * requestAnimationFrame. Chromium pauses rAF for hidden/occluded windows, so
 * while the UI showed "Listening…" the loop was dead — no ticks, no
 * recording, no transcription, no backend request, and nothing ever re-armed
 * it. The fix:
 *   - backgroundThrottling:false on the Electron BrowserWindow (keeps rAF
 *     alive while hidden), and
 *   - a watchdog in useVoiceIO: while claiming Listening, if no tick happens
 *     for vadWatchdogMs, cancel the stale rAF id and re-arm; plus
 *     visibilitychange/focus recovery. Re-arm is idempotent, so at most one
 *     analysis loop can exist per conversation mic stream.
 *
 * These tests use a CONTROLLABLE requestAnimationFrame (a manual queue) so a
 * dead loop can be simulated deterministically.
 */
describe('useVoiceIO VAD liveness / watchdog (multi-turn voice)', () => {
  let track: any;
  let audioMode: 'speech' | 'silence' = 'silence';

  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    audioMode = 'silence';

    class MockTrack {
      enabled = true;
      kind = 'audio';
      stop = vi.fn();
    }
    track = new MockTrack();
    const stream = {
      getTracks: () => [track],
      getAudioTracks: () => [track],
    };

    vi.stubGlobal('navigator', {
      ...navigator,
      mediaDevices: {
        getUserMedia: vi.fn().mockResolvedValue(stream),
      },
    });

    class MockAnalyser {
      fftSize = 512;
      frequencyBinCount = 256;
      getByteTimeDomainData = vi.fn((data: Uint8Array) => {
        if (audioMode === 'speech') data.fill(220);
        else data.fill(128);
      });
    }
    class MockAudioContext {
      state = 'running';
      destination = {};
      createMediaStreamSource = vi.fn(() => ({ connect: vi.fn() }));
      createAnalyser = vi.fn(() => new MockAnalyser());
      createBuffer = vi.fn(() => ({}));
      createBufferSource = vi.fn(() => ({ buffer: null, connect: vi.fn(), start: vi.fn() }));
      resume = vi.fn().mockResolvedValue(undefined);
      close = vi.fn().mockResolvedValue(undefined);
    }
    vi.stubGlobal('AudioContext', MockAudioContext);

    class MockMediaRecorder {
      static instances: MockMediaRecorder[] = [];
      state = 'inactive';
      stream: any;
      ondataavailable: any = null;
      onstop: any = null;
      constructor(stream: any) { this.stream = stream; MockMediaRecorder.instances.push(this); }
      start() { this.state = 'recording'; }
      stop() {
        this.state = 'inactive';
        if (this.ondataavailable) this.ondataavailable({ data: new Blob([new Uint8Array(400)], { type: 'audio/webm' }) });
        if (this.onstop) this.onstop();
      }
    }
    vi.stubGlobal('MediaRecorder', MockMediaRecorder);

    vi.stubGlobal('SpeechSynthesisUtterance', class { onend: any = null; onerror: any = null; text = ''; });
    (window as any).speechSynthesis = { cancel: vi.fn(), speak: vi.fn() };

    class MockAudio {
      src = '';
      paused = true;
      onplay: any = null;
      onended: any = null;
      onerror: any = null;
      play = vi.fn().mockResolvedValue(undefined);
      pause = vi.fn();
      load = vi.fn();
      removeAttribute = vi.fn();
      duration = 2;
      error: any = null;
    }
    vi.stubGlobal('Audio', MockAudio);
  });

  /** Install a controllable rAF: callbacks queue up and only run on flush().
   *  cancelAnimationFrame removes a pending callback by id, so "at most one
   *  loop" is assertable via pending.size. */
  function installControllableRaf() {
    let nextId = 1;
    const pending = new Map<number, FrameRequestCallback>();
    let totalCalls = 0;
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      totalCalls += 1;
      const id = nextId++;
      pending.set(id, cb);
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => { pending.delete(id); });
    return {
      pending,
      get total() { return totalCalls; },
      flush() {
        const cbs = [...pending.values()];
        pending.clear();
        for (const cb of cbs) cb(performance.now());
      },
    };
  }

  async function startConversation(result: any) {
    let ok = false;
    await act(async () => { ok = await result.current.startConversation(); });
    expect(ok).toBe(true);
  }

  it('arms exactly ONE VAD loop per conversation (single-loop ownership)', async () => {
    const raf = installControllableRaf();
    const { result } = renderHook(() => useVoiceIO({
      agentId: 'agent-jarvis',
      vadWatchdogMs: 60,
      vadWatchdogIntervalMs: 20,
    }));
    await startConversation(result);
    expect(raf.pending.size).toBe(1); // one analysis loop scheduled

    // Healthy ticking: each flush runs the ticker, which re-queues itself —
    // still exactly one loop.
    raf.flush();
    expect(raf.pending.size).toBe(1);
    raf.flush();
    expect(raf.pending.size).toBe(1);
  });

  it('focus does not duplicate a HEALTHY VAD loop', async () => {
    const raf = installControllableRaf();
    const { result } = renderHook(() => useVoiceIO({
      agentId: 'agent-jarvis',
      vadWatchdogMs: 60,
      vadWatchdogIntervalMs: 20,
    }));
    await startConversation(result);
    // Let the loop tick a few times so lastVadTickAt is fresh.
    raf.flush();
    raf.flush();
    const callsBefore = raf.total;
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    expect(raf.total).toBe(callsBefore); // no re-arm — loop is alive
    expect(raf.pending.size).toBe(1);
  });

  it('watchdog recovers a STALLED loop (dead rAF) without creating a second loop', async () => {
    const raf = installControllableRaf();
    const { result } = renderHook(() => useVoiceIO({
      agentId: 'agent-jarvis',
      vadWatchdogMs: 60,
      vadWatchdogIntervalMs: 20,
    }));
    await startConversation(result);
    const callsAfterStart = raf.total;
    // Simulate Chromium rAF pause: never flush. The watchdog (setInterval —
    // timers keep running when rAF is frozen) must notice zero ticks, cancel
    // the stale id, and re-arm.
    await new Promise((r) => setTimeout(r, 250));
    expect(raf.total).toBeGreaterThan(callsAfterStart); // re-arm happened
    expect(raf.pending.size).toBe(1); // still exactly one loop (cancel + re-arm)
  });

  it('visibilitychange restores a stalled loop when the page becomes visible', async () => {
    const raf = installControllableRaf();
    const { result } = renderHook(() => useVoiceIO({
      agentId: 'agent-jarvis',
      vadWatchdogMs: 60,
      vadWatchdogIntervalMs: 20,
    }));
    await startConversation(result);
    const callsAfterStart = raf.total;
    // Simulate a long stall (loop frozen), then the page regains visibility.
    await new Promise((r) => setTimeout(r, 120));
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(raf.total).toBeGreaterThan(callsAfterStart);
    expect(raf.pending.size).toBe(1);
  });

  it('recovery preserves the mic stream (no getUserMedia churn)', async () => {
    const raf = installControllableRaf();
    const gum = vi.mocked(navigator.mediaDevices.getUserMedia);
    const { result } = renderHook(() => useVoiceIO({
      agentId: 'agent-jarvis',
      vadWatchdogMs: 60,
      vadWatchdogIntervalMs: 20,
    }));
    await startConversation(result);
    const gumCalls = gum.mock.calls.length;
    // Stall then recover via watchdog — must NOT re-acquire the mic.
    await new Promise((r) => setTimeout(r, 250));
    expect(gum.mock.calls.length).toBe(gumCalls); // stream preserved
    expect(track.enabled).toBe(true);
  });
});
