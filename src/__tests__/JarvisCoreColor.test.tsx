/**
 * Color-contract tests for the programmatic humanoid (Slice 0 correction).
 * The visual color language (idle=turquoise, delegated=pink, error=red, …)
 * is now enforced through the ADAPTER: AgenticOS orb state → package
 * channel → channel color. These tests assert that behavior contract
 * instead of canvas fillStyle strings (the old raster mechanism is gone).
 */
import { describe, it, expect } from 'vitest';
import { mapAgenticState } from '../components/jarvis/jarvisVisualizationAdapter';
import { STATE_CHANNEL_MAP, CHANNEL_COLORS } from '../components/jarvis-visualization';
import { JARVIS_HEAD_COLORS } from '../components/jarvis/JarvisCore';

describe('Jarvis programmatic humanoid — state → color contract', () => {
  it('maps every AgenticOS orb state to the spec channel family', () => {
    const cases: Array<[string, string]> = [
      ['idle', 'cyan'],        // turquoise identity #00e5ff
      ['listening', 'yellow'], // attention / listening
      ['transcribing', 'yellow'],
      ['reasoning', 'purple'], // deep processing
      ['repairing', 'purple'],
      ['executing', 'cyan'],
      ['delegated', 'pink'],   // delegation / Hermes
      ['speaking', 'cyan'],
      ['warning', 'yellow'],
      ['error', 'red'],
      ['offline', 'red'],
    ];
    for (const [orb, channel] of cases) {
      const mapped = mapAgenticState(orb);
      expect(STATE_CHANNEL_MAP[mapped.state]).toBe(channel);
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
    expect(JARVIS_HEAD_COLORS.idle.main.toLowerCase()).toBe('#00e5ff');
    expect(JARVIS_HEAD_COLORS.delegated.main.toLowerCase()).toBe('#ec4899');
    expect(JARVIS_HEAD_COLORS.error.main.toLowerCase()).toBe('#ef4444');
    expect(CHANNEL_COLORS.cyan).toBe('#00e5ff');
  });
});
