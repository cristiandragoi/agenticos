/**
 * Stage 2H — Privacy/Runtime policy routing tests (8 mandated scenarios).
 * Pure policy logic — no real content, no network. Tests the decisions the
 * execution layer consumes; integration wiring is verified live.
 */
import { describe, it, expect } from 'vitest';
import {
  validatePolicy,
  parsePolicy,
  DEFAULT_POLICY,
  mayLeaveMachine,
  localPreferred,
  decideEscalation,
  shouldPreferCloud,
  isProviderAllowed,
  chatPolicyFlags,
  type ProjectPolicy,
} from '../services/policy/policyService.js';

const P = (privacy: any, runtime: any, cloudEscalation: any): ProjectPolicy => ({ privacy, runtime, cloudEscalation });

describe('policyService — validation', () => {
  it('accepts valid policies and rejects invalid values', () => {
    expect(validatePolicy({ privacy: 'public', runtime: 'auto', cloudEscalation: 'allowed' })).toEqual(
      { privacy: 'public', runtime: 'auto', cloudEscalation: 'allowed' },
    );
    expect(() => validatePolicy({ privacy: 'nope', runtime: 'auto', cloudEscalation: 'allowed' })).toThrow();
    expect(() => validatePolicy({ privacy: 'public', runtime: 'warp', cloudEscalation: 'allowed' })).toThrow();
    expect(() => validatePolicy(null)).toThrow();
  });

  it('rejects contradictory combinations', () => {
    // localOnly + unconditional cloud escalation is self-contradictory
    expect(() => validatePolicy({ privacy: 'internal', runtime: 'localOnly', cloudEscalation: 'allowed' })).toThrow();
    // secret content + cloudPreferred is self-contradictory
    expect(() => validatePolicy({ privacy: 'secret', runtime: 'cloudPreferred', cloudEscalation: 'allowed' })).toThrow();
    // localOnly + approvalRequired is consistent (escalation possible only via human)
    expect(validatePolicy({ privacy: 'internal', runtime: 'localOnly', cloudEscalation: 'approvalRequired' })).toBeTruthy();
  });

  it('parsePolicy falls back to the safe default on corruption', () => {
    expect(parsePolicy(null)).toEqual(DEFAULT_POLICY);
    expect(parsePolicy('not-json')).toEqual(DEFAULT_POLICY);
    expect(parsePolicy({ privacy: 'bad' })).toEqual(DEFAULT_POLICY);
  });
});

describe('policyService — the 8 mandated routing scenarios', () => {
  it('1. public + auto → cloud allowed, escalation allowed', () => {
    const p = P('public', 'auto', 'allowed');
    expect(mayLeaveMachine(p)).toBe(true);
    expect(decideEscalation(p).action).toBe('allow');
    expect(chatPolicyFlags(p)).toEqual({ disableFallback: false, allowEscalation: true });
  });

  it('2. internal + localPreferred → local first, cloud fallback allowed', () => {
    const p = P('internal', 'localPreferred', 'allowed');
    expect(localPreferred(p)).toBe(true);
    expect(mayLeaveMachine(p)).toBe(true);
    expect(decideEscalation(p).action).toBe('allow');
    expect(chatPolicyFlags(p)).toEqual({ disableFallback: false, allowEscalation: true });
  });

  it('3. sensitive + localOnly → content never leaves the machine', () => {
    const p = P('sensitive', 'localOnly', 'forbidden');
    expect(mayLeaveMachine(p)).toBe(false);
    expect(decideEscalation(p).action).toBe('block');
    const flags = chatPolicyFlags(p);
    expect(flags.disableFallback).toBe(true);
    expect(flags.allowEscalation).toBe(false);
    expect(isProviderAllowed(p, 'prov-ollama')).toBe(true);
    expect(isProviderAllowed(p, 'prov-openrouter')).toBe(false);
  });

  it('4. localOnly + local model failure → block, NEVER silent cloud send', () => {
    const p = P('sensitive', 'localOnly', 'approvalRequired');
    const d = decideEscalation(p);
    expect(d.action).toBe('block');
    expect(d.reason).toMatch(/localOnly/); // runtime restriction fires first — still a hard block
    // Even with escalationApproved, privacy dominates: fallback stays disabled.
    expect(chatPolicyFlags(p, { escalationApproved: true }).disableFallback).toBe(true);
    expect(chatPolicyFlags(p, { escalationApproved: true }).allowEscalation).toBe(false);
  });

  it('5. approvalRequired cloud escalation → approve-first, withheld without approval', () => {
    const p = P('internal', 'localPreferred', 'approvalRequired');
    expect(decideEscalation(p).action).toBe('approve-first');
    expect(chatPolicyFlags(p).allowEscalation).toBe(false);
    expect(chatPolicyFlags(p, { escalationApproved: true }).allowEscalation).toBe(true);
  });

  it('6. explicit allowed escalation (cloudAllowed) → gateway may escalate', () => {
    const p = P('internal', 'auto', 'allowed');
    expect(decideEscalation(p).action).toBe('allow');
    expect(chatPolicyFlags(p).allowEscalation).toBe(true);
  });

  it('7. provider/model truth: local always allowed; cloud gated by privacy', () => {
    expect(isProviderAllowed(P('secret', 'localOnly', 'forbidden'), 'ollama')).toBe(true);
    expect(isProviderAllowed(P('secret', 'localOnly', 'forbidden'), 'prov-openrouter')).toBe(false);
    expect(isProviderAllowed(P('public', 'auto', 'allowed'), 'prov-openrouter')).toBe(true);
  });

  it('8. hardware never overrides privacy: weak machine + localOnly stays local', () => {
    // The priority order is encoded structurally: shouldPreferCloud and
    // decideEscalation never consult hardware. localOnly blocks escalation
    // regardless of capability tier; cloudPreferred is blocked by privacy
    // even on a powerful machine.
    const weakLocalOnly = P('sensitive', 'localOnly', 'approvalRequired');
    expect(decideEscalation(weakLocalOnly).action).toBe('block');
    const secretCloudPreferredRejected = () => validatePolicy({ privacy: 'secret', runtime: 'cloudPreferred', cloudEscalation: 'allowed' });
    expect(secretCloudPreferredRejected).toThrow();
    expect(shouldPreferCloud(P('sensitive', 'cloudPreferred', 'allowed'))).toBe(false);
  });
});

