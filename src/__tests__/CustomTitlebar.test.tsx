/**
 * Window-control regression contract (stabilization freeze).
 *
 * The custom titlebar renders minimize/maximize/close and dispatches the
 * correct IPC channels; nothing hides them. Live Electron verification of
 * the actual minimize/maximize/close behavior is covered by the golden
 * smoke probe (scripts/golden-smoke.mjs, CDP) because jsdom cannot drive
 * BrowserWindow.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import CustomTitlebar from '../components/layout/CustomTitlebar';

vi.mock('../GatewayStatusChip', () => ({ default: () => <div data-testid="gateway-chip-mock" /> }));
vi.mock('./BackendStatusIndicator', () => ({ default: () => <div data-testid="backend-chip-mock" /> }));

const sent: string[] = [];

beforeEach(() => {
  sent.length = 0;
  (window as any).ipcRenderer = {
    send: vi.fn((channel: string) => { sent.push(channel); }),
    invoke: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  };
});

describe('titlebar window controls (§2/§3 stabilization)', () => {
  it('renders the control container with all three buttons', () => {
    render(<CustomTitlebar />);
    expect(screen.getByTestId('titlebar-window-controls')).toBeTruthy();
    expect(screen.getByTestId('titlebar-minimize')).toBeTruthy();
    expect(screen.getByTestId('titlebar-maximize')).toBeTruthy();
    expect(screen.getByTestId('titlebar-close')).toBeTruthy();
  });

  it('buttons are visible (not hidden by display/visibility/opacity)', () => {
    render(<CustomTitlebar />);
    for (const id of ['titlebar-window-controls', 'titlebar-minimize', 'titlebar-maximize', 'titlebar-close']) {
      const el = screen.getByTestId(id);
      const s = window.getComputedStyle(el);
      expect(s.display).not.toBe('none');
      expect(s.visibility).not.toBe('hidden');
      expect(Number(s.opacity)).toBeGreaterThan(0);
    }
  });

  it('buttons are clickable (not pointer-events:none / no-drag)', () => {
    render(<CustomTitlebar />);
    for (const id of ['titlebar-minimize', 'titlebar-maximize', 'titlebar-close']) {
      const el = screen.getByTestId(id);
      const s = window.getComputedStyle(el);
      expect(s.pointerEvents).not.toBe('none');
    }
    // The component's own stylesheet keeps the drag region off the buttons
    // (jsdom cannot compute vendor-prefixed CSS, so assert the rule exists).
    const styleTag = [...document.querySelectorAll('style')].map((st) => st.textContent || '').join('\n');
    expect(styleTag).toContain('.titlebar-btn');
    expect(styleTag.replace(/\s+/g, ' ')).toContain('-webkit-app-region: no-drag');
  });

  it('minimize dispatches window-minimize', () => {
    render(<CustomTitlebar />);
    fireEvent.click(screen.getByTestId('titlebar-minimize'));
    expect(sent).toContain('window-minimize');
  });

  it('maximize dispatches window-maximize (main toggles maximize/unmaximize)', () => {
    render(<CustomTitlebar />);
    fireEvent.click(screen.getByTestId('titlebar-maximize'));
    expect(sent).toContain('window-maximize');
  });

  it('close dispatches window-close', () => {
    render(<CustomTitlebar />);
    fireEvent.click(screen.getByTestId('titlebar-close'));
    expect(sent).toContain('window-close');
  });

  it('controls sit inside the draggable titlebar (no-drag island)', () => {
    render(<CustomTitlebar />);
    const container = screen.getByTestId('titlebar-window-controls');
    expect(container.getAttribute('data-app-region')).toBe('no-drag');
  });
});
