import React, { useEffect } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JarvisChat } from '../components/jarvis/JarvisChat';
import { CodexProvider, useCodexStore } from '../store/codexStore';

class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  listeners: Record<string, any> = {};
  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }
  addEventListener(type: string, cb: any) { this.listeners[type] = cb; }
  close() {}
}

const fetchMock = vi.fn();
let lastMessageBody: any = null;
const abortSignals: AbortSignal[] = [];

const SeedSettings: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { setRunSettings } = useCodexStore();
  useEffect(() => {
    setRunSettings(prev => ({ ...prev, workspacePath: 'B:\\Repo', approvalPolicy: 'strict' }));
  }, []);
  return <>{children}</>;
};

function sse(event: string, data: any) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function streamResponse(chunks: string[], holdOpen = false) {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      chunks.forEach(chunk => controller.enqueue(encoder.encode(chunk)));
      if (!holdOpen) controller.close();
    },
    cancel() {
      return undefined;
    }
  });
  return Promise.resolve({ ok: true, status: 200, body });
}

function renderChat({ withRepository = true } = {}) {
  return render(
    <CodexProvider>
      {withRepository ? (
        <SeedSettings>
          <JarvisChat conversationId="conv-typed" />
        </SeedSettings>
      ) : (
        <JarvisChat conversationId="conv-typed" />
      )}
    </CodexProvider>
  );
}

async function sendMessage(text: string) {
  fireEvent.change(screen.getByLabelText('Message Input'), { target: { value: text } });
  await waitFor(() => expect(screen.getByLabelText('Send Message')).not.toBeDisabled(), { timeout: 2000 });
  fireEvent.click(screen.getByLabelText('Send Message'));
}

function resetTestState() {
  window.localStorage.clear();
  MockEventSource.instances = [];
  lastMessageBody = null;
  abortSignals.length = 0;
  fetchMock.mockReset();
  fetchMock.mockImplementation((url: string, options?: any) => {
    if (url.endsWith('/api/jarvis/conversations/conv-typed/messages')) {
      return Promise.resolve({ ok: true, json: async () => [] });
    }
    if (url.endsWith('/api/jarvis/conversations/conv-typed/message/stream')) {
      lastMessageBody = JSON.parse(options.body);
      abortSignals.push(options.signal);
      return streamResponse([
        sse('timing', { marker: 'first_token', elapsedMs: 12 }),
        sse('chunk', { delta: 'Partial ' }),
        sse('chunk', { delta: 'answer.' }),
        sse('done', { route: 'direct', firstTokenMs: 12, totalMs: 30 })
      ]);
    }
    return Promise.resolve({ ok: true, json: async () => ({}) });
  });
  (globalThis as any).fetch = fetchMock;
  (globalThis as any).EventSource = MockEventSource;
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
}

afterEach(() => {
  cleanup();
});

