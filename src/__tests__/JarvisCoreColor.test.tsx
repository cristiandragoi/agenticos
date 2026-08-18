/**
 * Color-contract tests for the programmatic humanoid (v2).
 * The visual color language is enforced through the v2 package's
 * stateColor() + the AgenticOS adapter (orb state → package state).
 */
import { describe, it, expect } from 'vitest';
import { mapAgenticState } from '../components/jarvis/jarvisVisualizationAdapter';
import { stateColor, CHANNELS } from '../components/jarvis-visualization';
import { JARVIS_HEAD_COLORS } from '../components/jarvis/JarvisCore';

describe('Jarvis programmatic humanoid (v2) — state → color contract', () => {
  it('maps every AgenticOS orb state to the spec channel family', () => {
    const cases: Array<[string, string]> = [
      ['idle', CHANNELS.cyan],
      ['listening', CHANNELS.yellow],
      ['transcribing', CHANNELS.yellow],
      ['reasoning', CHANNELS.purple],
      ['repairing', CHANNELS.purple],
      ['executing', CHANNELS.cyan],
      ['delegated', CHANNELS.pink],
      ['speaking', CHANNELS.cyan],
      ['warning', CHANNELS.yellow],
      ['error', CHANNELS.red],
      ['offline', CHANNELS.red],
    ];
    for (const [orb, channel] of cases) {
      const mapped = mapAgenticState(orb);
      expect(stateColor(mapped.state, mapped.severity)).toBe(channel);
    }
  });

  it('maps error/offline to severity + offline disconnects', () => {
    expect(mapAgenticState('error').severity).toBe('high');
    expect(mapAgenticState('warning').severity).toBe('medium');
    const off = mapAgenticState('offline');
    expect(off.severity).toBe('critical');
    expect(off.isConnected).toBe(false);
  });

  it('keeps the AgenticOS head-color contract (idle turquoise, delegated pink, error red)', () => {
    expect(JARVIS_HEAD_COLORS.idle.main.toLowerCase()).toBe('#00eaff');
    expect(JARVIS_HEAD_COLORS.delegated.main.toLowerCase()).toBe('#ff66d9');
    expect(JARVIS_HEAD_COLORS.error.main.toLowerCase()).toBe('#ff4d5f');
  });
});
