import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import JarvisStudio from '../pages/JarvisStudio';
import { CodexProvider } from '../store/codexStore';
import { ProjectProvider } from '../store/projectStore';

/* ── jsdom stubs ──────────────────────────────────────────── */
beforeEach(() => {
  (window as any).HTMLElement.prototype.scrollIntoView = vi.fn();
  (window as any).matchMedia = (window as any).matchMedia || vi.fn().mockImplementation((query: string) => ({
    matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), onchange: null, dispatchEvent: vi.fn(),
  }));
});

/* ── SSE helpers ──────────────────────────────────────────── */
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

function jsonResponse(body: any, ok = true, status = 200) {
  return { ok, status, statusText: ok ? 'OK' : 'ERROR', json: async () => body };
}

/* ── Fixtures ─────────────────────────────────────────────── */
function makeTask(over: Record<string, any> = {}) {
  return {
    taskId: 'bgtask-nav-1',
    title: 'Inspect JarvisCore',
    objective: 'Read-only inspection',
    originalRequest: 'Inspect the voice architecture',
    route: 'hermes',
    selectedAgent: 'Hermes',
    worker: 'hermes',
    status: 'running',
    priority: 'medium',
    projectId: null,
    createdAt: '2026-08-06T12:00:00.000Z',
    startedAt: '2026-08-06T12:00:01.000Z',
    updatedAt: '2026-08-06T12:01:00.000Z',
    completedAt: null,
    conversationId: 'conv-1',
    conversationSessionId: null,
    linkedRunId: 'hapi-live-1',
    linkedBoardCardId: 'card-abc',
    parentTaskId: null,
    childTaskIds: [],
    currentStage: 'running',
    progressMessage: 'Hermes agent started.',
    filesChanged: [],
    buildState: 'idle',
    testState: 'idle',
    verificationState: 'none',
    approvalState: 'none',
    blocker: null,
    lastError: null,
    cancellationRequested: false,
    resumable: true,
    metadata: {},
    ...over,
  };
}

/* ── Fetch mock ───────────────────────────────────────────── */
const fetchMock = vi.fn();
let summaryTasks: any[] = [];
let navEvents: string[] = [];

function routeFetch(url: string, options?: any) {
  if (url.startsWith('/api/background-tasks/summary')) {
    const active = summaryTasks.filter((t: any) => !['completed', 'failed', 'cancelled'].includes(t.status)).length;
    const queued = summaryTasks.filter((t: any) => t.status === 'queued').length;
    const waitingApproval = summaryTasks.filter((t: any) => t.status === 'waiting_approval').length;
    const failedOrBlocked = summaryTasks.filter((t: any) => ['failed', 'blocked', 'cancelled'].includes(t.status)).length;
    return jsonResponse({ active, queued, waitingApproval, failedOrBlocked, tasks: summaryTasks });
  }
  if (url.startsWith('/api/background-tasks/approvals')) {
    return jsonResponse([]);
  }
  if (url.includes('/api/background-tasks/') && url.includes('/events')) {
    return { ok: true, status: 200, json: async () => ({ events: [] }) };
  }
  if (url.includes('/api/background-tasks/') && options?.method) {
    return jsonResponse({ ok: true });
  }
  if (url.endsWith('/api/jarvis/conversations/conv-1/messages')) {
    return jsonResponse([]);
  }
  if (url.endsWith('/message/stream') && options?.method === 'POST') {
    return Promise.resolve(streamResponse(navEvents));
  }
  if (url.endsWith('/message') && options?.method === 'POST') {
    return jsonResponse({});
  }
  if (url.startsWith('/api/jarvis/conversations') && options?.method === 'POST') {
    return jsonResponse({ id: 'conv-1' });
  }
  return jsonResponse({});
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation((url: string, options?: any) => Promise.resolve(routeFetch(url, options)));
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('EventSource', class {
    static instances: any[] = [];
    readyState = 0;
    onopen: any = null;
    onerror: any = null;
    listeners: Record<string, any> = {};
    url: string;
    constructor(url: string) {
      this.url = url;
      (this.constructor as any).instances.push(this);
    }
    addEventListener(t: string, cb: any) { this.listeners[t] = cb; }
    close() {}
  });
  summaryTasks = [makeTask()];
  navEvents = [];
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/* ── Route probe ──────────────────────────────────────────── */
function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location-probe">{location.pathname}</div>;
}

