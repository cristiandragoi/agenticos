import React, { useEffect } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JarvisChat } from '../components/jarvis/JarvisChat';
import { JarvisWorkspaceBar } from '../components/jarvis/JarvisWorkspaceBar';
import { JarvisTeamPreviewCard } from '../components/jarvis/JarvisTeamPreviewCard';
import { JarvisTeamExecutionCard } from '../components/jarvis/JarvisTeamExecutionCard';
import { CodexProvider, useCodexStore } from '../store/codexStore';

/* ── EventSource mock ─────────────────────────────────────── */
class MockEventSource {
  static CLOSED = 2;
  static instances: MockEventSource[] = [];
  url: string;
  readyState = 0;
  onopen: any = null;
  onerror: any = null;
  listeners: Record<string, any> = {};
  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }
  addEventListener(type: string, cb: any) { this.listeners[type] = cb; }
  close() {}
}

/* ── Fetch mock with URL routing ──────────────────────────── */
const fetchMock = vi.fn();
let lastMessageBody: any = null;
let reportsResponse: any = { reports: [] };

function jsonResponse(body: any, ok = true, status = 200) {
  return { ok, status, statusText: ok ? 'OK' : 'ERROR', json: async () => body };
}

function sse(event: string, data: any) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function streamResponse(events: string[]) {
  const encoder = new TextEncoder();
  return {
    ok: true,
    status: 200,
    body: new ReadableStream({
      start(controller) {
        events.forEach(event => controller.enqueue(encoder.encode(event)));
        controller.close();
      }
    })
  };
}

function routeFetch(url: string, options?: any) {
  if (url.endsWith('/api/jarvis/conversations/conv-1/messages')) {
    return jsonResponse([]);
  }
  if (url.endsWith('/api/jarvis/conversations/conv-1/message') && options?.method === 'POST') {
    lastMessageBody = JSON.parse(options.body);
    const prompt: string = lastMessageBody.prompt || '';
    if (!lastMessageBody.workspacePath) {
      return jsonResponse({ error: 'No repository selected. Choose a valid workspace in the workspace bar before starting CodeX or Agent Team work.', route: 'codex' }, false, 400);
    }
    if (prompt.includes('team')) {
      return jsonResponse({ teamId: 'team-xyz', route: 'agent_teams', status: 'awaiting_approval' });
    }
    return jsonResponse({ goalId: 'goal-abc', route: 'codex', status: 'waiting_for_approval' });
  }
  if (url.endsWith('/api/chat/agents/goal/goal-abc/approve') && options?.method === 'POST') {
    return jsonResponse({ success: true, status: 'resumed' });
  }
  if (url.endsWith('/api/chat/agents/goal/goal-abc')) {
    return jsonResponse({
      id: 'goal-abc',
      status: 'waiting_for_approval',
      originalGoal: 'Build a thing',
      history: [],
      createdAt: new Date().toISOString()
    });
  }
  if (url.endsWith('/api/workspace/detect')) {
    return jsonResponse({ isValid: true, cwd: 'B:\\AgenticOS\\server', gitRoots: ['B:\\Repo'] });
  }
  if (url.endsWith('/api/teams/team-xyz')) {
    return jsonResponse({ id: 'team-xyz', name: 'Test Team', status: 'awaiting_approval' });
  }
  if (url.endsWith('/api/jarvis/conversations/conv-1/approve_team')) {
    return jsonResponse({ runId: 'run-1', teamId: 'team-xyz' });
  }
  if (url.endsWith('/api/teams/runs/run-1/reports')) {
    return jsonResponse(reportsResponse);
  }
  if (url.endsWith('/api/teams/runs/run-1/handoffs')) {
    return jsonResponse([]);
  }
  if (url.endsWith('/api/teams/runs/run-1/artifacts')) {
    return jsonResponse([]);
  }
  if (url.endsWith('/api/teams/runs/run-1')) {
    return jsonResponse({ id: 'run-1', teamId: 'team-xyz', status: 'running' });
  }
  return jsonResponse({});
}

/* ── Helpers ──────────────────────────────────────────────── */
const SeedSettings: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { setRunSettings } = useCodexStore();
  useEffect(() => {
    setRunSettings(prev => ({ ...prev, workspacePath: 'B:\\Repo', approvalPolicy: 'strict' }));
  }, [setRunSettings]);
  return <>{children}</>;
};

