import React, { useEffect } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JarvisChat } from '../components/jarvis/JarvisChat';
import { JarvisComposer } from '../components/jarvis/JarvisComposer';
import { JarvisWorkspaceBar } from '../components/jarvis/JarvisWorkspaceBar';
import TeamTimeline from '../components/teams/TeamTimeline';
import JarvisStudio from '../pages/JarvisStudio';
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
  constructor(url: string) { this.url = url; MockEventSource.instances.push(this); }
  addEventListener(type: string, cb: any) { this.listeners[type] = cb; }
  close() {}
}

/* ── Fetch mock ───────────────────────────────────────────── */
const fetchMock = vi.fn();
let messagesForTest: any[] = [];
let goalStatus = 'completed';
let detectValid = true;
const encoder = new TextEncoder();

function jsonResponse(body: any, ok = true, status = 200) {
  return { ok, status, statusText: ok ? 'OK' : 'ERROR', json: async () => body };
}

function sse(event: string, data: any) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function directStreamResponse() {
  return {
    ok: true,
    status: 200,
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(sse('chunk', { delta: 'Direct answer.' })));
        controller.enqueue(encoder.encode(sse('done', { route: 'direct', firstTokenMs: 10 })));
        controller.close();
      }
    })
  };
}

const BUILDER_HANDOFF = {
  id: 'h1',
  agentId: 'a2',
  status: 'completed',
  summary: 'Built the requested file with exact content.',
  artifacts: [{ path: 'jarvis-integration-test.txt', checksum: 'abc', size: 42 }],
  createdAt: '1784741386170'
};

const TEAM = {
  id: 'team-xyz',
  name: 'Integration File Team',
  status: 'completed',
  teamSheet: {
    agents: [
      { id: 'a1', name: 'Planner', role: 'Planner' },
      { id: 'a2', name: 'Builder', role: 'Builder' },
      { id: 'a3', name: 'Verifier', role: 'Verifier' }
    ]
  }
};

