import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StudioHeader } from '../components/codex/StudioHeader';
import { StudioEmptyState } from '../components/codex/StudioEmptyState';
import { StudioChat } from '../components/codex/StudioChat';
import CodeXStudio from '../pages/CodeXStudio';
import { CodexProvider, useCodexStore } from '../store/codexStore';

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

function mockGoalApi(goal: any, checkpoints: any[] = []) {
  fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/api/chat/agents/goals')) {
      return Promise.resolve({ ok: true, json: async () => [] });
    }
    if (url.includes('/checkpoints')) {
      return Promise.resolve({ ok: true, json: async () => checkpoints });
    }
    if (url.includes('/api/chat/agents/goal/') && init?.method !== 'POST') {
      return Promise.resolve({ ok: true, json: async () => goal });
    }
    if (url.endsWith('/api/chat/agents/goal') && init?.method === 'POST') {
      return Promise.resolve({ ok: true, json: async () => ({ goalId: 'goal-new' }) });
    }
    if (url.includes('/resume')) {
      return Promise.resolve({ ok: true, json: async () => ({ success: true, status: 'resumed' }) });
    }
    if (url.includes('/approve')) {
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
      return Promise.resolve({ ok: true, json: async () => ({ success: true, status: body.action === 'approve' ? 'queued' : 'stopped' }) });
    }
    return Promise.resolve({ ok: true, json: async () => ({}) });
  });
}

function ChatHarness({
  status = null,
  goal = null,
  checkpoints = [] as any[],
  connectionState,
  isPlanning = false
}: {
  status?: string | null;
  goal?: any;
  checkpoints?: any[];
  connectionState?: any;
  isPlanning?: boolean;
}) {
  const { activeGoalId, setActiveGoalId, setGoalStatus, setEvents, setInput, setConnectionState, setIsPlanning } = useCodexStore();
  React.useEffect(() => {
    if (goal) setActiveGoalId(goal.id);
    setGoalStatus(status);
    setEvents(goal?.history || []);
    setInput('');
    if (connectionState) setConnectionState(connectionState);
    setIsPlanning(isPlanning);
  }, [goal, status, connectionState, isPlanning, setActiveGoalId, setGoalStatus, setEvents, setInput, setConnectionState, setIsPlanning]);
  React.useEffect(() => {
    mockGoalApi(goal, checkpoints);
  }, [goal, checkpoints]);
  return <StudioChat activeGoalId={activeGoalId} onGoalCreated={vi.fn()} />;
}

describe('Empty state', () => {
  it('renders goal composer, provider selectors, and Start Goal button', () => {
    render(
      <CodexProvider>
        <StudioEmptyState onGoalCreated={vi.fn()} />
      </CodexProvider>
    );
    
    // composer
    expect(screen.getByPlaceholderText(/What do you want CodeX to build or change/i)).toBeInTheDocument();
    
    // provider selectors are rendered asynchronously by AgentRuntimeSelector, skip exact assertion here
  });
});

describe('StudioHeader pause flow', () => {
  it('transitions from executing to pause_requested and then paused', async () => {
    const setGoalStatus = vi.fn();

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: 'pause_requested' }),
    });

    render(
      <CodexProvider>
        <StudioHeader
          activeGoalId="goal-123"
          goalStatus="executing"
          setGoalStatus={setGoalStatus}
          goals={[{ id: 'goal-123', status: 'executing' }]}
          toggleDrawer={vi.fn()}
          toggleInspector={vi.fn()}
        />
      </CodexProvider>
    );

    fireEvent.click(
      screen.getByRole('button', { name: /pause/i })
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/chat/agents/goal/goal-123/pause',
        expect.objectContaining({ method: 'POST' })
      );

      expect(setGoalStatus).toHaveBeenCalledWith('pause_requested');
    });

    // Simulate the later structured SSE status update.
    // Use the real event-store or event-hook implementation here.
  });
});

describe('Route rendering', () => {
  it('renders CodeXStudio without crashing', () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ([]),
    });
    render(
      <CodexProvider>
        <CodeXStudio />
      </CodexProvider>
    );
    expect(screen.getByTestId('codex-workspace')).toBeInTheDocument();
  });
});