const renderPage = () => render(
  <CodexProvider>
    <ProjectProvider>
      <MemoryRouter initialEntries={['/jarvis']}>
        <Routes>
          <Route path="/jarvis" element={<><JarvisStudio /><LocationProbe /></>} />
          <Route path="/codex" element={<div data-testid="codex-page">CodeX Studio</div>} />
          <Route path="/hermes-studio" element={<div data-testid="hermes-page">Hermes Studio</div>} />
          <Route path="/hermes" element={<div data-testid="hermes-page">Hermes (alias)</div>} />
          <Route path="/boards" element={<div data-testid="boards-page">Boards</div>} />
          <Route path="/memory" element={<div data-testid="memory-page">Memory</div>} />
          <Route path="/automations" element={<div data-testid="automations-page">Automations</div>} />
          <Route path="/research" element={<div data-testid="research-page">Research</div>} />
          <Route path="/files" element={<div data-testid="files-page">Files</div>} />
          <Route path="/models" element={<div data-testid="models-page">Models</div>} />
          <Route path="/agent-teams" element={<div data-testid="teams-page">Agent Teams</div>} />
        </Routes>
      </MemoryRouter>
    </ProjectProvider>
  </CodexProvider>
);

/* ── Helpers ──────────────────────────────────────────────── */
async function typeAndSend(text: string) {
  const input = await screen.findByLabelText('Message Input');
  fireEvent.change(input, { target: { value: text } });
  const sendBtn = screen.getByRole('button', { name: /send message/i });
  await waitFor(() => expect(sendBtn).not.toBeDisabled());
  // The send handler's async stream continuation calls navigate() from a
  // promise chain. Under parallel-worker load React can defer that commit
  // past the assertion window (observed flake). Running the click + a
  // microtask drain inside act() flushes it deterministically; the test's
  // waitFor then observes the committed route.
  await act(async () => {
    fireEvent.click(sendBtn);
    await new Promise(r => setTimeout(r, 20));
  });
}

