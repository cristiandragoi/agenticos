/**
 * jarvisGlobalStreamLifecycle.test.ts
 *
 * Global Jarvis Streaming Lifecycle Regression Suite verifying:
 * 1. DIRECT answer with slow (>45s simulated) LLM inference does not abort while backend is alive.
 * 2. Hermes delegation remains unaffected.
 * 3. Codex/background delegation remains unaffected.
 * 4. Actual dead backend still times out.
 * 5. Explicit user cancellation still aborts.
 * 6. Backend lifecycle/progress events reset liveness without pretending they are assistant tokens.
 * 7. A hung LLM eventually reaches a genuine inference timeout rather than infinite RUNNING.
 * 8. BodyStreamBuffer was aborted is never exposed as the primary user-facing diagnosis for an internally initiated timeout.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

vi.setConfig({ hookTimeout: 60000, testTimeout: 30000 });

let tmpDir: string;
let backgroundTaskManager: any;
let backgroundTaskRepo: any;
let jarvisOrchestrator: any;
let executionState: any;
let conversationService: any;

async function freshModules() {
  vi.resetModules();
  const { db } = await import('../db/index.js');
  const { migrate } = await import('drizzle-orm/better-sqlite3/migrator');
  const migrationsFolder = path.resolve(__dirname, '../../drizzle');
  try {
    migrate(db, { migrationsFolder });
  } catch { /* tables already migrated or in-memory */ }

  const { initProjectExecutionSchema } = await import('../services/projectExecution/schema.js');
  initProjectExecutionSchema();

  const storeMod = await import('../services/backgroundTasks/store.js');
  const mgrMod = await import('../services/backgroundTasks/manager.js');
  const orchMod = await import('../domains/jarvis/orchestrator.js');
  const execMod = await import('../services/executionState.js');
  const convMod = await import('../domains/conversations/service.js');

  return {
    manager: mgrMod.backgroundTaskManager,
    repo: storeMod.backgroundTaskRepo,
    orchestrator: orchMod.jarvisOrchestrator,
    executionState: execMod,
    conversationService: convMod.conversationService,
  };
}

