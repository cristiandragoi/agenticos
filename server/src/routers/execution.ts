/**
 * Execution state API (coherence milestone).
 *   GET /api/execution/current — canonical current + last + history
 *   GET /api/execution/stream  — SSE broadcast of every change
 *   POST /api/execution/cancel — STOPPING → dispatch the cancel action
 */
import { Router, Request, Response } from 'express';
import * as executionState from '../services/executionState.js';
import type { CancelAction } from '../services/executionState.js';

export const executionRouter = Router();

/** Stream-owned aborts registered by the Jarvis stream handler. */
const streamAborters = new Map<string, AbortController>();

export function registerStreamAborter(operationId: string, controller: AbortController): void {
  streamAborters.set(operationId, controller);
}
export function unregisterStreamAborter(operationId: string): void {
  streamAborters.delete(operationId);
}

async function dispatchCancel(c: CancelAction): Promise<void> {
  if (c.kind === 'stream') {
    const controller = streamAborters.get(c.id);
    controller?.abort();
    return;
  }
  if (c.kind === 'task') {
    const { backgroundTaskManager } = await import('../services/backgroundTasks/manager.js');
    backgroundTaskManager.cancelTask(c.id, 'User pressed STOP on the execution bar.');
    return;
  }
  if (c.kind === 'goal') {
    const { codexService } = await import('../domains/codex/service.js');
    await codexService.abortGoal(c.id);
  }
}
export { dispatchCancel };

executionRouter.get('/current', (_req: Request, res: Response) => {
  res.json(executionState.snapshot());
});

executionRouter.get('/stream', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  const send = (label: string, data: unknown) => {
    try { res.write(`event: ${label}\ndata: ${JSON.stringify(data)}\n\n`); } catch { /* client gone */ }
  };
  send('snapshot', executionState.snapshot());
  const off = executionState.onExecutionChange((s) => send('change', s));
  req.on('close', () => { off(); res.end(); });
});

executionRouter.post('/cancel', async (req: Request, res: Response) => {
  const operationId = req.body?.operationId as string | undefined;
  if (!operationId) { res.status(400).json({ error: 'operationId required' }); return; }
  const rec = await executionState.cancel(operationId, dispatchCancel);
  if (!rec) { res.status(404).json({ error: 'No execution with this operationId' }); return; }
  res.json({ success: true, status: 'STOPPING', operationId });
});
