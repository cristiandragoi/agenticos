import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import SelfHealPage from '../pages/SelfHealPage';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('renders actual API envelopes and surfaces rejected repair actions', async () => {
  const incident = { incidentId: 'voice-1', status: 'AWAITING_APPROVAL', component: 'Jarvis voice', symptom: 'No sound', priority: 'high' };
  vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
    let data: any;
    if (options?.method === 'POST') return { ok: false, json: async () => ({ error: 'Repair is not ready for approval' }) };
    if (url.endsWith('/status')) data = { status: 'healthy', activeIncidentCount: 1 };
    else if (url.endsWith('/incidents')) data = { incidents: [incident] };
    else data = { incident, diagnoses: [], attempts: [{ fullDiff: 'Reviewed diff', testReport: { overallVerdict: 'PASS' }, argusVerdict: 'approve' }], currentState: null };
    return { ok: true, json: async () => data };
  }));
  render(<SelfHealPage />);
  expect(await screen.findByText('HEALTHY')).toBeTruthy();
  fireEvent.click(await screen.findByText('Jarvis voice'));
  expect(await screen.findByText('Reviewed diff')).toBeTruthy();
  fireEvent.click(screen.getByText('APPROVE'));
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Repair is not ready for approval');
});