function routeFetch(url: string, options?: any) {
  if (url.endsWith('/api/jarvis/conversations/conv-1/messages')) return jsonResponse(messagesForTest);
  if (url.endsWith('/api/jarvis/conversations/conv-1/message/stream') && options?.method === 'POST') return directStreamResponse();
  if (url.endsWith('/api/jarvis/conversations/conv-1/message') && options?.method === 'POST') return jsonResponse({ goalId: 'goal-abc', route: 'codex', status: 'completed' });
  if (url.endsWith('/api/chat/agents/goal/goal-abc')) return jsonResponse({ id: 'goal-abc', status: goalStatus, originalGoal: 'Build a thing', history: [], createdAt: new Date().toISOString() });
  if (url.endsWith('/api/chat/agents/goal/goal-abc/approve')) return jsonResponse({ success: true });
  if (url.endsWith('/api/workspace/detect')) {
    return detectValid
      ? jsonResponse({ isValid: true, cwd: 'B:\\AgenticOS\\server', gitRoots: ['B:\\Repo'] })
      : jsonResponse({ isValid: false, errorMessage: 'No Git repository found in this folder tree.' });
  }
  if (url.endsWith('/api/jarvis/conversations') && !options) return jsonResponse([{ id: 'conv-1', title: 'Main' }]);
  if (url.endsWith('/api/jarvis/conversations') && options?.method === 'POST') return jsonResponse({ id: 'conv-new' });
  if (url.endsWith('/api/jarvis/diagnostics')) return jsonResponse({ summary: { connectedProviders: 1, totalProviders: 1, healthyRuntimes: 1, totalRuntimes: 1 }, services: {} });
  if (url.endsWith('/api/teams/team-xyz')) return jsonResponse(TEAM);
  if (url.endsWith('/api/teams/runs/run-1/reports')) return jsonResponse({ reports: [] });
  if (url.endsWith('/api/teams/runs/run-1/handoffs')) return jsonResponse([BUILDER_HANDOFF]);
  if (url.endsWith('/api/teams/runs/run-1/artifacts')) return jsonResponse([]);
  if (url.endsWith('/api/teams/runs/run-1')) return jsonResponse({ id: 'run-1', teamId: 'team-xyz', status: 'completed', currentAgent: 'a3', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  return jsonResponse({});
}

const SeedSettings: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { setRunSettings } = useCodexStore();
  useEffect(() => {
    setRunSettings(prev => ({ ...prev, workspacePath: 'B:\\Repo', approvalPolicy: 'strict' }));
  }, [setRunSettings]);
  return <>{children}</>;
};

beforeEach(() => {
  window.localStorage.clear();
  MockEventSource.instances = [];
  messagesForTest = [];
  goalStatus = 'completed';
  detectValid = true;
  fetchMock.mockImplementation((url: string, options?: any) => Promise.resolve(routeFetch(url, options)));
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('EventSource', MockEventSource);
  globalThis.fetch = fetchMock as any;
  window.fetch = fetchMock as any;
  (globalThis as any).EventSource = MockEventSource;
  (window as any).EventSource = MockEventSource;
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

/* ── 1 & 2: Composer placement and Send button ────────────── */
describe('Composer layout', () => {
  it('keeps the Jarvis composer singular with inactive experimental voice', () => {
    render(<JarvisComposer onSendMessage={vi.fn()} isProcessing={false} />);

    expect(screen.getAllByTestId('jarvis-composer')).toHaveLength(1);
    expect(screen.getByLabelText('Voice input experimental')).toBeDisabled();
    expect(screen.getByText('Voice experimental')).toBeInTheDocument();
    expect(screen.queryByText(/Listening/i)).not.toBeInTheDocument();
  });

  it('renders the composer outside (never inside) the scrollable timeline container', async () => {
    render(<CodexProvider><JarvisChat conversationId="conv-1" /></CodexProvider>);

    const scroll = screen.getByTestId('jarvis-chat-scroll');
    const composer = screen.getByTestId('jarvis-composer');

    expect(scroll.contains(composer)).toBe(false);
    expect(composer.contains(scroll)).toBe(false);
    // Composer comes after the scroll area in document order (bottom of the column).
    expect(scroll.compareDocumentPosition(composer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('has a clearly visible Send button with text', () => {
    render(<CodexProvider><JarvisChat conversationId="conv-1" /></CodexProvider>);
    const sendBtn = screen.getByRole('button', { name: /send message/i });
    expect(sendBtn).toBeInTheDocument();
    expect(sendBtn.textContent).toContain('Send');
  });
});

/* ── 3 & 6: Timeline labels and wrapping ──────────────────── */
describe('Execution timeline', () => {
  const renderTimeline = (summary = BUILDER_HANDOFF.summary) =>
    render(<TeamTimeline team={TEAM} run={{ id: 'run-1' }} />);

  it('renders meaningful entries instead of generic "Handoff: →" labels', async () => {
    renderTimeline();
    await screen.findByText(/Builder — Created jarvis-integration-test\.txt/);
    expect(screen.queryByText(/Handoff:/)).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain('undefined');
    expect(screen.getByText('Team Completed')).toBeInTheDocument();
  });

  it('applies wrapping classes so long event text cannot overflow horizontally', async () => {
    const longSummary = 'x'.repeat(500);
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/api/teams/runs/run-1/handoffs')) {
        return Promise.resolve(jsonResponse([{ ...BUILDER_HANDOFF, summary: longSummary }]));
      }
      return Promise.resolve(routeFetch(url));
    });
    renderTimeline();
    const title = await screen.findByText(/Builder — Created/);
    expect(title.className).toContain('break-words');
  });

  it('never shows "Agent Executing" when the run is paused (run status wins over stale team status)', async () => {
    render(<TeamTimeline team={{ ...TEAM, status: 'running' }} run={{ id: 'run-1', status: 'paused' }} />);
    await screen.findByText(/Paused \(Review or Repair\)/);
    expect(screen.queryByText('Agent Executing')).not.toBeInTheDocument();
  });

  it('never shows "Agent Executing" when the run is completed', async () => {
    render(<TeamTimeline team={{ ...TEAM, status: 'running' }} run={{ id: 'run-1', status: 'completed' }} />);
    await screen.findByText('Team Completed');
    expect(screen.queryByText('Agent Executing')).not.toBeInTheDocument();
  });
});

/* ── 4: Inspector collapse ────────────────────────────────── */
describe('Right inspector', () => {
  it('can be collapsed and reopened via the toggle button', async () => {
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 1920 });
    render(<CodexProvider><JarvisStudio /></CodexProvider>);

    const inspector = await screen.findByTestId('jarvis-inspector');
    expect(inspector).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /toggle inspector/i }));
    expect(screen.queryByTestId('jarvis-inspector')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /toggle inspector/i }));
    expect(await screen.findByTestId('jarvis-inspector')).toBeInTheDocument();
  });

  it('auto-collapses at narrow widths (1366px) without user action', async () => {
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 1366 });
    render(<CodexProvider><JarvisStudio /></CodexProvider>);
    await waitFor(() => {
      expect(screen.queryByTestId('jarvis-inspector')).not.toBeInTheDocument();
    });
    // The toggle remains available to reopen it.
    expect(screen.getByRole('button', { name: /toggle inspector/i })).toBeInTheDocument();
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 1024 });
  });
});