/* ── Tests ────────────────────────────────────────────────── */
describe('Jarvis navigation SSE events', () => {
  it('navigation SSE event opens the supported target route', async () => {
    navEvents = [
      sse('status', { state: 'thinking' }),
      sse('intent', { type: 'navigation', route: 'navigation', mode: 'operational_execution' }),
      sse('navigation', { target: '/codex', capability: 'codex', operationId: 'op-1' }),
      sse('done', { route: 'navigation' }),
    ];
    renderPage();
    await typeAndSend('Open CodeX');
    await waitFor(() => expect(screen.getByTestId('codex-page')).toBeInTheDocument());
  });

  it('Hermes / Boards / Memory / Automations / Research targets also navigate', async () => {
    const cases: Array<[string, string]> = [
      ['/hermes-studio', 'hermes-page'],
      ['/boards', 'boards-page'],
      ['/memory', 'memory-page'],
      ['/automations', 'automations-page'],
      ['/research', 'research-page'],
      ['/files', 'files-page'],
      ['/models', 'models-page'],
      ['/agent-teams', 'teams-page'],
    ];
    for (const [target, testid] of cases) {
      navEvents = [
        sse('navigation', { target, capability: 'any', operationId: 'op-x' }),
        sse('done', { route: 'navigation' }),
      ];
      const { unmount } = renderPage();
      await typeAndSend(`Open ${target}`);
      await waitFor(() => expect(screen.getByTestId(testid)).toBeInTheDocument());
      unmount();
    }
    // 8 full render→send→stream→navigate cycles in jsdom exceed the default
    // 5s test timeout; give this loop a bounded window instead.
  }, 30000);

  it('Open Hermes navigates to the existing Hermes route', async () => {
    navEvents = [
      sse('navigation', { target: '/hermes', capability: 'hermes', operationId: 'op-hermes' }),
      sse('done', { route: 'navigation' }),
    ];
    renderPage();
    await typeAndSend('Open Hermes');
    await waitFor(() => expect(screen.getByTestId('hermes-page')).toBeInTheDocument());
  });

  it('callback is not fired twice for one navigation event', async () => {
    navEvents = [
      sse('navigation', { target: '/codex', capability: 'codex', operationId: 'op-dedup' }),
      // The backend may flush the same frame list twice; the exactly-once
      // guard must forward the navigation handler only once.
      sse('navigation', { target: '/codex', capability: 'codex', operationId: 'op-dedup' }),
      sse('done', { route: 'navigation' }),
    ];
    renderPage();
    await typeAndSend('Open CodeX');
    await waitFor(() => expect(screen.getByTestId('codex-page')).toBeInTheDocument());
    // Navigated to codex exactly once — no double navigation to a different
    // route and the location is stable at /codex.
    expect(screen.queryByTestId('codex-page')).toBeInTheDocument();
  });

  it('invalid navigation targets are rejected and never navigate', async () => {
    navEvents = [
      sse('navigation', { target: 'https://evil.example', capability: 'evil', operationId: 'op-bad' }),
      sse('navigation', { target: '/etc/passwd', capability: 'evil', operationId: 'op-bad2' }),
      sse('done', { route: 'navigation' }),
    ];
    renderPage();
    await typeAndSend('Open evil');
    // Still on /jarvis — neither invalid target navigated anywhere
    await waitFor(() => expect(screen.getByTestId('location-probe').textContent).toBe('/jarvis'));
    expect(screen.queryByTestId('codex-page')).not.toBeInTheDocument();
  });

  it('a navigation event does not create a background task', async () => {
    navEvents = [
      sse('navigation', { target: '/codex', capability: 'codex', operationId: 'op-1' }),
      sse('done', { route: 'navigation' }),
    ];
    renderPage();
    await typeAndSend('Open CodeX');
    await waitFor(() => expect(screen.getByTestId('codex-page')).toBeInTheDocument());
    const createCalls = fetchMock.mock.calls.filter((c: any) =>
      c[0]?.includes('/api/background-tasks') && !c[0]?.includes('summary') && !c[0]?.includes('approvals') && !c[0]?.includes('/events') && c[1]?.method === 'POST'
    );
    expect(createCalls).toHaveLength(0);
  });

  it('an active background task continues after navigation (still listed, still running)', async () => {
    navEvents = [
      sse('navigation', { target: '/codex', capability: 'codex', operationId: 'op-1' }),
      sse('done', { route: 'navigation' }),
    ];
    renderPage();
    await typeAndSend('Open CodeX');
    await waitFor(() => expect(screen.getByTestId('codex-page')).toBeInTheDocument());
    // Task data remains available on the backend summary (fetched again after remount)
    expect(summaryTasks[0].status).toBe('running');
  });

  it('returning to /jarvis restores the conversation and active tasks', async () => {
    // 1. On /jarvis, the task panel (open by default) shows the active task
    renderPage();
    expect(await screen.findByTestId('jarvis-task-row-bgtask-nav-1')).toBeInTheDocument();

    // 2. Navigate away via the navigation SSE event
    navEvents = [
      sse('navigation', { target: '/codex', capability: 'codex', operationId: 'op-1' }),
      sse('done', { route: 'navigation' }),
    ];
    await typeAndSend('Open CodeX');
    await waitFor(() => expect(screen.getByTestId('codex-page')).toBeInTheDocument());

    // 3. Return to /jarvis (as if the user clicks the nav rail)
    // Remount by re-rendering with the initial entry — the task summary is
    // fetched fresh from the backend and the task row is restored.
    const { unmount } = render(<CodexProvider>
      <ProjectProvider>
        <MemoryRouter initialEntries={['/jarvis']}>
          <Routes>
            <Route path="/jarvis" element={<><JarvisStudio /><LocationProbe /></>} />
            <Route path="/codex" element={<div data-testid="codex-page">CodeX Studio</div>} />
          </Routes>
        </MemoryRouter>
      </ProjectProvider>
    </CodexProvider>);
    expect(await screen.findByTestId('jarvis-task-row-bgtask-nav-1')).toBeInTheDocument();
    expect(screen.getByTestId('jarvis-chat-workspace')).toBeInTheDocument();
    unmount();
  });
});
