/**
 * Adapter behavior contracts (v2): state mapping, node routing (owned by
 * v2's DEFAULT_NODES), active-node selection. Pure functions.
 */
import { describe, it, expect } from 'vitest';
import { mapAgenticState, pickActiveNode } from '../components/jarvis/jarvisVisualizationAdapter';
import { DEFAULT_NODES } from '../components/jarvis-visualization';

describe('jarvisVisualizationAdapter (v2)', () => {
  it('maps every AgenticOS orb state to a package state', () => {
    const cases: Array<[string, string]> = [
      ['idle', 'idle'],
      ['listening', 'listening'],
      ['transcribing', 'transcribing'],
      ['reasoning', 'thinking'],
      ['repairing', 'thinking'],
      ['executing', 'executing'],
      ['delegated', 'delegating'],
      ['warning', 'warning'],
      ['error', 'error'],
      ['completed', 'completed'],
      ['speaking', 'speaking'],
      ['offline', 'error'],
    ];
    for (const [orb, expected] of cases) {
      expect(mapAgenticState(orb).state).toBe(expected);
    }
  });

  it('v2 DEFAULT_NODES: 8 nodes, every one routed to a real destination, no Oracle', () => {
    expect(DEFAULT_NODES.length).toBe(8);
    for (const node of DEFAULT_NODES) {
      expect(node.route).toBeTruthy();
      expect(node.route!.startsWith('#/')).toBe(true);
    }
    expect(DEFAULT_NODES.some((n) => n.id === 'Oracle')).toBe(false);
  });

  it('picks the strongest active node above the 0.5 threshold', () => {
    expect(pickActiveNode({ Memory: 1, Hermes: 0.2 })).toBe('Memory');
    expect(pickActiveNode({ Memory: 0.3 })).toBeNull();
    expect(pickActiveNode(undefined)).toBeNull();
  });
});