/* ── 5 & 7: Execution cards and composer state ────────────── */
describe('Execution cards and composer state', () => {
  it('leaves the composer usable after the execution completes', async () => {
    messagesForTest = [{
      id: 'm1', role: 'system', messageType: 'system_status',
      content: 'CodeX Goal initialized: goal-abc', goalId: 'goal-abc',
      createdAt: new Date().toISOString()
    }];
    render(
      <CodexProvider>
        <SeedSettings>
          <JarvisChat conversationId="conv-1" />
        </SeedSettings>
      </CodexProvider>
    );

    // Goal card reaches Completed state.
    const card = await screen.findByTestId('jarvis-goal-card');
    await waitFor(() => expect(card.textContent).toContain('Completed'));

    // Composer still accepts and sends the next message.
    fireEvent.change(screen.getByLabelText('Message Input'), { target: { value: 'next task' } });
    const sendBtn = screen.getByRole('button', { name: /send message/i });
    expect(sendBtn).not.toBeDisabled();
  });

  it('renders exactly one active team execution card even with multiple execution messages', async () => {
    messagesForTest = [
      { id: 'm1', role: 'system', messageType: 'team_execution', content: 'Agent Team execution started.', runId: 'run-1', createdAt: new Date().toISOString() },
      { id: 'm2', role: 'system', messageType: 'team_execution', content: 'Agent Team execution started.', runId: 'run-1', createdAt: new Date().toISOString() }
    ];
    render(<CodexProvider><JarvisChat conversationId="conv-1" /></CodexProvider>);

    await waitFor(() => {
      expect(screen.getAllByTestId('jarvis-team-execution')).toHaveLength(1);
    });
  });
});

/* ── 8: Repository gating ─────────────────────────────────── */
describe('Repository gating', () => {
  it('keeps ordinary typed Jarvis chat usable when no repository is selected', async () => {
    detectValid = false;
    render(<CodexProvider><JarvisChat conversationId="conv-1" /></CodexProvider>);

    const input = screen.getByLabelText('Message Input');
    fireEvent.change(input, { target: { value: 'What can you do?' } });
    const sendBtn = screen.getByRole('button', { name: /send message/i });
    expect(sendBtn).not.toBeDisabled();
    expect(input.getAttribute('placeholder')).toBe('Ask Jarvis anything...');

    fireEvent.click(sendBtn);
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/api/jarvis/conversations/conv-1/message/stream'))).toBe(true);
    });
  });

  it('shows an explicit "Select repository" state in the workspace bar', async () => {
    detectValid = false;
    render(<CodexProvider><JarvisWorkspaceBar /></CodexProvider>);
    await screen.findByTestId('jarvis-workspace-error');
    expect(screen.getByTestId('jarvis-workspace-error').textContent).toMatch(/select repository/i);
  });
});