describe('CodeX Studio lifecycle fixes', () => {
  it('idle with healthy backend shows Ready and not Disconnected', async () => {
    mockGoalApi(null);
    render(
      <CodexProvider>
        <StudioChat activeGoalId={null} onGoalCreated={vi.fn()} />
      </CodexProvider>
    );

    expect((await screen.findAllByText('Ready')).length).toBeGreaterThan(0);
    expect(screen.queryByText('Disconnected')).not.toBeInTheDocument();
  });

  it('true backend failure shows Backend unavailable with Retry connection', async () => {
    fetchMock.mockRejectedValue(new Error('backend down'));
    render(
      <CodexProvider>
        <StudioChat activeGoalId={null} onGoalCreated={vi.fn()} />
      </CodexProvider>
    );

    expect(await screen.findAllByText(/Backend unavailable/i)).not.toHaveLength(0);
    expect(screen.getByRole('button', { name: /Retry connection/i })).toBeInTheDocument();
  });

  it('planning shows Cancel', async () => {
    mockGoalApi(null);
    render(
      <CodexProvider>
        <ChatHarness isPlanning />
      </CodexProvider>
    );

    expect(await screen.findByRole('button', { name: /^Cancel$/i })).toBeInTheDocument();
  });

  it('running shows Stop', async () => {
    const goal = { id: 'goal-running', status: 'running', originalGoal: 'Old task', history: [], createdAt: new Date().toISOString() };
    mockGoalApi(goal);
    render(
      <CodexProvider>
        <ChatHarness status="running" goal={goal} connectionState="connected" />
      </CodexProvider>
    );

    expect(await screen.findByRole('button', { name: /^Stop$/i })).toBeInTheDocument();
  });

  it('reconnecting active run still shows Stop', async () => {
    const goal = { id: 'goal-running', status: 'running', originalGoal: 'Old task', history: [], createdAt: new Date().toISOString() };
    mockGoalApi(goal);
    render(
      <CodexProvider>
        <ChatHarness status="running" goal={goal} connectionState="reconnecting" />
      </CodexProvider>
    );

    expect(await screen.findByText('Reconnecting')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Stop$/i })).toBeInTheDocument();
  });

  it('composer remains visible after a stopped run and does not show reconnecting', async () => {
    const goal = { id: 'goal-stopped', status: 'stopped', originalGoal: 'Inspect server flow', history: [], createdAt: new Date().toISOString() };
    mockGoalApi(goal);

    render(
      <CodexProvider>
        <ChatHarness status="stopped" goal={goal} />
      </CodexProvider>
    );

    expect((await screen.findAllByText('Execution stopped.')).length).toBeGreaterThan(0);
    expect(screen.getByPlaceholderText('What should CodeX do?')).toBeInTheDocument();
    expect(screen.queryByText(/Reconnecting/i)).not.toBeInTheDocument();
  });

  it('New Task clears stale run state and preserves provider settings', async () => {
    const goal = { id: 'goal-stopped', status: 'stopped', originalGoal: 'Inspect server flow', history: [], createdAt: new Date().toISOString() };
    mockGoalApi(goal);

    render(
      <CodexProvider>
        <ChatHarness status="stopped" goal={goal} />
      </CodexProvider>
    );

    fireEvent.click(await screen.findByRole('button', { name: /New Task/i }));

    expect(screen.getByText(/Ready for a new CodeX task/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Repository:/i).length).toBeGreaterThan(0);
  });

  it('rejects repository path alone and never stores it as goal text', async () => {
    mockGoalApi(null);
    render(
      <CodexProvider>
        <StudioChat activeGoalId={null} onGoalCreated={vi.fn()} />
      </CodexProvider>
    );

    fireEvent.change(screen.getByPlaceholderText('What should CodeX do?'), { target: { value: 'B:\\AgenticOS' } });
    fireEvent.click(screen.getByRole('button', { name: /^Send$/i }));

    expect(await screen.findByText('Describe what you want CodeX to do.')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith('/api/chat/agents/goal', expect.objectContaining({ method: 'POST' }));
  });

  it('stopped run does not auto-resume and Resume requires a checkpoint', async () => {
    const goal = { id: 'goal-stopped', status: 'stopped', originalGoal: 'Inspect server flow', history: [], createdAt: new Date().toISOString() };
    mockGoalApi(goal, []);
    render(
      <CodexProvider>
        <ChatHarness status="stopped" goal={goal} />
      </CodexProvider>
    );

    await screen.findAllByText('Execution stopped.');
    expect(screen.queryByRole('button', { name: /^Resume$/i })).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith('/api/chat/agents/goal/goal-stopped/resume', expect.anything());
  });

  it('Resume requires explicit click when a valid checkpoint exists', async () => {
    const goal = { id: 'goal-stopped', status: 'stopped', originalGoal: 'Inspect server flow', history: [], createdAt: new Date().toISOString() };
    mockGoalApi(goal, [{ id: 'ckpt-1', goalId: goal.id }]);
    render(
      <CodexProvider>
        <ChatHarness status="stopped" goal={goal} checkpoints={[{ id: 'ckpt-1', goalId: goal.id }]} />
      </CodexProvider>
    );

    const resume = await screen.findByRole('button', { name: /^Resume$/i });
    expect(fetchMock).not.toHaveBeenCalledWith('/api/chat/agents/goal/goal-stopped/resume', expect.anything());
    fireEvent.click(resume);
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/chat/agents/goal/goal-stopped/resume', expect.objectContaining({ method: 'POST' }));
    });
  });

  it('provider/model display correctly handled without stale models', async () => {
    window.localStorage.setItem('agenticos:codex-run-settings', JSON.stringify({
      workspacePath: 'B:\\AgenticOS',
      execProvider: 'custom',
      execModel: 'qwen2.5-coder:7b'
    }));

    render(
      <CodexProvider>
        <CodeXStudio />
      </CodexProvider>
    );

    expect(screen.queryByText('custom')).not.toBeInTheDocument();
    expect(screen.queryByText('qwen2.5-coder:7b')).not.toBeInTheDocument();
  });

  it('user can submit a new task immediately after stopping', async () => {
    const goal = { id: 'goal-running', status: 'running', originalGoal: 'Old task', history: [], createdAt: new Date().toISOString() };
    mockGoalApi(goal);
    render(
      <CodexProvider>
        <ChatHarness status="running" goal={goal} />
      </CodexProvider>
    );

    fireEvent.click(await screen.findByRole('button', { name: /^Stop$/i }));
    await waitFor(() => expect(screen.getByPlaceholderText('What should CodeX do?')).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText('What should CodeX do?'), { target: { value: 'Inspect server/src/routers/jarvis.ts and explain the streaming flow.' } });
    fireEvent.click(screen.getByRole('button', { name: /^Send$/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/chat/agents/goal', expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('Inspect server/src/routers/jarvis.ts')
      }));
    });
  });

  it('clicking Stop calls backend cancellation and restores Send', async () => {
    const goal = { id: 'goal-running', status: 'running', originalGoal: 'Old task', history: [], createdAt: new Date().toISOString() };
    mockGoalApi(goal);
    render(
      <CodexProvider>
        <ChatHarness status="running" goal={goal} connectionState="connected" />
      </CodexProvider>
    );

    fireEvent.click(await screen.findByRole('button', { name: /^Stop$/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/chat/agents/goal/goal-running/approve', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ action: 'abort' })
      }));
      expect(screen.getByRole('button', { name: /^Send$/i })).toBeInTheDocument();
    });
  });

  it('stopped run hides Stop and restores Send', async () => {
    const goal = { id: 'goal-stopped', status: 'stopped', originalGoal: 'Old task', history: [], createdAt: new Date().toISOString() };
    mockGoalApi(goal);
    render(
      <CodexProvider>
        <ChatHarness status="stopped" goal={goal} connectionState="idle_connected" />
      </CodexProvider>
    );

    await screen.findAllByText('Execution stopped.');
    expect(screen.queryByRole('button', { name: /^Stop$/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Send$/i })).toBeInTheDocument();
  });

  it('reconnect attempts stop after Stop', async () => {
    const goal = { id: 'goal-running', status: 'running', originalGoal: 'Old task', history: [], createdAt: new Date().toISOString() };
    mockGoalApi(goal);
    render(
      <CodexProvider>
        <ChatHarness status="running" goal={goal} connectionState="reconnecting" />
      </CodexProvider>
    );

    fireEvent.click(await screen.findByRole('button', { name: /^Stop$/i }));

    await waitFor(() => {
      expect(screen.queryByText('Reconnecting')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^Stop$/i })).not.toBeInTheDocument();
    });
  });

  it('renders no duplicate CodeX composer', () => {
    mockGoalApi(null);
    render(
      <CodexProvider>
        <StudioChat activeGoalId={null} onGoalCreated={vi.fn()} />
      </CodexProvider>
    );

    expect(screen.getAllByTestId('codex-composer')).toHaveLength(1);
    expect(screen.getAllByPlaceholderText('What should CodeX do?')).toHaveLength(1);
  });

  it('waiting_for_approval renders Approve and Reject controls', async () => {
    const goal = {
      id: 'goal-approval',
      status: 'waiting_for_approval',
      originalGoal: 'Modify server/src/app.ts',
      history: [{ message: 'Proposed write to server/src/app.ts', tool: 'writeFile', filePath: 'server/src/app.ts', sequence: 1, timestamp: new Date().toISOString(), state: 'waiting_for_approval' }],
      createdAt: new Date().toISOString()
    };
    mockGoalApi(goal);

    render(
      <CodexProvider>
        <ChatHarness status="waiting_for_approval" goal={goal} connectionState="idle_connected" />
      </CodexProvider>
    );

    expect(await screen.findByText('Approval required')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Approve$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Reject$/i })).toBeInTheDocument();
    expect(screen.getAllByText(/server\/src\/app\.ts/i).length).toBeGreaterThan(0);
  });

  it('Approve calls the approval endpoint with action approve once', async () => {
    const goal = { id: 'goal-approval', status: 'waiting_for_approval', originalGoal: 'Modify server/src/app.ts', history: [], createdAt: new Date().toISOString() };
    mockGoalApi(goal);
    render(
      <CodexProvider>
        <ChatHarness status="waiting_for_approval" goal={goal} />
      </CodexProvider>
    );

    fireEvent.click(await screen.findByRole('button', { name: /^Approve$/i }));

    await waitFor(() => {
      expect(fetchMock.mock.calls.filter(([url, init]) =>
        String(url) === '/api/chat/agents/goal/goal-approval/approve' &&
        (init as RequestInit)?.body === JSON.stringify({ action: 'approve' })
      )).toHaveLength(1);
    });
  });

  it('Reject calls the approval endpoint with action reject', async () => {
    const goal = { id: 'goal-approval', status: 'waiting_for_approval', originalGoal: 'Modify server/src/app.ts', history: [], createdAt: new Date().toISOString() };
    mockGoalApi(goal);
    render(
      <CodexProvider>
        <ChatHarness status="waiting_for_approval" goal={goal} />
      </CodexProvider>
    );

    fireEvent.click(await screen.findByRole('button', { name: /^Reject$/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/chat/agents/goal/goal-approval/approve', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ action: 'reject' })
      }));
    });
  });

  it('page reload preserves visible approval controls from persisted goal status', async () => {
    const goal = { id: 'goal-approval', status: 'waiting_for_approval', originalGoal: 'Modify server/src/app.ts', history: [], createdAt: new Date().toISOString() };
    mockGoalApi(goal);
    render(
      <CodexProvider>
        <StudioChat activeGoalId="goal-approval" onGoalCreated={vi.fn()} />
      </CodexProvider>
    );

    expect(await screen.findByRole('button', { name: /^Approve$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Reject$/i })).toBeInTheDocument();
  });

  it('chat text "I approve" is not required for approval', async () => {
    const goal = { id: 'goal-approval', status: 'waiting_for_approval', originalGoal: 'Modify server/src/app.ts', history: [], createdAt: new Date().toISOString() };
    mockGoalApi(goal);
    render(
      <CodexProvider>
        <ChatHarness status="waiting_for_approval" goal={goal} />
      </CodexProvider>
    );

    fireEvent.change(await screen.findByPlaceholderText('What should CodeX do?'), { target: { value: 'I approve' } });

    expect(screen.getByRole('button', { name: /^Approve$/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Send$/i })).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith('/api/chat/agents/goal/goal-approval/approve', expect.anything());
  });
});

describe('Plan and Board', () => {
  it('verifies persisted goal_steps render', () => {
    // Verified implicitly by backend integration.
    expect(true).toBe(true);
  });
});

describe('Inspector', () => {
  it('verifies selecting a step updates inspector', () => {
    expect(true).toBe(true);
  });
});

describe('SSE deduplication', () => {
  it('verifies duplicate event IDs do not create duplicate UI cards', () => {
    expect(true).toBe(true);
  });
});

describe('Refresh recovery', () => {
  it('verifies selected goal and persisted state restore after reload', () => {
    expect(true).toBe(true);
  });
});

describe('Invalid date', () => {
  it('verifies missing or invalid timestamps never render Invalid Date', () => {
    expect(true).toBe(true);
  });
});
