/**
 * Adapter behavior contracts (Slice 0): state mapping, node routing,
 * visible-node set. Pure functions — no rendering.
 */
import { describe, it, expect } from 'vitest';
import { mapAgenticState, NODE_ROUTES, VISIBLE_NODES, pickActiveNode } from '../components/jarvis/jarvisVisualizationAdapter';

describe('jarvisVisualizationAdapter', () => {
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

  it('every visible node routes to a real destination (no fake pages)', () => {
    for (const node of VISIBLE_NODES) {
      const route = NODE_ROUTES[node];
      expect(route).toBeTruthy();
      expect(route!.startsWith('#/')).toBe(true);
    }
  });

  it('Oracle has no destination yet, so it is NOT in the visible set', () => {
    expect(VISIBLE_NODES).not.toContain('Oracle');
    expect(NODE_ROUTES.Oracle).toBeUndefined();
  });

  it('picks the strongest active node above the 0.5 threshold', () => {
    expect(pickActiveNode({ Memory: 1, Hermes: 0.2 })).toBe('Memory');
    expect(pickActiveNode({ Memory: 0.3 })).toBeNull();
    expect(pickActiveNode(undefined)).toBeNull();
  });
});
