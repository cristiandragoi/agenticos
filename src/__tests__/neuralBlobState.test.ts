import { describe, it, expect } from 'vitest';
import {
  toBlobVisualState, nodePulse, modelLabel, NODE_ROUTES, NODE_DIRECTION,
} from '../components/jarvis/neuralBlobState';

describe('neuralBlobState', () => {
  it('maps real runtime states to the seven-state blob machine', () => {
    expect(toBlobVisualState('idle')).toBe('IDLE');
    expect(toBlobVisualState('listening')).toBe('LISTENING');
    expect(toBlobVisualState('reasoning')).toBe('THINKING');
    expect(toBlobVisualState('planning')).toBe('THINKING');
    expect(toBlobVisualState('executing')).toBe('ACTING');
    expect(toBlobVisualState('delegated')).toBe('ACTING');
    expect(toBlobVisualState('speaking')).toBe('SPEAKING');
    expect(toBlobVisualState('completed')).toBe('COMPLETED');
    expect(toBlobVisualState('error')).toBe('ERROR');
    expect(toBlobVisualState('offline')).toBe('ERROR');
  });

  it('activates nodes only from real activity (others stay passive)', () => {
    const p = nodePulse({ Hermes: 1, Runs: 0.6, CodeX: 0.9, Magnitude: 0.4 });
    expect(p.HERMES).toBe(1);
    expect(p.RUNS).toBe(0.6);
    expect(p.CODEX).toBe(0.9);
    expect(p.MAGNITUDE).toBe(0.4);
    expect(p.MEMORY).toBe(0);
    expect(p.KNOWLEDGE).toBe(0);
    expect(p.PROJECTS).toBe(0);
    expect(p.ARTIFACTS).toBe(0);
    expect(p.VISION).toBe(0);
  });

  it('clamps activity values and ignores unknown keys', () => {
    const p = nodePulse({ Memory: 5, CodeX: 1, unknown: 0.9 });
    expect(p.MEMORY).toBe(1);
    // CodeX is a KNOWN contextual capability now → maps to CODEX.
    expect(p.CODEX).toBe(1);
    expect((p as Record<string, unknown>).unknown).toBeUndefined();
  });

  it('renders truthful model identity', () => {
    expect(modelLabel('ollama', 'qwen3.5:4b')).toBe('ollama · qwen3.5:4b');
    expect(modelLabel('ollama', null)).toBe('ollama');
    expect(modelLabel(null, null)).toBe('—');
  });

  it('maps every node to an existing navigation destination + direction', () => {
    for (const node of ['MEMORY', 'KNOWLEDGE', 'PROJECTS', 'HERMES', 'RUNS', 'ARTIFACTS', 'VISION', 'CODEX', 'MAGNITUDE'] as const) {
      expect(NODE_ROUTES[node]).toMatch(/^\//);
      expect(['in', 'out']).toContain(NODE_DIRECTION[node]);
    }
  });
});
