import { describe, expect, it } from 'vitest';
import { findRepairTarget } from '../services/agentTeams/repairRouting.js';

const sheet = (agents: any[], sequence?: string[]) => ({
  agents,
  executionSequence: sequence || agents.map(a => a.id)
});

describe('findRepairTarget', () => {
  it('prefers an exact Builder role regardless of the generated id', () => {
    const target = findRepairTarget(sheet([
      { id: 'a1', role: 'Planner' },
      { id: 'a2', role: 'Builder' },
      { id: 'a3', role: 'Verifier' }
    ]));
    expect(target?.agentId).toBe('a2');
    expect(target?.index).toBe(1);
    expect(target?.reason).toContain('Builder');
  });

  it('matches roles case-insensitively', () => {
    const target = findRepairTarget(sheet([
      { id: 'x1', role: 'planner' },
      { id: 'builder2', role: 'BUILDER' }
    ]));
    expect(target?.agentId).toBe('builder2');
  });

  it('falls back to Implementer, then Developer, when no Builder exists', () => {
    const impl = findRepairTarget(sheet([
      { id: 'a1', role: 'Planner' },
      { id: 'a2', role: 'Implementer' },
      { id: 'a3', role: 'Developer' }
    ]));
    expect(impl?.agentId).toBe('a2');

    const dev = findRepairTarget(sheet([
      { id: 'a1', role: 'Planner' },
      { id: 'a9', role: 'Developer' }
    ]));
    expect(dev?.agentId).toBe('a9');
  });

  it('selects the agent that declared the failed artifact when no repair role exists', () => {
    const target = findRepairTarget(sheet([
      { id: 'a1', role: 'Planner' },
      { id: 'a2', role: 'Designer', outputArtifacts: ['src/app.ts'] }
    ]), ['src/app.ts']);
    expect(target?.agentId).toBe('a2');
    expect(target?.reason).toContain('src/app.ts');
  });

  it('returns null when nothing can be routed (clear repair-routing failure)', () => {
    const target = findRepairTarget(sheet([
      { id: 'a1', role: 'Planner' },
      { id: 'a3', role: 'Verifier' }
    ]), ['missing.txt']);
    expect(target).toBeNull();
  });
});
