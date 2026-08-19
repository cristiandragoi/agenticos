/**
 * digitalProductEngine.test.ts — M5 deterministic logic tests.
 * Tests the pure lifecycle/decision functions (no DB, no workers).
 */
import { describe, it, expect } from 'vitest';
import { decideGoNoGo } from '../services/revenueOperator/revenueEngine.js';
import { nextAction } from '../services/revenueOperator/digitalProductEngine.js';

describe('decideGoNoGo (pure GO/NO-GO decision)', () => {
  it('GO when score meets the threshold', () => {
    expect(decideGoNoGo(0.5, 0.35).go).toBe(true);
  });

  it('GO when score exactly equals the threshold', () => {
    expect(decideGoNoGo(0.35, 0.35).go).toBe(true);
  });

  it('NO-GO when score is below the threshold', () => {
    expect(decideGoNoGo(0.2, 0.35).go).toBe(false);
  });

  it('NO-GO on a non-finite score', () => {
    expect(decideGoNoGo(NaN, 0.35).go).toBe(false);
    expect(decideGoNoGo(Infinity, 0.35).go).toBe(false);
  });

  it('uses a conservative default threshold', () => {
    // Neutral profile ≈ 0.25 (0.5^6 / 0.5^4) must be NO-GO by default.
    expect(decideGoNoGo(0.25).go).toBe(false);
  });
});

describe('nextAction (lifecycle mapping)', () => {
  it('maps DISCOVERED → validate', () => {
    expect(nextAction('DISCOVERED')).toBe('validate');
  });
  it('maps VALIDATING → decide', () => {
    expect(nextAction('VALIDATING')).toBe('decide');
  });
  it('maps APPROVED → build', () => {
    expect(nextAction('APPROVED')).toBe('build');
  });
  it('maps BUILDING → qa', () => {
    expect(nextAction('BUILDING')).toBe('qa');
  });
  it('maps QA → ready', () => {
    expect(nextAction('QA')).toBe('ready');
  });
  it('maps LIVE/ITERATING/SCALING → measure', () => {
    expect(nextAction('LIVE')).toBe('measure');
    expect(nextAction('ITERATING')).toBe('measure');
    expect(nextAction('SCALING')).toBe('measure');
  });
  it('maps KILLED → null (terminal)', () => {
    expect(nextAction('KILLED')).toBeNull();
  });
  it('maps unknown status → null (no blind advancement)', () => {
    expect(nextAction('BOGUS_STATUS')).toBeNull();
  });
});