describe('Jarvis typed streaming chat', () => {
  it('renders partial streamed text before completion', async () => {
    resetTestState();
    renderChat();
    await sendMessage('hello jarvis');

    expect(await screen.findByText(/Partial/)).toBeInTheDocument();
    expect(await screen.findByText(/Partial answer/)).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/message/stream'))).toHaveLength(1);
    expect(lastMessageBody.prompt).toBe('hello jarvis');
    expect(lastMessageBody.message).toBeUndefined();
  });

  it('renders a visible error when a direct stream closes without a terminal event', async () => {
    resetTestState();
    fetchMock.mockImplementation((url: string, options?: any) => {
      if (url.endsWith('/api/jarvis/conversations/conv-typed/messages')) {
        return Promise.resolve({ ok: true, json: async () => [] });
      }
      if (url.endsWith('/api/jarvis/conversations/conv-typed/message/stream')) {
        lastMessageBody = JSON.parse(options.body);
        return streamResponse([
          sse('intent', { type: 'conversation', route: 'direct', mode: 'direct_conversation', reason: 'test direct' })
        ]);
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    renderChat();
    await sendMessage('Are you there?');

    expect(await screen.findByTestId('jarvis-send-error')).toHaveTextContent('Jarvis stream closed before sending a completion or error event.');
    await waitFor(() => expect(screen.queryByLabelText('Cancel Response')).not.toBeInTheDocument());
  });

  it('old CodeX goal cards do not remain pinned below a new direct reply', async () => {
    resetTestState();
    fetchMock.mockImplementation((url: string, options?: any) => {
      if (url.endsWith('/api/jarvis/conversations/conv-typed/messages')) {
        return Promise.resolve({
          ok: true,
          json: async () => [{
            id: 'old-codex-card',
            role: 'system',
            messageType: 'system_status',
            content: 'CodeX Goal initialized: goal-old',
            goalId: 'goal-old',
            createdAt: new Date().toISOString()
          }]
        });
      }
      if (url.endsWith('/api/jarvis/conversations/conv-typed/message/stream')) {
        lastMessageBody = JSON.parse(options.body);
        return streamResponse([
          sse('timing', { marker: 'first_token', elapsedMs: 10 }),
          sse('chunk', { delta: 'OK' }),
          sse('done', { route: 'direct', firstTokenMs: 10, totalMs: 20 })
        ]);
      }
      if (url.includes('/api/chat/agents/goal/goal-old')) {
        return Promise.resolve({ ok: true, json: async () => ({ id: 'goal-old', status: 'completed' }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    renderChat();
    // Wait for the initial messages to be loaded
    await screen.findByText('CodeX Goal initialized: goal-old');
    fetchMock.mockClear();

    await sendMessage('Reply only with OK.');

    expect(await screen.findByText('OK')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/api/chat/agents/goal/goal-old'))).toBe(false);
  });

  it('submits ordinary typed chat without a selected repository', async () => {
    resetTestState();
    renderChat({ withRepository: false });
    await sendMessage('What can you do?');

    await waitFor(() => expect(lastMessageBody).toBeTruthy());
    expect(lastMessageBody).toMatchObject({
      prompt: 'What can you do?',
      operationId: expect.any(String),
      workspacePath: 'B:\\AgenticOS',
      repositoryPath: 'B:\\AgenticOS'
    });
  });

  it('Cancel Response aborts the active stream and returns to idle', async () => {
    resetTestState();
    fetchMock.mockImplementation((url: string, options?: any) => {
      if (url.endsWith('/api/jarvis/conversations/conv-typed/messages')) {
        return Promise.resolve({ ok: true, json: async () => [] });
      }
      if (url.endsWith('/api/jarvis/conversations/conv-typed/message/stream')) {
        lastMessageBody = JSON.parse(options.body);
        abortSignals.push(options.signal);
        return streamResponse([sse('chunk', { delta: 'Still streaming.' })], true);
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    renderChat();
    await sendMessage('cancel this');
    const cancel = await screen.findByLabelText('Cancel Response');
    fireEvent.click(cancel);

    expect(abortSignals[0].aborted).toBe(true);
    await waitFor(() => expect(screen.queryByLabelText('Cancel Response')).not.toBeInTheDocument());
  });

  it('renders operational intent, plan, approval, and CodeX execution events in the same chat', async () => {
    resetTestState();
    fetchMock.mockImplementation((url: string, options?: any) => {
      if (url.endsWith('/api/jarvis/conversations/conv-typed/messages')) {
        return Promise.resolve({ ok: true, json: async () => [] });
      }
      if (url.endsWith('/api/jarvis/conversations/conv-typed/message/stream')) {
        lastMessageBody = JSON.parse(options.body);
        return streamResponse([
          sse('intent', { type: 'repository_change', route: 'codex', mode: 'operational_execution', reason: 'Repository change request' }),
          sse('plan', { steps: ['Confirm selected repository', 'Prepare implementation plan', 'Request approval before file changes'] }),
          sse('agent_selected', { agent: 'CodeX', reason: 'Repository change request' }),
          sse('approval_required', { reason: 'This request may write files.', proposedAction: 'Fix the duplicate composer', workspace: 'B:\\Repo' }),
          sse('execution_progress', { route: 'codex', agent: 'CodeX', state: 'delegating' }),
          sse('done', { route: 'codex', goalId: 'goal-real', status: 'waiting_for_approval' })
        ]);
      }
      if (url.endsWith('/api/chat/agents/goal/goal-real')) {
        return Promise.resolve({ ok: true, json: async () => ({ id: 'goal-real', status: 'waiting_for_approval', originalGoal: 'Fix', history: [] }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    renderChat();
    await sendMessage('Fix the duplicate composer');

    expect(await screen.findByText(/Intent: repository_change/)).toBeInTheDocument();
    expect(await screen.findByTestId('jarvis-operational-plan')).toHaveTextContent('Prepare implementation plan');
    expect(await screen.findByText(/Selected agent: CodeX/)).toBeInTheDocument();
    expect(await screen.findByTestId('jarvis-approval-card')).toHaveTextContent('Approval Required');
    expect(screen.queryByText(/Execution completed/)).not.toBeInTheDocument();
    expect(screen.getAllByTestId('jarvis-composer')).toHaveLength(1);
  });
});
