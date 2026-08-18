import React, { useEffect } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JarvisChat } from '../components/jarvis/JarvisChat';
import { JarvisComposer } from '../components/jarvis/JarvisComposer';
import { JarvisWorkspaceBar } from '../components/jarvis/JarvisWorkspaceBar';
import TeamTimeline from '../components/teams/TeamTimeline';
import JarvisStudio from '../pages/JarvisStudio';
import { CodexProvider, useCodexStore } from '../store/codexStore';
import { ProjectProvider } from '../store/projectStore';

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
  if (url.endsWith('/api/health/gateway')) return jsonResponse({ status: 'healthy' });
  if (url.endsWith('/api/hermes-api/status')) return jsonResponse({ profile: 'backend-engineer', url: 'http://127.0.0.1:8643', gateway: { reachable: true, detail: 'ok' }, stt: { configured: true, provider: 'deepgram' }, tts: { configured: true, provider: 'deepgram' } });
  if (url.endsWith('/api/hermes-api/runs')) return jsonResponse([]);
  if (url.includes('/api/hermes-api/runs/')) return jsonResponse({});
  if (url.endsWith('/api/teams/team-xyz')) return jsonResponse(TEAM);
  if (url.endsWith('/api/teams/runs/run-1/reports')) return jsonResponse({ reports: [] });
  if (url.endsWith('/api/teams/runs/run-1/handoffs')) return jsonResponse([BUILDER_HANDOFF]);
  if (url.endsWith('/api/teams/runs/run-1/artifacts')) return jsonResponse([]);
  if (url.endsWith('/api/teams/runs/run-1')) return jsonResponse({ id: 'run-1', teamId: 'team-xyz', status: 'completed', currentAgent: 'a3', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  return jsonResponse({});
}

const SeedSettings: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { setRunSettings } = useCodexStore();
  const runOnce = React.useRef(false);
  useEffect(() => {
    if (runOnce.current) return;
    runOnce.current = true;
    setRunSettings(prev => ({ ...prev, workspacePath: 'B:\\Repo', approvalPolicy: 'strict' }));
  }, []);
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
  it('keeps the Jarvis composer singular and the mic button active', () => {
    render(<JarvisComposer onSendMessage={vi.fn()} isProcessing={false} />);

    expect(screen.getAllByTestId('jarvis-composer')).toHaveLength(1);
    // Button aria-label is now "Start voice input" since the feature is enabled
    expect(screen.getByLabelText('Start voice input')).not.toBeDisabled();
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

/* ── 4: Canonical /jarvis page (MILESTONE 1–3) ───────────── */
describe('Canonical Jarvis page', () => {
  const renderPage = () => render(
    <CodexProvider>
      <ProjectProvider>
        <MemoryRouter initialEntries={['/jarvis']}>
          <JarvisStudio />
        </MemoryRouter>
      </ProjectProvider>
    </CodexProvider>
  );

  it('renders the orb cockpit, status strip and chat workspace', async () => {
    renderPage();
    expect(await screen.findByTestId('jarvis-dashboard')).toBeInTheDocument();
    expect(screen.getByTestId('jarvis-status-strip')).toBeInTheDocument();
    expect(screen.getByTestId('jarvis-chat-workspace')).toBeInTheDocument();
    expect(screen.getByTestId('jarvis-orb-status-label')).toBeInTheDocument();
  });

  it('removed the Command Matrix and permanent Action Log', async () => {
    renderPage();
    await screen.findByTestId('jarvis-dashboard');
    expect(screen.queryByTestId('jarvis-command-matrix')).not.toBeInTheDocument();
    expect(screen.queryByTestId('jarvis-inspector')).not.toBeInTheDocument();
    expect(screen.queryByTestId('action-log-empty')).not.toBeInTheDocument();
  });

  it('shows Manual / Conversation selector, voice toggle and kill switch', async () => {
    renderPage();
    await screen.findByTestId('jarvis-dashboard');
    expect(screen.getByTestId('jarvis-mode-manual')).toBeInTheDocument();
    expect(screen.getByTestId('jarvis-mode-conversation')).toBeInTheDocument();
    expect(screen.getByTestId('jarvis-voice-toggle')).toBeInTheDocument();
    expect(screen.getByTestId('jarvis-voice-select')).toBeInTheDocument();
    expect(screen.getByTestId('jarvis-stop-speaking')).toBeInTheDocument();
  });

  it('shows the engine-driven mic control (single owner) and keeps Send', async () => {
    renderPage();
    await screen.findByTestId('jarvis-dashboard');
    // The microphone control is the page-level engine-driven button — one
    // microphone owner. In manual mode it is idle and labelled MIC.
    const mic = screen.getByTestId('jarvis-mic-button');
    expect(mic).toBeInTheDocument();
    expect(mic).toHaveTextContent('MIC');
    // Send remains available for typed/manual submission.
    expect(screen.getByRole('button', { name: /send message/i })).toBeInTheDocument();
  });

  it('exposes a compact working Actions menu', async () => {
    renderPage();
    await screen.findByTestId('jarvis-dashboard');
    const menu = screen.getByTestId('jarvis-actions-menu');
    fireEvent.click(menu);
    expect(screen.getByText('Open board')).toBeInTheDocument();
    expect(screen.getByText('Open Mission Control')).toBeInTheDocument();
    expect(screen.getByText('Settings')).toBeInTheDocument();
  });

  it('shows a current Hermes run panel and collapsible activity', async () => {
    renderPage();
    await screen.findByTestId('jarvis-dashboard');
    expect(screen.getByTestId('jarvis-current-run')).toBeInTheDocument();
    expect(screen.getByTestId('jarvis-activity-toggle')).toBeInTheDocument();
    expect(screen.queryByTestId('jarvis-activity-stream')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('jarvis-activity-toggle'));
    expect(screen.getByTestId('jarvis-activity-stream')).toBeInTheDocument();
  });

  it('does not render an approval modal when no approval is pending', async () => {
    renderPage();
    await screen.findByTestId('jarvis-dashboard');
    expect(screen.queryByTestId('jarvis-approval-modal')).not.toBeInTheDocument();
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

/* ── 9: Canonical cockpit layout ─────────────────────────── */
describe('Phase 1 Dashboard and Telemetry', () => {
  const renderPage = () => render(
    <CodexProvider>
      <ProjectProvider>
        <MemoryRouter initialEntries={['/jarvis']}>
          <JarvisStudio />
        </MemoryRouter>
      </ProjectProvider>
    </CodexProvider>
  );

  it('jarvis-dashboard renders on /jarvis', async () => {
    renderPage();
    expect(await screen.findByTestId('jarvis-dashboard')).toBeInTheDocument();
  });

  it('large orb renders with status label outside the core', async () => {
    messagesForTest = [{ id: 'm1', role: 'user', content: 'hello', createdAt: new Date().toISOString() }];
    renderPage();
    const core = await screen.findByTestId('jarvis-orb-core');
    expect(core.textContent).not.toMatch(/IDLE|LISTENING|TRANSCRIBING|THINKING|SPEAKING|ERROR/i);
    expect(screen.getByTestId('jarvis-orb-status-label')).toBeInTheDocument();
  });

  it('Actions menu "New conversation" creates a conversation', async () => {
    const postCalls: any[] = [];
    fetchMock.mockImplementation((url: string, options?: any) => {
      if (String(url).endsWith('/api/jarvis/conversations') && options?.method === 'POST') {
        postCalls.push([url, options]);
        return Promise.resolve(jsonResponse({ id: 'conv-new' }));
      }
      return Promise.resolve(routeFetch(url, options));
    });
    renderPage();
    await screen.findByTestId('jarvis-dashboard');
    fireEvent.click(screen.getByTestId('jarvis-actions-menu'));
    fireEvent.click(screen.getByText('New conversation'));
    await waitFor(() => {
      expect(postCalls.length).toBeGreaterThan(0);
    });
  });

  it('does not render an empty conversation sidebar wrapper', async () => {
    renderPage();
    await screen.findByTestId('jarvis-dashboard');
    expect(screen.queryByText('Conversations')).not.toBeInTheDocument();
    expect(screen.queryByText('No recent conversations.')).not.toBeInTheDocument();
  });

  it('renders only one Jarvis composer in the dashboard shell', async () => {
    renderPage();
    await screen.findByTestId('jarvis-dashboard');
    expect(screen.getAllByTestId('jarvis-composer')).toHaveLength(1);
  });

  it('renders cockpit and chat as separate sections', async () => {
    renderPage();
    const layout = await screen.findByTestId('jarvis-active-layout');
    const cockpit = screen.getByTestId('jarvis-dashboard');
    const chatWorkspace = screen.getByTestId('jarvis-chat-workspace');

    expect(layout.contains(cockpit)).toBe(true);
    expect(layout.contains(chatWorkspace)).toBe(true);
    expect(cockpit.contains(chatWorkspace)).toBe(false);
    expect(chatWorkspace.contains(cockpit)).toBe(false);
  });

  it('keeps chat history in the chat workspace, not inside the cockpit', async () => {
    messagesForTest = [{ id: 'm1', role: 'agent', content: 'Visible response body', createdAt: new Date().toISOString() }];
    renderPage();

    const cockpit = await screen.findByTestId('jarvis-dashboard');
    const chatWorkspace = screen.getByTestId('jarvis-chat-workspace');
    const history = screen.getByTestId('jarvis-chat-scroll');

    const matches = await screen.findAllByText('Visible response body');
    expect(matches.length).toBeGreaterThanOrEqual(1);
    const chatMsg = matches.find(el => chatWorkspace.contains(el));
    expect(chatMsg).toBeDefined();
    expect(chatWorkspace.contains(history)).toBe(true);
    expect(cockpit.contains(history)).toBe(false);
  });

  it('renders only one scrollable conversation history', async () => {
    renderPage();
    await screen.findByTestId('jarvis-dashboard');

    const histories = screen.getAllByTestId('jarvis-chat-scroll');
    expect(histories).toHaveLength(1);
    expect(histories[0].className).toContain('chatContainer');
  });

  it('keeps the message history in the chat workspace; composer is the sticky bottom of the center column (§8)', async () => {
    renderPage();
    await screen.findByTestId('jarvis-dashboard');

    const chatWorkspace = screen.getByTestId('jarvis-chat-workspace');
    const history = screen.getByTestId('jarvis-chat-scroll');
    const composer = screen.getByTestId('jarvis-composer');
    const centerScroll = screen.getByTestId('jarvis-center-scroll');

    expect(chatWorkspace.contains(history)).toBe(true);
    // Final layout correction §8: the composer can never disappear below the
    // fold — it lives OUTSIDE the scrolling document, docked at the bottom
    // of the center column.
    expect(chatWorkspace.contains(composer)).toBe(false);
    expect(centerScroll.contains(composer)).toBe(false);
    const mainColumn = screen.getByTestId('jarvis-active-layout');
    expect(mainColumn.contains(composer)).toBe(true);
  });

  it('keeps chat workspace and message history out of fixed or absolute positioning', async () => {
    renderPage();
    await screen.findByTestId('jarvis-dashboard');

    const chatWorkspace = screen.getByTestId('jarvis-chat-workspace');
    const history = screen.getByTestId('jarvis-chat-scroll');

    expect(getComputedStyle(chatWorkspace).position).not.toMatch(/fixed|absolute/);
    expect(getComputedStyle(history).position).not.toMatch(/fixed|absolute/);
  });

  it('keeps the large orb inside the cockpit section', async () => {
    renderPage();

    const cockpit = await screen.findByTestId('jarvis-dashboard');
    const orbCore = screen.getByTestId('jarvis-orb-core');

    expect(cockpit.contains(orbCore)).toBe(true);
    expect(screen.getByTestId('jarvis-chat-workspace').contains(orbCore)).toBe(false);
  });

  it('does not render an obsolete chat overlay wrapper', async () => {
    renderPage();
    await screen.findByTestId('jarvis-dashboard');

    expect(document.querySelector('[data-testid="jarvis-chat-overlay"]')).toBeNull();
    expect(document.querySelector('[data-testid="jarvis-background-chat"]')).toBeNull();
    expect(document.querySelector('[data-testid="jarvis-obsolete-chat-wrapper"]')).toBeNull();
  });

  it('uses the canonical split layout for cockpit and chat', async () => {
    renderPage();
    const layout = await screen.findByTestId('jarvis-active-layout');

    expect(layout.contains(screen.getByTestId('jarvis-dashboard'))).toBe(true);
    expect(layout.contains(screen.getByTestId('jarvis-chat-workspace'))).toBe(true);
  });
});

/* ── 9: Orb persistence and layout ────────────────────────────── */
describe('Orb persistence and layout', () => {
  const renderPage = (fetchImpl?: any) => {
    if (fetchImpl) fetchMock.mockImplementation(fetchImpl);
    return render(
      <CodexProvider>
        <ProjectProvider>
          <MemoryRouter initialEntries={['/jarvis']}>
            <SeedSettings>
              <JarvisStudio />
            </SeedSettings>
          </MemoryRouter>
        </ProjectProvider>
      </CodexProvider>
    );
  };

  it('keeps JarvisOrb rendered after data updates and API errors', async () => {
    const { container } = renderPage();

    const orbCore = await screen.findByTestId('jarvis-orb-core');
    expect(orbCore).toBeInTheDocument();
    expect(screen.getAllByTestId('jarvis-orb-core')).toHaveLength(1);

    const wrapper = await screen.findByTestId('jarvis-orb-wrapper');
    expect(wrapper).toBeInTheDocument();

    expect(screen.getAllByTestId('jarvis-chat-workspace')).toHaveLength(1);
  });

  it('cockpit and orb remain mounted when activeConversationId is null', async () => {
    renderPage(async (url: string) => {
      if (url.endsWith('/api/jarvis/conversations')) return jsonResponse([]);
      return routeFetch(url);
    });

    expect(await screen.findByTestId('jarvis-dashboard')).toBeInTheDocument();
    expect(screen.getByTestId('jarvis-orb-core')).toBeInTheDocument();
    expect(screen.getByTestId('jarvis-chat-workspace')).toBeInTheDocument();
    // Canonical page: no Command Matrix, no permanent inspector.
    expect(screen.queryByTestId('jarvis-command-matrix')).not.toBeInTheDocument();
    expect(screen.queryByTestId('jarvis-inspector')).not.toBeInTheDocument();
  });

  it('orb remains mounted when conversation fetch fails', async () => {
    renderPage(async (url: string) => {
      if (url.endsWith('/api/jarvis/conversations')) throw new Error('502 Bad Gateway');
      return routeFetch(url);
    });

    expect(await screen.findByTestId('jarvis-orb-core')).toBeInTheDocument();
  });

  it('first typed message creates a real conversation when activeConversationId is null without sending fake default ID', async () => {
    const requestedUrls: string[] = [];
    renderPage(async (url: string, options?: any) => {
      requestedUrls.push(url);
      if (url.endsWith('/api/jarvis/conversations') && !options) return jsonResponse([]);
      if (url.endsWith('/api/jarvis/conversations') && options?.method === 'POST') return jsonResponse({ id: 'conv-real-123' });
      if (url.endsWith('/api/jarvis/conversations/conv-real-123/message/stream')) return directStreamResponse();
      return routeFetch(url, options);
    });

    const textarea = screen.getByLabelText('Message Input');
    fireEvent.change(textarea, { target: { value: 'Reply with hello' } });

    const sendBtn = screen.getByRole('button', { name: /send/i });
    fireEvent.click(sendBtn);

    await waitFor(() => {
      expect(requestedUrls.some(u => u.includes('conv-real-123'))).toBe(true);
    });

    expect(requestedUrls.some(u => u.includes('default'))).toBe(false);
  });
});
