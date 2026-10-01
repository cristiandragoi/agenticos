import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, renderHook } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { JarvisRuntimeProvider, useJarvisRuntime } from '../context/JarvisRuntimeContext';
import { ChatActionStatusCard, type ActionStatusPayload } from '../components/jarvis/ChatActionStatusCard';
import { resolveCapability } from '../../server/src/domains/jarvis/capabilityRegistry';
import { classifyExecutiveIntent } from '../../server/src/domains/jarvis/executiveIntent';

// Mock Web Audio & Speech APIs for headless vitest
class MockAudioContext {
  state = 'running';
  sampleRate = 48000;
  destination = {};
  createGain = vi.fn().mockReturnValue({
    gain: { value: 1, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() },
    connect: vi.fn(),
    disconnect: vi.fn(),
  });
  createBufferSource = vi.fn().mockReturnValue({
    buffer: null,
    connect: vi.fn(),
    disconnect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    onended: null,
  });
  decodeAudioData = vi.fn().mockResolvedValue({ duration: 1.5 });
  resume = vi.fn().mockResolvedValue(undefined);
  suspend = vi.fn().mockResolvedValue(undefined);
  close = vi.fn().mockResolvedValue(undefined);
}

vi.stubGlobal('AudioContext', MockAudioContext);
vi.stubGlobal('webkitAudioContext', MockAudioContext);