describe('policyStore — persistence round-trip (scenario 8: restart truth)', () => {
  it('set → get returns exactly what was persisted; missing project → default', async () => {
    const { projectsStore } = await import('../services/projectsStore.js');
    const { policyStore } = await import('../services/policy/policyStore.js');
    const projectId = `proj-policy-test-${Date.now()}`;
    projectsStore.createProject({ id: projectId, name: 'Policy test project' });
    try {
      // Unset → default
      expect(policyStore.getPolicy(projectId)).toEqual(DEFAULT_POLICY);
      // Set a strict policy, read back via a fresh store call (the row is the
      // source of truth — a restart re-reads the same column).
      policyStore.setPolicy(projectId, { privacy: 'sensitive', runtime: 'localOnly', cloudEscalation: 'forbidden' });
      expect(policyStore.getPolicy(projectId)).toEqual({ privacy: 'sensitive', runtime: 'localOnly', cloudEscalation: 'forbidden' });
      // Unknown project → default, never throws
      expect(policyStore.getPolicy('proj-does-not-exist')).toEqual(DEFAULT_POLICY);
      expect(policyStore.getPolicy(null)).toEqual(DEFAULT_POLICY);
    } finally {
      projectsStore.deleteProject(projectId);
    }
  });

  it('setPolicy rejects invalid/contradictory input without persisting', async () => {
    const { projectsStore } = await import('../services/projectsStore.js');
    const { policyStore } = await import('../services/policy/policyStore.js');
    const projectId = `proj-policy-test-${Date.now()}`;
    projectsStore.createProject({ id: projectId, name: 'Policy reject test' });
    try {
      expect(() => policyStore.setPolicy(projectId, { privacy: 'internal', runtime: 'localOnly', cloudEscalation: 'allowed' })).toThrow();
      expect(policyStore.getPolicy(projectId)).toEqual(DEFAULT_POLICY); // untouched
    } finally {
      projectsStore.deleteProject(projectId);
    }
  });
});

describe('policyService — escalation decision matrix', () => {
  it('secret privacy blocks escalation under every runtime mode', () => {
    for (const runtime of ['auto', 'localPreferred', 'localOnly'] as const) {
      const p = P('secret', runtime, 'allowed');
      expect(decideEscalation(p).action).toBe('block');
    }
  });

  it('forbidden escalation blocks even for public content', () => {
    const p = P('public', 'auto', 'forbidden');
    expect(decideEscalation(p).action).toBe('block');
  });

  it('localOnly blocks before privacy is even consulted', () => {
    const p = P('public', 'localOnly', 'forbidden');
    expect(decideEscalation(p).action).toBe('block');
    expect(decideEscalation(p).reason).toMatch(/localOnly/);
  });
});
