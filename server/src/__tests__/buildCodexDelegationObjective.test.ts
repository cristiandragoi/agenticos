// buildCodexDelegationObjective.test.ts — regression: the full original
// objective must reach in-repo CodeX, even when the Hermes planner distills
// its proposed task down to a read-only "inspect …" scope.
import { describe, it, expect } from 'vitest';
import { buildCodexDelegationObjective } from '../services/backgroundTasks/adapters';

describe('buildCodexDelegationObjective', () => {
  it('preserves the full original objective first', () => {
    const original = 'add a regression test and run npx vitest';
    const out = buildCodexDelegationObjective(original, { objective: 'inspect voiceSessionConfig.ts' });
    expect(out).toContain(original);
    expect(out.indexOf(original)).toBe(0);
  });

  it('appends the Hermes-proposed scope and acceptance criteria', () => {
    const out = buildCodexDelegationObjective('add test', {
      objective: 'inspect src/lib/voiceSessionConfig.ts',
      acceptanceCriteria: 'test must assert locale en-AU',
    });
    expect(out).toContain('Hermes-proposed scope: inspect src/lib/voiceSessionConfig.ts');
    expect(out).toContain('Hermes-proposed acceptance criteria: test must assert locale en-AU');
  });

  it('does not drop the implementation verb when the proposal is read-only', () => {
    const out = buildCodexDelegationObjective('add the test and run vitest', { objective: 'inspect the file' });
    expect(out).toMatch(/add the test and run vitest/);
    expect(out).toMatch(/run vitest/);
  });

  it('handles a missing proposed task', () => {
    const out = buildCodexDelegationObjective('fix the bug', null);
    expect(out).toBe('fix the bug');
  });

  it('handles an empty original objective without producing a leading newline', () => {
    const out = buildCodexDelegationObjective('', { objective: 'scope' });
    expect(out.startsWith('\n')).toBe(false);
    expect(out).toContain('Hermes-proposed scope: scope');
  });
});
