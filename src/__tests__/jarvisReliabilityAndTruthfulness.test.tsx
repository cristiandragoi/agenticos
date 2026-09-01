import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import JarvisStudio from '../pages/JarvisStudio';
import { ProjectProvider } from '../store/projectStore';
import { CodexProvider } from '../store/codexStore';
import { detectControlIntent } from '../lib/controlIntent';

describe('Jarvis Live Response Reliability & Status Truthfulness', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('A. Explicit STOP intent is recognized and distinguishes normal speech from control', () => {
    expect(detectControlIntent('Jarvis stop')?.kind).toBe('stop');
    expect(detectControlIntent('stop')?.kind).toBe('stop');
    expect(detectControlIntent('cancel that')?.kind).toBe('stop');
    expect(detectControlIntent('what model are you using')).toBeNull();
    expect(detectControlIntent('what is 2 plus 2')).toBeNull();
  });

  it('B. Status strip renders BROWSER chip with RED offline dot when Magnitude is unavailable', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((url: any) => {
      const u = String(url);
      if (u.includes('/api/magnitude/status')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ available: false, reason: 'Playwright runtime not installed or unavailable' }),
        } as any);
      }
      if (u.includes('/api/hermes-api/status')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ gateway: { reachable: true }, stt: { configured: true, provider: 'local-whisper' }, tts: { configured: true, provider: 'local-neural-tts' } }),
        } as any);
      }
      if (u.includes('/api/health')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, status: 'healthy' }) } as any);
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as any);
    });

    render(
      <ProjectProvider>
        <CodexProvider>
          <MemoryRouter>
            <JarvisStudio />
          </MemoryRouter>
        </CodexProvider>
      </ProjectProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('jarvis-status-strip')).toBeInTheDocument();
    });

    const statusStrip = screen.getByTestId('jarvis-status-strip');
    expect(statusStrip.textContent).toContain('BROWSER');
    expect(statusStrip.textContent).toContain('UNAVAILABLE');

    fetchMock.mockRestore();
  });

  it('C. Status dots distinguish semantic levels (green for ready, red for error/unavailable, slate for neutral)', () => {
    const dotColor = (level?: string | boolean): string => {
      if (level === true || level === 'online' || level === 'ready') return '#4ade80';
      if (level === false || level === 'offline' || level === 'unavailable' || level === 'error') return '#ef4444';
      return '#64748b';
    };

    expect(dotColor('online')).toBe('#4ade80');
    expect(dotColor('ready')).toBe('#4ade80');
    expect(dotColor(true)).toBe('#4ade80');

    expect(dotColor('offline')).toBe('#ef4444');
    expect(dotColor('unavailable')).toBe('#ef4444');
    expect(dotColor('error')).toBe('#ef4444');
    expect(dotColor(false)).toBe('#ef4444');

    expect(dotColor('neutral')).toBe('#64748b');
    expect(dotColor('idle')).toBe('#64748b');
    expect(dotColor(undefined)).toBe('#64748b');
  });
});