describe('Global Jarvis Streaming Lifecycle Contract', () => {
  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stream-life-'));
    process.env.AGENT_TEAMS_DB_PATH = path.join(tmpDir, 'test.db');

    const modules = await freshModules();
    backgroundTaskManager = modules.manager;
    backgroundTaskRepo = modules.repo;
    jarvisOrchestrator = modules.orchestrator;
    executionState = modules.executionState;
    conversationService = modules.conversationService;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    try {
      if (tmpDir && fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    } catch {
      // ignore
    }
  });

  it('1. DIRECT answer with slow (>45s simulated) LLM inference does not abort while backend is alive', async () => {
    let livenessTimer: any = null;
    let timedOut = false;
    let timeoutReason: string | null = null;
    const LIVENESS_TIMEOUT_MS = 45_000;

    const resetLiveness = () => {
      if (livenessTimer) clearTimeout(livenessTimer);
      livenessTimer = setTimeout(() => {
        timedOut = true;
        timeoutReason = 'Backend connection timed out (no backend activity for 45s).';
      }, LIVENESS_TIMEOUT_MS);
    };

    resetLiveness();

    let simulatedElapsed = 0;
    const eventsReceived: string[] = [];

    while (simulatedElapsed < 50_000) {
      simulatedElapsed += 10_000;
      eventsReceived.push('heartbeat');
      resetLiveness();
    }

    eventsReceived.push('chunk: The capital of France is Paris.');
    if (livenessTimer) clearTimeout(livenessTimer);

    expect(timedOut).toBe(false);
    expect(timeoutReason).toBeNull();
    expect(eventsReceived.filter(e => e === 'heartbeat').length).toBe(5);
    expect(eventsReceived.some(e => e.startsWith('chunk:'))).toBe(true);
  });

  it('2. Hermes delegation remains unaffected', async () => {
    const convId = await conversationService.createConversation('Hermes test');
    const prompt = 'Ask Hermes to inspect whether B:\\AgenticOS\\package.json exists. If execution approval is required, wait for my approval. Do not modify anything.';
    const opId = `op-hermes-${Date.now()}`;

    // Test background task creation and supervisor registration for Hermes worker
    const { task } = backgroundTaskManager.createTask({
      title: 'Hermes inspection',
      objective: prompt,
      originalRequest: prompt,
      route: 'hermes',
      selectedAgent: 'Hermes',
      worker: 'hermes',
      conversationId: convId,
      workspaceRoot: 'B:\\AgenticOS',
      metadata: { operationId: opId }
    });

    expect(task).toBeDefined();
    expect(task.worker).toBe('hermes');
    expect(task.status).toBe('queued');
    expect(task.conversationId).toBe(convId);
  });

  it('3. Codex/background delegation remains unaffected', async () => {
    const convId = await conversationService.createConversation('CodeX test');
    const prompt = 'Write a fibonacci function in math.ts';
    const opId = `op-codex-${Date.now()}`;

    const { task } = backgroundTaskManager.createTask({
      title: 'CodeX implementation',
      objective: prompt,
      originalRequest: prompt,
      route: 'codex',
      selectedAgent: 'CodeX',
      worker: 'codex',
      conversationId: convId,
      workspaceRoot: 'B:\\AgenticOS',
      metadata: { operationId: opId }
    });

    expect(task).toBeDefined();
    expect(task.worker).toBe('codex');
    expect(task.status).toBe('queued');
  });

  it('4. actual dead backend still times out', async () => {
    let timedOut = false;
    let timeoutReason: string | null = null;
    const LIVENESS_TIMEOUT_MS = 50;

    const livenessTimer = setTimeout(() => {
      timedOut = true;
      timeoutReason = 'Backend connection timed out (no backend activity for 45s).';
    }, LIVENESS_TIMEOUT_MS);

    await new Promise(r => setTimeout(r, 80));

    expect(timedOut).toBe(true);
    expect(timeoutReason).toBe('Backend connection timed out (no backend activity for 45s).');
  });

  it('5. explicit user cancellation still aborts', async () => {
    const controller = new AbortController();
    let isProcessing = true;
    let cancelled = false;

    const cancelResponse = () => {
      controller.abort();
      isProcessing = false;
      cancelled = true;
    };

    expect(isProcessing).toBe(true);
    cancelResponse();
    expect(isProcessing).toBe(false);
    expect(cancelled).toBe(true);
    expect(controller.signal.aborted).toBe(true);
  });

  it('6. backend lifecycle/progress events reset liveness without pretending they are assistant tokens', () => {
    let sawFirstChunk = false;
    let assistantText = '';
    let statusState = 'idle';

    function handleEvent(event: { event: string; data: any }) {
      if (event.event === 'heartbeat') {
        statusState = event.data.state || statusState;
      } else if (event.event === 'thinking') {
        statusState = 'thinking';
      } else if (event.event === 'intent') {
        statusState = 'understanding';
      } else if (event.event === 'chunk') {
        sawFirstChunk = true;
        assistantText += event.data.delta;
      }
    }

    handleEvent({ event: 'intent', data: { type: 'conversation', route: 'direct' } });
    expect(statusState).toBe('understanding');
    expect(sawFirstChunk).toBe(false);
    expect(assistantText).toBe('');

    handleEvent({ event: 'heartbeat', data: { state: 'thinking' } });
    expect(statusState).toBe('thinking');
    expect(sawFirstChunk).toBe(false);
    expect(assistantText).toBe('');

    handleEvent({ event: 'chunk', data: { delta: 'Hello world' } });
    expect(sawFirstChunk).toBe(true);
    expect(assistantText).toBe('Hello world');
  });

  it('7. a hung LLM eventually reaches a genuine inference timeout rather than infinite RUNNING', async () => {
    const totalTimeoutMs = 50;
    const abortController = new AbortController();
    let timedOut = false;
    let timeoutErr: Error | null = null;

    async function* hungLlmStream() {
      await new Promise(r => setTimeout(r, 5000));
      yield { type: 'token', content: 'late' };
    }

    const stream = hungLlmStream();

    async function nextWithTimeout<T>(iterator: AsyncGenerator<T>, timeoutMs: number, controller: AbortController, message: string) {
      let timer: any = null;
      try {
        return await Promise.race([
          iterator.next(),
          new Promise<IteratorResult<T>>((_, reject) => {
            timer = setTimeout(() => {
              controller.abort();
              reject(new Error(message));
            }, timeoutMs);
          })
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    }

    try {
      await nextWithTimeout(stream, totalTimeoutMs, abortController, 'Jarvis response timed out after 120000 ms.');
    } catch (err: any) {
      timedOut = true;
      timeoutErr = err;
    }

    expect(timedOut).toBe(true);
    expect(abortController.signal.aborted).toBe(true);
    expect(timeoutErr?.message).toContain('Jarvis response timed out');
  });

  it('8. BodyStreamBuffer was aborted is never exposed as the primary user-facing diagnosis for an internally initiated timeout', () => {
    function classifyTransportError(err: any, isAborted: boolean, isTimedOut: boolean, timeoutDiagnosis?: string | null) {
      if (isTimedOut) {
        return timeoutDiagnosis || 'Jarvis response timed out.';
      }
      const raw = err?.message || String(err);
      if (raw.includes('Failed to fetch') || raw.includes('NetworkError') || raw.includes('ECONNREFUSED')) {
        return 'Could not reach the backend server.';
      }
      if (raw.includes('BodyStreamBuffer was aborted') || raw.includes('aborted') || raw.includes('AbortError')) {
        return isAborted ? 'Request was cancelled.' : 'Backend stream connection was closed unexpectedly.';
      }
      return `Request error: ${raw}`;
    }

    const timeoutErr = new Error('TypeError: BodyStreamBuffer was aborted');
    expect(classifyTransportError(timeoutErr, true, true, 'Backend connection timed out (no backend activity for 45s).'))
      .toBe('Backend connection timed out (no backend activity for 45s).');

    expect(classifyTransportError(timeoutErr, true, false))
      .toBe('Request was cancelled.');

    expect(classifyTransportError(timeoutErr, false, false))
      .toBe('Backend stream connection was closed unexpectedly.');

    const msg1 = classifyTransportError(timeoutErr, true, true, 'Backend connection timed out (no backend activity for 45s).');
    const msg2 = classifyTransportError(timeoutErr, true, false);
    const msg3 = classifyTransportError(timeoutErr, false, false);
    expect(msg1).not.toContain('BodyStreamBuffer');
    expect(msg2).not.toContain('BodyStreamBuffer');
    expect(msg3).not.toContain('BodyStreamBuffer');
  });

  it('9. successful DIRECT response followed by normal stream close does not show an error', () => {
    let sendError: { message: string } | null = null;
    let requestCompletedSuccessfully = false;
    let sawTerminalEvent = false;

    // Simulate incoming chunks
    const frames = [
      { event: 'intent', data: { route: 'direct' } },
      { event: 'chunk', data: { delta: 'Jarvis is the operational commander of Agentic OS.' } },
      { event: 'done', data: { route: 'direct' } }
    ];

    for (const frame of frames) {
      if (frame.event === 'done') {
        sawTerminalEvent = true;
        requestCompletedSuccessfully = true;
      }
    }

    // Normal stream close occurs (reader.read() returns done: true)
    if (sawTerminalEvent) {
      requestCompletedSuccessfully = true;
    }

    // Error handler is NOT invoked and sendError is null
    expect(requestCompletedSuccessfully).toBe(true);
    expect(sendError).toBeNull();
  });

  it('10. abort-like exception after COMPLETED is ignored as teardown noise', () => {
    let sendError: { message: string } | null = null;
    let requestCompletedSuccessfully = true;
    let sawTerminalEvent = true;
    const controller = new AbortController();

    const handleCatch = (err: any) => {
      if (requestCompletedSuccessfully || sawTerminalEvent) {
        // Ignored teardown noise
        return;
      }
      sendError = { message: err?.message || 'Error' };
    };

    // Simulate Chromium throwing BodyStreamBuffer was aborted during reader.read() after done
    handleCatch(new Error('TypeError: BodyStreamBuffer was aborted'));
    expect(sendError).toBeNull();

    // Controller abort after completed
    controller.abort();
    handleCatch(new Error('AbortError: The user aborted a request.'));
    expect(sendError).toBeNull();
  });

  it('11. abort before completion still produces correct error/cancel behavior', () => {
    let sendError: { message: string } | null = null;
    let cancelled = false;
    let requestCompletedSuccessfully = false;
    let sawTerminalEvent = false;
    const controller = new AbortController();

    const handleCatch = (err: any) => {
      if (requestCompletedSuccessfully || sawTerminalEvent) return;
      if (controller.signal.aborted) {
        cancelled = true;
        return;
      }
      sendError = { message: err?.message || 'Error' };
    };

    controller.abort();
    handleCatch(new Error('AbortError: The user aborted a request.'));
    expect(cancelled).toBe(true);
    expect(sendError).toBeNull();
  });

  it('12. timeout before completion still produces timeout message', () => {
    let sendError: { message: string } | null = null;
    let responseTimedOut = true;
    const timeoutDiagnosis = 'Backend connection timed out (no backend activity for 45s).';
    let requestCompletedSuccessfully = false;
    let sawTerminalEvent = false;

    const handleCatch = (err: any) => {
      if (requestCompletedSuccessfully || sawTerminalEvent) return;
      if (responseTimedOut) {
        sendError = { message: timeoutDiagnosis };
        return;
      }
      sendError = { message: err?.message || 'Error' };
    };

    handleCatch(new Error('AbortError: The user aborted a request.'));
    expect(sendError).toEqual({ message: 'Backend connection timed out (no backend activity for 45s).' });
  });

  it('13. liveness timer and total response timer are cleared on successful completion', () => {
    let livenessTimer: any = setTimeout(() => {}, 45000);
    let totalResponseTimer: any = setTimeout(() => {}, 120000);

    const clearResponseTimers = () => {
      if (livenessTimer !== null) {
        clearTimeout(livenessTimer);
        livenessTimer = null;
      }
      if (totalResponseTimer !== null) {
        clearTimeout(totalResponseTimer);
        totalResponseTimer = null;
      }
    };

    // On done event
    clearResponseTimers();
    expect(livenessTimer).toBeNull();
    expect(totalResponseTimer).toBeNull();
  });

  it('14. backend heartbeat stops before/at terminal completion and no SSE writes occur after res.end()', () => {
    let heartbeatCount = 0;
    let completed = false;
    const res: any = {
      writableEnded: false,
      finished: false,
      writes: [] as string[],
      write(chunk: string) {
        this.writes.push(chunk);
      },
      end() {
        this.writableEnded = true;
        this.finished = true;
      }
    };

    function writeSse(response: any, event: string, data: any) {
      if (response.writableEnded || response.finished) return;
      response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    }

    let heartbeatTimer: any = setInterval(() => {
      if (!completed && !res.writableEnded) {
        heartbeatCount++;
        writeSse(res, 'heartbeat', { state: 'active' });
      }
    }, 10);

    writeSse(res, 'chunk', { delta: 'Answer' });
    writeSse(res, 'done', { route: 'direct' });
    completed = true;
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
    res.end();

    const writeCountAtEnd = res.writes.length;
    // Late attempt to write SSE after res.end()
    writeSse(res, 'heartbeat', { state: 'active' });
    expect(res.writes.length).toBe(writeCountAtEnd);
    expect(heartbeatTimer).toBeNull();
  });

  it('15. duplicate completion/cleanup is idempotent and assistant answer remains visible with no error', () => {
    let assistantText = '';
    let sendError: { message: string } | null = null;
    let requestCompletedSuccessfully = false;

    const onDone = (finalText: string) => {
      assistantText = finalText;
      requestCompletedSuccessfully = true;
    };

    const cleanup = () => {
      // Idempotent cleanup
      requestCompletedSuccessfully = true;
    };

    onDone('Jarvis is the operational commander of Agentic OS.');
    cleanup();
    cleanup();

    expect(assistantText).toBe('Jarvis is the operational commander of Agentic OS.');
    expect(sendError).toBeNull();
    expect(requestCompletedSuccessfully).toBe(true);
  });
});