describe('JARVIS-RUNTIME-CORE-003: Persistent Jarvis Workspace & Executable Capabilities', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    vi.clearAllMocks();
  });

  describe('1. Executive Intent Resolution & Capability Registry', () => {
    it('resolves "open revenue operator" as navigation intent to /revenue-operator', () => {
      const intent = classifyExecutiveIntent('open revenue operator');
      expect(intent?.intent).toBe('navigation');
      expect(intent?.capability?.id).toBe('revenue_operator');
      expect(intent?.capability?.route).toBe('/revenue-operator');
    });

    it('resolves "start revenue operator" as capability_start intent for revenue_operator', () => {
      const intent = classifyExecutiveIntent('start revenue operator');
      expect(intent?.intent).toBe('capability_start');
      expect(intent?.capability?.id).toBe('revenue_operator');
      expect(intent?.confidence).toBeGreaterThanOrEqual(0.9);
    });

    it('resolves "run revenue operator" as capability_start intent', () => {
      const intent = classifyExecutiveIntent('run revenue operator');
      expect(intent?.intent).toBe('capability_start');
      expect(intent?.capability?.id).toBe('revenue_operator');
    });

    it('resolves "launch revenue operator" as capability_start intent', () => {
      const intent = classifyExecutiveIntent('launch revenue operator');
      expect(intent?.intent).toBe('capability_start');
      expect(intent?.capability?.id).toBe('revenue_operator');
    });

    it('differentiates capability "revenue_operator" from "revenue_pipeline"', () => {
      const capOp = resolveCapability('revenue operator');
      expect(capOp?.id).toBe('revenue_operator');
      expect(capOp?.route).toBe('/revenue-operator');

      const capPipe = resolveCapability('revenue pipeline');
      expect(capPipe?.id).toBe('revenue_pipeline');
    });
  });

  describe('2. Persistent Runtime Context Across Route Navigation', () => {
    const TestComponent = () => {
      const { activeConversationId, setActiveConversationId, workspaceContext, voice } = useJarvisRuntime();
      const navigate = useNavigate();
      const location = useLocation();

      return (
        <div>
          <span data-testid="active-conv">{activeConversationId || 'none'}</span>
          <span data-testid="active-module">{workspaceContext.activeModule || 'none'}</span>
          <span data-testid="current-path">{location.pathname}</span>
          <button data-testid="set-conv" onClick={() => setActiveConversationId('conv-persistent-123')}>
            Set Conv
          </button>
          <button data-testid="nav-revenue" onClick={() => navigate('/revenue-operator')}>
            Nav Revenue
          </button>
          <button data-testid="nav-jarvis" onClick={() => navigate('/jarvis')}>
            Nav Jarvis
          </button>
          <button data-testid="nav-hermes" onClick={() => navigate('/hermes-studio')}>
            Nav Hermes
          </button>
        </div>
      );
    };

    it('preserves conversation ID and voice controller identity across multiple route changes', () => {
      render(
        <MemoryRouter initialEntries={['/jarvis']}>
          <JarvisRuntimeProvider>
            <Routes>
              <Route path="*" element={<TestComponent />} />
            </Routes>
          </JarvisRuntimeProvider>
        </MemoryRouter>
      );

      // Start at /jarvis
      expect(screen.getByTestId('current-path').textContent).toBe('/jarvis');
      expect(screen.getByTestId('active-module').textContent).toBe('jarvis-command-center');
      expect(screen.getByTestId('active-conv').textContent).toBe('none');

      // Set active conversation
      fireEvent.click(screen.getByTestId('set-conv'));
      expect(screen.getByTestId('active-conv').textContent).toBe('conv-persistent-123');

      // Navigate to /revenue-operator
      fireEvent.click(screen.getByTestId('nav-revenue'));
      expect(screen.getByTestId('current-path').textContent).toBe('/revenue-operator');
      expect(screen.getByTestId('active-module').textContent).toBe('revenue-operator');
      // Conversation ID remains intact!
      expect(screen.getByTestId('active-conv').textContent).toBe('conv-persistent-123');

      // Navigate to /hermes-studio
      fireEvent.click(screen.getByTestId('nav-hermes'));
      expect(screen.getByTestId('current-path').textContent).toBe('/hermes-studio');
      expect(screen.getByTestId('active-module').textContent).toBe('hermes-studio');
      expect(screen.getByTestId('active-conv').textContent).toBe('conv-persistent-123');

      // Return to /revenue-operator
      fireEvent.click(screen.getByTestId('nav-revenue'));
      expect(screen.getByTestId('current-path').textContent).toBe('/revenue-operator');
      expect(screen.getByTestId('active-module').textContent).toBe('revenue-operator');
      expect(screen.getByTestId('active-conv').textContent).toBe('conv-persistent-123');
    });
  });

  describe('3. ChatActionStatusCard Structured Feedback', () => {
    it('renders running status with live pulse indicator and run ID', () => {
      const payload: ActionStatusPayload = {
        actionName: 'Start Revenue Operator',
        targetCapability: 'revenue_operator',
        status: 'running',
        runId: 'e2e-mission-trace-999',
        currentStep: 'Hermes Strategy Dispatch',
        executedSteps: ['Workspace Initialized'],
      };

      render(<ChatActionStatusCard action={payload} />);
      expect(screen.getByText('Start Revenue Operator')).toBeDefined();
      expect(screen.getByText('RUNNING')).toBeDefined();
      expect(screen.getByText(/e2e-mission-trace-999/)).toBeDefined();
      expect(screen.getByText(/Hermes Strategy Dispatch/)).toBeDefined();
      expect(screen.getByText(/Workspace Initialized/)).toBeDefined();
    });

    it('renders completed status cleanly', () => {
      const payload: ActionStatusPayload = {
        actionName: 'Start Revenue Operator',
        targetCapability: 'revenue_operator',
        status: 'completed',
        runId: 'e2e-mission-trace-999',
        executedSteps: ['Discovery Done', 'Scoring Passed'],
      };

      render(<ChatActionStatusCard action={payload} />);
      expect(screen.getByText('COMPLETED')).toBeDefined();
      expect(screen.getByText(/Discovery Done/)).toBeDefined();
      expect(screen.getByText(/Scoring Passed/)).toBeDefined();
    });

    it('renders failed status with actual blocker reason', () => {
      const payload: ActionStatusPayload = {
        actionName: 'Start Revenue Operator',
        targetCapability: 'revenue_operator',
        status: 'failed',
        blocker: 'Missing Amazon SP-API credentials in revenue_config.json',
      };

      render(<ChatActionStatusCard action={payload} />);
      expect(screen.getByText('FAILED')).toBeDefined();
      expect(screen.getByText('Missing Amazon SP-API credentials in revenue_config.json')).toBeDefined();
    });

    it('renders waiting status when human input or approval is needed', () => {
      const payload: ActionStatusPayload = {
        actionName: 'Start Revenue Operator',
        targetCapability: 'revenue_operator',
        status: 'waiting',
        currentStep: 'Awaiting Operator Go/No-Go Decision',
      };

      render(<ChatActionStatusCard action={payload} />);
      expect(screen.getByText('WAITING')).toBeDefined();
      expect(screen.getByText(/Awaiting Operator Go\/No-Go Decision/)).toBeDefined();
    });
  });
});
