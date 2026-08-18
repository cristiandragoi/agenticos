import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
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

/* ── Fixtures ─────────────────────────────────────────────── */
function makeTask(over: Record<string, any> = {}) {
  return {
    taskId: 'bgtask-test-1',
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
    conversationId: null,
    conversationSessionId: null,
    linkedRunId: 'hapi-live-1',
    linkedBoardCardId: 'card-abc',
    parentTaskId: null,
    childTaskIds: [],
    currentStage: 'running',
    progressMessage: 'Hermes agent started.',
    filesChanged: ['src/components/jarvis/JarvisCore.tsx'],
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

const TASK_RUNNING = makeTask();
const TASK_PAUSED = makeTask({ taskId: 'bgtask-test-2', title: 'Research topic', worker: 'research', selectedAgent: 'Research', status: 'paused', resumable: true });
const TASK_DONE = makeTask({ taskId: 'bgtask-test-3', title: 'Finished task', status: 'completed', resumable: false, verificationState: 'passed' });

/* ── Fetch mock ───────────────────────────────────────────── */
const fetchMock = vi.fn();
let approvalsResponse: any[] = [];
let summaryTasks: any[] = [TASK_RUNNING];

function jsonResponse(body: any, ok = true, status = 200) {
  return { ok, status, statusText: ok ? 'OK' : 'ERROR', json: async () => body };
}

function routeFetch(url: string, options?: any) {
  if (url.startsWith('/api/background-tasks/summary')) {
    const active = summaryTasks.filter((t: any) => !['completed', 'failed', 'cancelled'].includes(t.status)).length;
    const queued = summaryTasks.filter((t: any) => t.status === 'queued').length;
    const waitingApproval = summaryTasks.filter((t: any) => t.status === 'waiting_approval').length;
    const failedOrBlocked = summaryTasks.filter((t: any) => ['failed', 'blocked', 'cancelled'].includes(t.status)).length;
    return jsonResponse({ active, queued, waitingApproval, failedOrBlocked, tasks: summaryTasks });
  }
  if (url.startsWith('/api/background-tasks/approvals')) {
    return jsonResponse(approvalsResponse);
  }
  if (url.includes('/api/background-tasks/') && url.includes('/events')) {
    return { ok: true, status: 200, json: async () => ({ events: [] }) };
  }
  if (url.includes('/api/background-tasks/') && options?.method) {
    return jsonResponse({ ok: true });
  }
  if (url.startsWith('/api/jarvis/conversations/')) {
    return jsonResponse([]);
  }
  if (url.endsWith('/message') && options?.method === 'POST') {
    return { ok: true, status: 200, json: async () => ({}) };
  }
  if (url.includes('/api/voice/tts/status')) {
    return jsonResponse({ configured: true, provider: 'deepgram' });
  }
  return jsonResponse({});
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation((url: string, options?: any) => Promise.resolve(routeFetch(url, options)));
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('EventSource', MockEventSource);
  approvalsResponse = [];
  summaryTasks = [TASK_RUNNING];
});

afterEach(() => {
  vi.unstubAllGlobals();
  MockEventSource.instances = [];
});

const renderPage = () => render(
  <CodexProvider>
    <ProjectProvider>
      <MemoryRouter initialEntries={['/jarvis']}>
        <JarvisStudio />
      </MemoryRouter>
    </ProjectProvider>
  </CodexProvider>
);

/* ── Tests ────────────────────────────────────────────────── */
describe('Jarvis Active Tasks panel', () => {
  it('renders the tasks toggle with live summary counts', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId('jarvis-tasks-toggle')).toBeInTheDocument());
    expect(screen.getByTestId('jarvis-tasks-toggle').textContent).toContain('1 RUN');
    expect(screen.getByTestId('jarvis-tasks-toggle').textContent).toContain('0 APPR');
  });

  it('opens the panel and lists task rows with status + worker', async () => {
    renderPage();
    const row = await screen.findByTestId('jarvis-task-row-bgtask-test-1');
    expect(row.textContent).toContain('RUNNING');
    expect(row.textContent).toContain('Inspect JarvisCore');
    expect(row.textContent).toContain('hermes');
  });

  it('switches the selected task without altering the other', async () => {
    summaryTasks = [TASK_RUNNING, TASK_PAUSED];
    renderPage();
    // Select task 2
    fireEvent.click(await screen.findByTestId('jarvis-task-row-bgtask-test-2'));
    await waitFor(() => expect(screen.getByText(/Research topic/i)).toBeInTheDocument());
    // Detail reflects task 2 — AGENT value is the selected agent name
    await waitFor(() => expect(screen.getByText(/^Research$/)).toBeInTheDocument());
    expect(screen.getByText(/^PAUSED$/)).toBeInTheDocument();
    // Task 1 still listed
    expect(screen.getByTestId('jarvis-task-row-bgtask-test-1')).toBeInTheDocument();
  });

  it('shows Pause only for resumable running tasks; Resume for paused', async () => {
    summaryTasks = [TASK_RUNNING, TASK_PAUSED];
    renderPage();
    // Task 1 running + resumable → PAUSE, no RESUME
    expect(await screen.findByTestId('jarvis-task-pause')).toBeInTheDocument();
    expect(screen.queryByTestId('jarvis-task-resume')).not.toBeInTheDocument();
    // Switch to paused task → RESUME, no PAUSE
    fireEvent.click(screen.getByTestId('jarvis-task-row-bgtask-test-2'));
    await waitFor(() => expect(screen.getByTestId('jarvis-task-resume')).toBeInTheDocument());
    expect(screen.queryByTestId('jarvis-task-pause')).not.toBeInTheDocument();
  });

  it('hides Stop for terminal tasks and shows it for active ones', async () => {
    summaryTasks = [TASK_DONE, TASK_RUNNING];
    renderPage();
    fireEvent.click(await screen.findByTestId('jarvis-task-row-bgtask-test-1'));
    await waitFor(() => expect(screen.getByTestId('jarvis-task-stop')).toBeInTheDocument());
    // Switch to completed task → no STOP
    fireEvent.click(screen.getByTestId('jarvis-task-row-bgtask-test-3'));
    await waitFor(() => expect(screen.queryByTestId('jarvis-task-stop')).not.toBeInTheDocument());
  });

  it('links to the Board card and posts stop to the real endpoint', async () => {
    renderPage();
    await screen.findByTestId('jarvis-task-open-board');
    expect(screen.getByTestId('jarvis-task-open-board')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('jarvis-task-stop'));
    await waitFor(() => {
      const stopCall = fetchMock.mock.calls.find((c: any) => c[0]?.includes('/api/background-tasks/bgtask-test-1/stop'));
      expect(stopCall).toBeTruthy();
      expect(stopCall![1]?.method).toBe('POST');
    });
  });

  it('restores active tasks from the backend on mount (refresh survival)', async () => {
    renderPage();
    await waitFor(() => expect(fetchMock.mock.calls.some((c: any) => c[0]?.includes('/api/background-tasks/summary'))).toBe(true));
    expect(await screen.findByTestId('jarvis-task-row-bgtask-test-1')).toBeInTheDocument();
    // SSE subscription uses the selected task id
    await waitFor(() => {
      const es = MockEventSource.instances.find((i) => i.url.includes('/api/background-tasks/bgtask-test-1/events'));
      expect(es).toBeTruthy();
    });
  });

  it('shows pending task-owned approvals independently of the chat turn', async () => {
    approvalsResponse = [{
      taskId: 'bgtask-test-1',
      action: 'Execute command',
      reason: 'User requested file edit',
      command: 'apply_patch',
      files: ['src/components/jarvis/JarvisCore.tsx'],
      choices: ['allow_once', 'deny'],
    }];
    renderPage();
    await waitFor(() => expect(screen.getByText(/BACKGROUND TASK APPROVAL REQUIRED/i)).toBeInTheDocument());
    expect(screen.getByText(/Execute command/i)).toBeInTheDocument();
    // Deny posts to the task approval endpoint and leaves the action unexecuted
    fireEvent.click(screen.getByRole('button', { name: /DENY/i }));
    await waitFor(() => {
      const denyCall = fetchMock.mock.calls.find((c: any) => c[0]?.includes('/api/background-tasks/bgtask-test-1/approval'));
      expect(denyCall).toBeTruthy();
      expect(JSON.parse(denyCall![1]?.body || '{}').choice).toBe('deny');
    });
  });

  it('keeps normal conversation working while a task is running', async () => {
    renderPage();
    await screen.findByTestId('jarvis-dashboard');
    // Conversation controls still present
    expect(screen.getByTestId('jarvis-mode-manual')).toBeInTheDocument();
    expect(screen.getByTestId('jarvis-mode-conversation')).toBeInTheDocument();
    expect(screen.getByTestId('jarvis-chat-workspace')).toBeInTheDocument();
    // Task panel still present and independent
    expect(screen.getByTestId('jarvis-tasks-toggle')).toBeInTheDocument();
  });
});
