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

describe("post-fix", () => {
  it("SeedSettings + JarvisChat (former hang trigger)", async () => { render(<CodexProvider><SeedSettings><JarvisChat conversationId="conv-1" /></SeedSettings></CodexProvider>); });
});
