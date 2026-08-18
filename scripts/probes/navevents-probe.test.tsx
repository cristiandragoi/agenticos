import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import JarvisStudio from '../../src/pages/JarvisStudio';
import { CodexProvider } from '../../src/store/codexStore';

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
function makeTask(over: Record<string, any> = {}) {
  return {
    taskId: 'bgtask-nav-1', title: 'Inspect JarvisCore', objective: 'Read-only inspection',
    originalRequest: 'Inspect the voice architecture', route: 'hermes', selectedAgent: 'Hermes',
    worker: 'hermes', status: 'running', priority: 'medium', projectId: null,
    createdAt: '2026-08-06T12:00:00.000Z', startedAt: '2026-08-06T12:00:01.000Z',
    updatedAt: '2026-08-06T12:01:00.000Z', completedAt: null, conversationId: 'conv-1',
    conversationSessionId: null, linkedRunId: 'hapi-live-1', linkedBoardCardId: 'card-abc',
    parentTaskId: null, childTaskIds: [], currentStage: 'running', progressMessage: 'Hermes agent started.',
    filesChanged: [], buildState: 'idle', testState: 'idle', verificationState: 'none',
    approvalState: 'none', blocker: null, lastError: null, cancellationRequested: false,
    resumable: true, metadata: {}, ...over,
  };
}

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
  if (url.startsWith('/api/background-tasks/approvals')) return jsonResponse([]);
  if (url.includes('/api/background-tasks/') && url.includes('/events')) return { ok: true, status: 200, json: async () => ({ events: [] }) };
  if (url.includes('/api/background-tasks/') && options?.method) return jsonResponse({ ok: true });
  if (url.endsWith('/api/jarvis/conversations/conv-1/messages')) return jsonResponse([]);
  if (url.endsWith('/message/stream') && options?.method === 'POST') return Promise.resolve(streamResponse(navEvents));
  if (url.endsWith('/message') && options?.method === 'POST') return jsonResponse({});
  if (url.startsWith('/api/jarvis/conversations') && options?.method === 'POST') return jsonResponse({ id: 'conv-1' });
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
  (window as any).HTMLElement.prototype.scrollIntoView = vi.fn();
  (window as any).matchMedia = (window as any).matchMedia || vi.fn().mockImplementation((query: string) => ({
    matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), onchange: null, dispatchEvent: vi.fn(),
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location-probe">{location.pathname}</div>;
}

const renderPage = () => render(
  <CodexProvider>
    <MemoryRouter initialEntries={['/jarvis']}>
      <Routes>
        <Route path="/jarvis" element={<><JarvisStudio /><LocationProbe /></>} />
        <Route path="/codex" element={<div data-testid="codex-page">CodeX Studio</div>} />
      </Routes>
    </MemoryRouter>
  </CodexProvider>
);

async function typeAndSend(text: string) {
  const input = await screen.findByLabelText('Message Input');
  fireEvent.change(input, { target: { value: text } });
  const sendBtn = screen.getByRole('button', { name: /send message/i });
  await waitFor(() => expect(sendBtn).not.toBeDisabled());
  fireEvent.click(sendBtn);
}

describe('NavEvents probe', () => {
  it('probe: trace navigation flow', async () => {
    navEvents = [
      sse('status', { state: 'thinking' }),
      sse('intent', { type: 'navigation', route: 'navigation', mode: 'operational_execution' }),
      sse('navigation', { target: '/codex', capability: 'codex', operationId: 'op-1' }),
      sse('done', { route: 'navigation' }),
    ];
    renderPage();
    await typeAndSend('Open CodeX');

    // Wait a beat for the async stream to be consumed
    await new Promise(r => setTimeout(r, 1500));

    const streamCalls = fetchMock.mock.calls.filter((c: any) => String(c[0]).includes('/message/stream'));
    console.log('PROBE stream POST calls:', streamCalls.length, streamCalls.map((c: any) => c[0]));
    const loc = screen.queryByTestId('location-probe');
    console.log('PROBE location:', loc?.textContent);
    console.log('PROBE codex-page present:', !!screen.queryByTestId('codex-page'));
    expect(true).toBe(true);
  }, 15000);
});
