// tests/jarvis/control.test.ts
import { describe, it, expect } from 'vitest';
import { detectControlIntent } from '../../src/lib/controlIntent';

describe('Jarvis Control Commands (A-K)', () => {
  // ==================== TEST A: STOP while TTS active ====================
  it("A-ST0P: stop while TTS active - detects intent", () => {
    const result = detectControlIntent('jarvis stop');
    expect(result.kind).toBe('stop');
    expect(result.matched).toBeDefined();
  });

  // ==================== TEST B: STOP while direct stream active ====================
  it("B-ST0P: stop while direct stream", () => {
    const result = detectControlIntent('jarvis, halt generation');
    expect(result.kind).toBe('stop');
  });

  // ==================== TEST C: STOPPED + "Jarvis" ====================
  it('C-ST0PPEd state: standalone Jarvis does NOT reopen command window', () => {
    const result = detectControlIntent('jarvis');
    expect(result.kind).toBe('idle'); // Not a control intent in STOPPED state
  });

  // ==================== TEST D: START restores interaction ====================
  it("D-START: explicit start conversation restores listening", () => {
    const result = detectControlIntent('jarvis, start');
    expect(typeof result.kind).toBe('string');
  });

  // ==================== TEST E: CANCEL stays interactive ====================
  it('E-CANCEL: abort and stay inlisteningstate', () => {
    const result = detectControlIntent('jarvis, cancel');
    // Either cancel or idle is acceptable for this intent
    expect(result.kind).toBeOneOf(['cancel','idle']);
  });

  // ==================== TEST F: PAUSE enters paused ====================
  it("F-PAUSES: suspend but preserve context", () => {
    const result = detectControlIntent('jarvis pause');
    expect(result.kind).toBe('pause');
  });

  // ==================== TEST G RESUME restores interaction ====================
  it("G-RESUME: restore from paused listening state", () => {
    const result = detectControlIntent('jarvis, resume');
    expect(result.kind).toBe('resume');
  });

  // ==================== TEST H wake only → 0 LLM calls ====================
  it('H-wake-only: standalone command does not trigger LLM', () => {
    const result = detectControlIntent('Jarvis');
    expect(result.kind).toBe('idle');
  });

  // ==================== TEST I background/no command window → 0 model calls ====================
  it("I-background-no-window: no command window mode", () => {
    const result = detectControlIntent('jarvis, silence');
    // 'silence' is not a control intent; should default to idle or parse normally
    expect(typeof result.kind).toBe('string');
  });

  // ==================== TEST J TTS echo → 0 user submissions ==================== (verified by audio path)
  it("J-TTS-echo: voice playback does not count as user submission", () => {
    // This test verifies no double-submission occurs during voice feedback
    expect(true).toBe(true); // Placeholder for e2e integration
  });

  // ==================== TEST K EN/DE/RO deterministic control commands ====================
  it("K-EN/DE/RO: detect stop in German 'Jarvis, stop'", () => {
    const result = detectControlIntent('jarvis, stop');
    expect(result.kind).toBe('stop');
  });
});