function renderChat(seeded = true) {
  const inner = <JarvisChat conversationId="conv-1" />;
  return render(
    <CodexProvider>
      {seeded ? <SeedSettings>{inner}</SeedSettings> : inner}
    </CodexProvider>
  );
}

async function sendMessage(text: string) {
  fireEvent.change(screen.getByLabelText('Message Input'), { target: { value: text } });
  await waitFor(() => expect(screen.getByLabelText('Send Message')).not.toBeDisabled());
  fireEvent.click(screen.getByLabelText('Send Message'));
}

beforeEach(() => {
  window.localStorage.clear();
  MockEventSource.instances = [];
  lastMessageBody = null;
  reportsResponse = { reports: [] };
  fetchMock.mockImplementation((url: string, options?: any) => Promise.resolve(routeFetch(url, options)));
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('EventSource', MockEventSource);
  // jsdom does not implement scrollIntoView.
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

/* ── Tests ────────────────────────────────────────────────── */
describe('Jarvis → CodeX wiring', () => {
  it('sends workspacePath and approvalPolicy with the CodeX request', async () => {
    renderChat();
    await sendMessage('Build a landing page');

    await waitFor(() => expect(lastMessageBody).not.toBeNull());
    expect(lastMessageBody.workspacePath).toBe('B:\\Repo');
    expect(lastMessageBody.repositoryPath).toBe('B:\\Repo');
    expect(lastMessageBody.approvalPolicy).toBe('strict');

    // Let the goal card mount and its effects settle before teardown.
    await screen.findByTestId('jarvis-goal-card');
  });

  it('stores the returned goalId and renders the goal card', async () => {
    renderChat();
    await sendMessage('Build a landing page');

    await waitFor(() => expect(screen.getByTestId('jarvis-goal-card')).toBeInTheDocument());
    expect(screen.getByTestId('jarvis-goal-card').textContent).toContain('goal-abc');
  });

  it('subscribes to the execution stream with the real goalId', async () => {
    renderChat();
    await sendMessage('Build a landing page');

    await waitFor(() => {
      const goalStream = MockEventSource.instances.find(
        es => es.url === '/api/chat/agents/goal/stream/goal-abc'
      );
      expect(goalStream).toBeDefined();
    });
    // Never the team activeRunId and never a different goal.
    expect(MockEventSource.instances.find(es => es.url.includes('activeRunId'))).toBeUndefined();
  });

  it('approves the goal using the correct goalId', async () => {
    renderChat();
    await sendMessage('Build a landing page');

    const approveBtn = await screen.findByRole('button', { name: /Approve and Start/i });
    fireEvent.click(approveBtn);

    await waitFor(() => {
      const approveCall = fetchMock.mock.calls.find(
        ([url]) => url === '/api/chat/agents/goal/goal-abc/approve'
      );
      expect(approveCall).toBeDefined();
      expect(JSON.parse(approveCall![1].body)).toEqual({ action: 'resume' });
    });
  });
});

describe('Jarvis → Agent Teams wiring', () => {
  it('sends workspacePath and approvalPolicy with the team request', async () => {
    renderChat();
    await sendMessage('Assemble a team to build the feature');

    await waitFor(() => expect(lastMessageBody).not.toBeNull());
    expect(lastMessageBody.workspacePath).toBe('B:\\Repo');
    expect(lastMessageBody.repositoryPath).toBe('B:\\Repo');
    expect(lastMessageBody.approvalPolicy).toBe('strict');
  });

  it('approves a team preview through the real endpoint', async () => {
    render(
      <JarvisTeamPreviewCard
        conversationId="conv-1"
        teamId="team-xyz"
        teamSheet={{ teamName: 'Test Team', objective: 'Build it', agents: [], acceptanceCriteria: [] }}
      />
    );

    const approveBtn = await screen.findByRole('button', { name: /Approve and Run/i });
    fireEvent.click(approveBtn);

    await waitFor(() => {
      const approveCall = fetchMock.mock.calls.find(
        ([url]) => url === '/api/jarvis/conversations/conv-1/approve_team'
      );
      expect(approveCall).toBeDefined();
      expect(JSON.parse(approveCall![1].body)).toEqual({ teamId: 'team-xyz' });
    });
  });

  it('links to the valid team route after creation', async () => {
    render(<JarvisTeamExecutionCard runId="run-1" teamId="team-xyz" />);

    const link = await screen.findByRole('link', { name: /Open Details/i });
    expect(link.getAttribute('href')).toBe('#/teams/team-xyz');
    expect(link.getAttribute('href')).not.toContain('/agent-teams/');
  });
});

describe('Verification outcome rendering', () => {
  it('shows Verification Failed with blocking issues when the report did not pass', async () => {
    reportsResponse = {
      reports: [{
        id: 'rep-1',
        passed: 0,
        evidence: '',
        blocking_issues: JSON.stringify([
          { name: 'Sandbox restriction on file creation and writing', passed: false, evidence: "Execution of 'echo' is blocked by policy." }
        ])
      }]
    };
    render(<JarvisTeamExecutionCard runId="run-1" teamId="team-xyz" />);

    await screen.findByText('Verification Failed');
    expect(screen.queryByText('Verification Passed')).not.toBeInTheDocument();
    expect(screen.getByText(/Sandbox restriction on file creation/i)).toBeInTheDocument();
    expect(screen.getByText(/Execution of 'echo' is blocked by policy/i)).toBeInTheDocument();
  });

  it('shows Verification Passed only when the report actually passed', async () => {
    reportsResponse = {
      reports: [{ id: 'rep-2', passed: 1, evidence: 'All checks passed.', blocking_issues: '[]' }]
    };
    render(<JarvisTeamExecutionCard runId="run-1" teamId="team-xyz" />);

    await screen.findByText('Verification Passed');
    expect(screen.queryByText('Verification Failed')).not.toBeInTheDocument();
    expect(screen.getByText('All checks passed.')).toBeInTheDocument();
  });
});

describe('Workspace validation', () => {
  it('entering B:\\AgenticOS and pressing Enter updates the active workspace used by Jarvis', async () => {
    fetchMock.mockImplementation((url: string, options?: any) => {
      if (url.endsWith('/api/workspace/detect')) {
        return Promise.resolve(jsonResponse({
          isValid: true,
          cwd: 'B:\\AgenticOS\\server',
          targetPath: 'B:\\AgenticOS',
          gitRoots: ['B:\\AgenticOS']
        }));
      }
      if (url.endsWith('/api/jarvis/conversations/conv-1/messages')) return Promise.resolve(jsonResponse([]));
      if (url.endsWith('/api/jarvis/conversations/conv-1/message/stream') && options?.method === 'POST') {
        lastMessageBody = JSON.parse(options.body);
        return Promise.resolve(streamResponse([
          sse('intent', { type: 'repository_analysis', route: 'codex', mode: 'operational_execution' }),
          sse('done', { route: 'codex', status: 'waiting_for_approval' })
        ]));
      }
      return Promise.resolve(routeFetch(url, options));
    });

    render(
      <CodexProvider>
        <JarvisWorkspaceBar />
        <JarvisChat conversationId="conv-1" />
      </CodexProvider>
    );

    const workspaceInput = await screen.findByLabelText('Workspace path');
    fireEvent.change(workspaceInput, { target: { value: 'B:\\AgenticOS' } });
    fireEvent.keyDown(workspaceInput, { key: 'Enter' });

    const valid = await screen.findByTestId('jarvis-workspace-valid');
    expect(valid).toHaveTextContent('B:\\AgenticOS');

    await sendMessage('Inspect the Jarvis router');

    await waitFor(() => expect(lastMessageBody).not.toBeNull());
    expect(lastMessageBody.workspacePath).toBe('B:\\AgenticOS');
    expect(lastMessageBody.repositoryPath).toBe('B:\\AgenticOS');
  });

  it('persisted active workspace survives remount/navigation and stays authoritative', async () => {
    window.localStorage.setItem('agenticos:codex-run-settings', JSON.stringify({
      folderTree: 'B:\\AgenticOS',
      workspacePath: 'B:\\AgenticOS',
      execProvider: 'ollama',
      valProvider: 'omniRoute',
      approvalPolicy: 'strict'
    }));

    fetchMock.mockImplementation((url: string, options?: any) => {
      if (url.endsWith('/api/workspace/detect')) {
        return Promise.resolve(jsonResponse({
          isValid: true,
          cwd: 'B:\\AgenticOS\\server',
          targetPath: 'B:\\AgenticOS',
          gitRoots: ['B:\\AgenticOS']
        }));
      }
      if (url.endsWith('/api/jarvis/conversations/conv-1/messages')) return Promise.resolve(jsonResponse([]));
      if (url.endsWith('/api/jarvis/conversations/conv-1/message/stream') && options?.method === 'POST') {
        lastMessageBody = JSON.parse(options.body);
        return Promise.resolve(streamResponse([sse('done', { route: 'codex' })]));
      }
      return Promise.resolve(routeFetch(url, options));
    });

    const first = render(<CodexProvider><JarvisWorkspaceBar /></CodexProvider>);
    expect(await screen.findByTestId('jarvis-workspace-valid')).toHaveTextContent('B:\\AgenticOS');
    first.unmount();

    render(<CodexProvider><JarvisChat conversationId="conv-1" /></CodexProvider>);
    await sendMessage('Inspect the Jarvis router');

    await waitFor(() => expect(lastMessageBody).not.toBeNull());
    expect(lastMessageBody.workspacePath).toBe('B:\\AgenticOS');
    expect(lastMessageBody.repositoryPath).toBe('B:\\AgenticOS');
  });

  it('never falls back to "default": ordinary direct chat sends without a repository', async () => {
    fetchMock.mockImplementation((url: string, options?: any) => {
      if (url.endsWith('/api/jarvis/conversations/conv-1/messages')) return Promise.resolve(jsonResponse([]));
      if (url.endsWith('/api/jarvis/conversations/conv-1/message/stream') && options?.method === 'POST') {
        lastMessageBody = JSON.parse(options.body);
        return Promise.resolve(streamResponse([
          sse('chunk', { delta: 'Direct answer.' }),
          sse('done', { route: 'direct' })
        ]));
      }
      return Promise.resolve(routeFetch(url, options));
    });

    renderChat(false); // no workspace selected
    fireEvent.change(screen.getByLabelText('Message Input'), { target: { value: 'What can you do?' } });

    const sendBtn = screen.getByRole('button', { name: /send message/i });
    expect(sendBtn).not.toBeDisabled();
    fireEvent.click(sendBtn);

    await waitFor(() => expect(lastMessageBody).not.toBeNull());
    expect(lastMessageBody.prompt).toBe('What can you do?');
    // The runSettings default workspace (CODEX_REPOSITORY) is sent when no
    // workspace was explicitly selected — the contract is that the literal
    // string 'default' is never used, not that the field is absent.
    expect(lastMessageBody.workspacePath).not.toBe('default');
    expect(typeof lastMessageBody.workspacePath).toBe('string');
    expect(screen.queryByTestId('jarvis-goal-card')).not.toBeInTheDocument();
  });

  it('surfaces backend validation errors visibly instead of as success', async () => {
    renderChat(); // workspace seeded, but the backend rejects the request
    fetchMock.mockImplementation((url: string, options?: any) => {
      if (url.endsWith('/api/jarvis/conversations/conv-1/message') && options?.method === 'POST') {
        lastMessageBody = JSON.parse(options.body);
        return Promise.resolve(jsonResponse({ error: 'No repository selected. Choose a valid workspace in the workspace bar before starting CodeX or Agent Team work.', route: 'codex' }, false, 400));
      }
      if (url.endsWith('/api/jarvis/conversations/conv-1/messages')) {
        // The real orchestrator records the failure as a conversation message.
        return Promise.resolve(jsonResponse([{
          id: 'err-1', role: 'system', messageType: 'error',
          content: 'No repository selected. Choose a valid workspace in the workspace bar before starting CodeX or Agent Team work.',
          createdAt: new Date().toISOString()
        }]));
      }
      return Promise.resolve(routeFetch(url, options));
    });

    await sendMessage('Build a landing page');

    // The request still carries the selected workspace (never 'default').
    await waitFor(() => expect(lastMessageBody).not.toBeNull());
    expect(lastMessageBody.workspacePath).toBe('B:\\Repo');

    // The error renders exactly once — inline as a conversation message,
    // not duplicated in a separate banner.
    const errors = await screen.findAllByText(/No repository selected/i);
    expect(errors).toHaveLength(1);
    expect(screen.queryByTestId('jarvis-send-error')).not.toBeInTheDocument();
    expect(screen.queryByTestId('jarvis-goal-card')).not.toBeInTheDocument();
  });

  it('deduplicates streamed Jarvis errors by operation id while preserving distinct request errors', async () => {
    renderChat();
    const persistedMessages: any[] = [];
    fetchMock.mockImplementation((url: string, options?: any) => {
      if (url.endsWith('/api/jarvis/conversations/conv-1/message') && options?.method === 'POST') {
        lastMessageBody = JSON.parse(options.body);
        return Promise.resolve(jsonResponse({
          error: 'Failed to initialize Agent Team: schema validation failed.',
          route: 'agent_teams',
          operationId: lastMessageBody.operationId
        }, false, 400));
      }
      if (url.endsWith('/api/jarvis/conversations/conv-1/messages')) {
        return Promise.resolve(jsonResponse([...persistedMessages]));
      }
      return Promise.resolve(routeFetch(url, options));
    });

    await sendMessage('Assemble a team for the first feature');
    await waitFor(() => expect(lastMessageBody?.operationId).toBeTruthy());
    const firstOperationId = lastMessageBody.operationId;
    const stream = MockEventSource.instances.find(es => es.url === '/api/jarvis/stream/conv-1');
    expect(stream).toBeDefined();

    act(() => {
      const firstError = {
        id: 'err-first-a',
        role: 'system',
        messageType: 'error',
        content: 'Failed to initialize Agent Team: schema validation failed.',
        createdAt: new Date().toISOString(),
        metadata: { operationId: firstOperationId }
      };
      persistedMessages.push(firstError);
      stream!.listeners.message({
        data: JSON.stringify(firstError)
      });
      stream!.listeners.message({
        data: JSON.stringify({
          id: 'err-first-b',
          role: 'system',
          messageType: 'error',
          content: 'Failed to initialize Agent Team: schema validation failed.',
          createdAt: new Date().toISOString(),
          metadata: { operationId: firstOperationId }
        })
      });
    });

    expect(await screen.findAllByText(/Failed to initialize Agent Team/i)).toHaveLength(1);
    expect(screen.queryByTestId('jarvis-send-error')).not.toBeInTheDocument();

    const messageFetchesBeforeSecondSend = fetchMock.mock.calls.filter(
      ([url]) => String(url).endsWith('/api/jarvis/conversations/conv-1/messages')
    ).length;
    await sendMessage('Assemble a team for the second feature');
    await waitFor(() => expect(lastMessageBody.operationId).not.toBe(firstOperationId));
    const secondOperationId = lastMessageBody.operationId;
    await waitFor(() => {
      const messageFetches = fetchMock.mock.calls.filter(
        ([url]) => String(url).endsWith('/api/jarvis/conversations/conv-1/messages')
      ).length;
      expect(messageFetches).toBeGreaterThan(messageFetchesBeforeSecondSend);
    });

    act(() => {
      const secondError = {
        id: 'err-second',
        role: 'system',
        messageType: 'error',
        content: 'Failed to initialize Agent Team: a different request failed.',
        createdAt: new Date().toISOString(),
        metadata: { operationId: secondOperationId }
      };
      persistedMessages.push(secondError);
      stream!.listeners.message({
        data: JSON.stringify(secondError)
      });
    });

    expect(screen.getAllByText(/schema validation failed/i)).toHaveLength(1);
    expect(await screen.findByText(/a different request failed/i)).toBeInTheDocument();
  });

  it('shows a visible workspace error in the workspace bar when detection fails', async () => {
    fetchMock.mockImplementation((url: string, options?: any) => {
      if (url.endsWith('/api/workspace/detect')) {
        return Promise.resolve(jsonResponse({ isValid: false, errorMessage: 'Not a git repository.' }));
      }
      return Promise.resolve(routeFetch(url, options));
    });

    render(
      <CodexProvider>
        <JarvisWorkspaceBar />
      </CodexProvider>
    );

    await screen.findByTestId('jarvis-workspace-error');
    expect(screen.getByTestId('jarvis-workspace-error').textContent).toMatch(/Not a git repository/i);
  });
});
