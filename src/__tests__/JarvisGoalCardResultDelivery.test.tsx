import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { JarvisGoalCard } from '../components/jarvis/JarvisGoalCard';

// Mock apiFetch and apiUrl
vi.mock('../api/client', () => ({
  apiFetch: vi.fn(),
  apiUrl: vi.fn((path) => path),
}));

import { apiFetch } from '../api/client';

class MockEventSource {
  static CLOSED = 2;
  readyState = 1;
  onopen: any = null;
  onerror: any = null;
  listeners: Record<string, Function[]> = {};
  url: string;

  constructor(url: string) {
    this.url = url;
  }

  addEventListener(type: string, cb: Function) {
    this.listeners[type] = this.listeners[type] || [];
    this.listeners[type].push(cb);
  }

  removeEventListener(type: string, cb: Function) {
    if (!this.listeners[type]) return;
    this.listeners[type] = this.listeners[type].filter(l => l !== cb);
  }

  close() {
    this.readyState = MockEventSource.CLOSED;
  }
}

describe('JarvisGoalCard — Worker Delegation & Result Delivery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as any).EventSource = MockEventSource;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders complete Markdown final answer when goal is completed with terminal event payload', async () => {
    const mockGoal = {
      id: 'goal-1234',
      originalGoal: 'Inspect B:\\AgenticOS\\package.json',
      status: 'completed',
      history: [
        {
          sequence: 1,
          state: 'task_started',
          eventType: 'task_started',
          message: 'Starting execution…',
          timestamp: new Date().toISOString()
        },
        {
          sequence: 2,
          state: 'agent_completed',
          eventType: 'agent_completed',
          tool: 'finish',
          message: 'Goal finished: ### INSPECTION RESULT\n\n- Root package name: `agenticos`\n- Ready for production.',
          payload: {
            finalAnswer: '### INSPECTION RESULT\n\n- Root package name: `agenticos`\n- Ready for production.'
          },
          timestamp: new Date().toISOString()
        }
      ]
    };

    (apiFetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => mockGoal
    });

    render(<JarvisGoalCard goalId="goal-1234" />);

    await waitFor(() => {
      expect(screen.getByTestId('jarvis-goal-final-result')).toBeDefined();
    });

    expect(screen.getByText('INSPECTION RESULT')).toBeDefined();
    expect(screen.getByText('Root package name:')).toBeDefined();
    expect(screen.getByText('Copy Result')).toBeDefined();
  });

  it('recovers finalAnswer from persisted goal.runSummary on reload/navigation', async () => {
    const mockGoal = {
      id: 'goal-persisted-5678',
      originalGoal: 'Compare packages',
      status: 'completed',
      runSummary: {
        finalAnswer: '### COMPARISON SUMMARY\n\nFrontend and backend dependencies match.',
        message: 'Goal finished: ### COMPARISON SUMMARY\n\nFrontend and backend dependencies match.'
      },
      history: []
    };

    (apiFetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => mockGoal
    });

    render(<JarvisGoalCard goalId="goal-persisted-5678" />);

    await waitFor(() => {
      expect(screen.getByTestId('jarvis-goal-final-result')).toBeDefined();
    });

    expect(screen.getByText('COMPARISON SUMMARY')).toBeDefined();
    expect(screen.getByText('Frontend and backend dependencies match.')).toBeDefined();
  });

  it('displays warning when completed but no final answer was returned', async () => {
    const mockGoal = {
      id: 'goal-empty-9999',
      originalGoal: 'Run mystery step',
      status: 'completed',
      history: []
    };

    (apiFetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => mockGoal
    });

    render(<JarvisGoalCard goalId="goal-empty-9999" />);

    await waitFor(() => {
      expect(screen.getByText('CodeX completed the execution but no final result was returned.')).toBeDefined();
    });
  });

  it('displays clear failure state and does NOT show result container on failed goal', async () => {
    const mockGoal = {
      id: 'goal-failed-1111',
      originalGoal: 'Invalid command',
      status: 'failed',
      error: 'Process crashed with code 1',
      history: []
    };

    (apiFetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => mockGoal
    });

    render(<JarvisGoalCard goalId="goal-failed-1111" />);

    await waitFor(() => {
      expect(screen.getByText('Execution Failed')).toBeDefined();
    });

    expect(screen.queryByTestId('jarvis-goal-final-result')).toBeNull();
  });

  it('displays stopped state and does NOT show result container when stopped by user', async () => {
    const mockGoal = {
      id: 'goal-stopped-2222',
      originalGoal: 'Long running task',
      status: 'stopped',
      history: []
    };

    (apiFetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => mockGoal
    });

    render(<JarvisGoalCard goalId="goal-stopped-2222" />);

    await waitFor(() => {
      expect(screen.getByText('Execution stopped by user.')).toBeDefined();
    });

    expect(screen.queryByTestId('jarvis-goal-final-result')).toBeNull();
  });
});
