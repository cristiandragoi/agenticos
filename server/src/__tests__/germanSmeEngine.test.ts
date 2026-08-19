/**
 * germanSmeEngine.test.ts — M6 deterministic logic tests (pure, no DB/workers).
 */
import { describe, it, expect } from 'vitest';
import { smeNextAction } from '../services/revenueOperator/germanSmeEngine.js';

describe('smeNextAction (SME pipeline mapping)', () => {
  it('DISCOVERED → inspect', () => expect(smeNextAction('DISCOVERED')).toBe('inspect'));
  it('VALIDATING → qualify', () => expect(smeNextAction('VALIDATING')).toBe('qualify'));
  it('APPROVED → find_contact', () => expect(smeNextAction('APPROVED')).toBe('find_contact'));
  it('BUILDING → gate', () => expect(smeNextAction('BUILDING')).toBe('gate'));
  it('QA → approve_outreach', () => expect(smeNextAction('QA')).toBe('approve_outreach'));
  it('READY_TO_PUBLISH → outreach', () => expect(smeNextAction('READY_TO_PUBLISH')).toBe('outreach'));
  it('PUBLISHING → track', () => expect(smeNextAction('PUBLISHING')).toBe('track'));
  it('LIVE → outcome', () => expect(smeNextAction('LIVE')).toBe('outcome'));
  it('WON/LOST/KILLED → null (terminal)', () => {
    expect(smeNextAction('WON')).toBeNull();
    expect(smeNextAction('LOST')).toBeNull();
    expect(smeNextAction('KILLED')).toBeNull();
  });
  it('unknown status → null (no blind advancement)', () => expect(smeNextAction('BOGUS')).toBeNull());
});
