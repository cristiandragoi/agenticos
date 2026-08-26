/**
 * actionResolver.test.ts — Phase 2D canonical action resolver.
 * Pure logic tests (no DB).
 */
import { describe, it, expect } from 'vitest';
import { resolveAction, type ResolverExperiment } from '../services/revenueOperator/actionResolver.js';

function exp(overrides: Partial<ResolverExperiment> = {}): ResolverExperiment {
  return {
    id: 'expt-test-1',
    engine: 'digital_products',
    status: 'DISCOVERED',
    hasOpenGate: false,
    hasResolvedGate: false,
    hasComplianceRecord: false,
    ...overrides,
  };
}

describe('Digital Products path', () => {
  it('DISCOVERED → DIGITAL_VALIDATE', () => {
    expect(resolveAction(exp({ status: 'DISCOVERED' })).actionType).toBe('DIGITAL_VALIDATE');
  });
  it('VALIDATING → DIGITAL_DECIDE', () => {
    expect(resolveAction(exp({ status: 'VALIDATING' })).actionType).toBe('DIGITAL_DECIDE');
  });
  it('APPROVED → DIGITAL_BUILD (prefers rt-codex, build caps)', () => {
    const a = resolveAction(exp({ status: 'APPROVED' }));
    expect(a.actionType).toBe('DIGITAL_BUILD');
    expect(a.preferredExecutorId).toBe('rt-codex');
    expect(a.requiredCapabilities).toContain('process_exec');
  });
  it('BUILDING → NO_WORK (in flight)', () => {
    expect(resolveAction(exp({ status: 'BUILDING' })).actionType).toBe('NO_WORK');
  });
  it('QA → DIGITAL_WAIT_FOR_PUBLISH_GATE (create Shopify gate)', () => {
    expect(resolveAction(exp({ status: 'QA' })).actionType).toBe('DIGITAL_WAIT_FOR_PUBLISH_GATE');
  });
  it('open Shopify gate → DIGITAL_WAIT_FOR_PUBLISH_GATE (hold)', () => {
    const a = resolveAction(exp({ status: 'READY_TO_PUBLISH', hasOpenGate: true, openGateType: 'SHOPIFY_AUTH_REQUIRED' }));
    expect(a.actionType).toBe('DIGITAL_WAIT_FOR_PUBLISH_GATE');
  });
  it('READY_TO_PUBLISH + resolved gate → BLOCKED_INTEGRATION_REQUIRED (no fake publish)', () => {
    const a = resolveAction(exp({ status: 'READY_TO_PUBLISH', hasResolvedGate: true }));
    expect(a.actionType).toBe('BLOCKED_INTEGRATION_REQUIRED');
    expect(a.blockedReason).toBe('SHOPIFY_PUBLISH_NOT_IMPLEMENTED');
  });
  it('PUBLISHING → BLOCKED_INTEGRATION_REQUIRED', () => {
    expect(resolveAction(exp({ status: 'PUBLISHING' })).actionType).toBe('BLOCKED_INTEGRATION_REQUIRED');
  });
  it('KILLED → NO_WORK (terminal)', () => {
    expect(resolveAction(exp({ status: 'KILLED' })).actionType).toBe('NO_WORK');
  });
});

describe('German SME path', () => {
  const sme = (o: Partial<ResolverExperiment> = {}) => exp({ engine: 'german_sme', ...o });

  it('DISCOVERED → SME_QUALIFY (inspect via Hermes)', () => {
    const a = resolveAction(sme({ status: 'DISCOVERED' }));
    expect(a.actionType).toBe('SME_QUALIFY');
    expect(a.preferredExecutorId).toBe('rt-hermes');
    expect(a.requiredCapabilities).toContain('external_web');
  });
  it('VALIDATING → SME_QUALIFY (qualify/decide)', () => {
    expect(resolveAction(sme({ status: 'VALIDATING' })).actionType).toBe('SME_QUALIFY');
  });
  it('APPROVED without compliance → SME_FIND_CONTACT', () => {
    expect(resolveAction(sme({ status: 'APPROVED', hasComplianceRecord: false })).actionType).toBe('SME_FIND_CONTACT');
  });
  it('APPROVED with compliance → SME_CREATE_OFFER', () => {
    expect(resolveAction(sme({ status: 'APPROVED', hasComplianceRecord: true })).actionType).toBe('SME_CREATE_OFFER');
  });
  it('BUILDING → SME_WAIT_FOR_OUTBOUND_GATE (create outbound gate)', () => {
    expect(resolveAction(sme({ status: 'BUILDING' })).actionType).toBe('SME_WAIT_FOR_OUTBOUND_GATE');
  });
  it('open OUTBOUND gate → SME_WAIT_FOR_OUTBOUND_GATE (hold)', () => {
    const a = resolveAction(sme({ status: 'QA', hasOpenGate: true, openGateType: 'OUTBOUND_APPROVAL' }));
    expect(a.actionType).toBe('SME_WAIT_FOR_OUTBOUND_GATE');
  });
  it('QA/READY_TO_PUBLISH + resolved gate → BLOCKED_INTEGRATION_REQUIRED (no fake send)', () => {
    expect(resolveAction(sme({ status: 'QA', hasResolvedGate: true })).actionType).toBe('BLOCKED_INTEGRATION_REQUIRED');
    expect(resolveAction(sme({ status: 'READY_TO_PUBLISH', hasResolvedGate: true })).blockedReason).toBe('OUTREACH_SEND_NOT_IMPLEMENTED');
  });
  it('KILLED → NO_WORK', () => {
    expect(resolveAction(sme({ status: 'KILLED' })).actionType).toBe('NO_WORK');
  });
});

describe('Safety', () => {
  it('unknown engine → NO_WORK (no blind advancement)', () => {
    expect(resolveAction(exp({ engine: 'bogus' })).actionType).toBe('NO_WORK');
  });
  it('unknown status → NO_WORK', () => {
    expect(resolveAction(exp({ status: 'BOGUS' })).actionType).toBe('NO_WORK');
  });
});
