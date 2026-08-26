/**
 * Execution state API (coherence milestone).
 *   GET /api/execution/current — canonical current + last + history
 *   GET /api/execution/stream  — SSE broadcast of every change
 *   POST /api/execution/cancel — STOPPING → dispatch the cancel action
 */
import { Router } from 'express';
import * as executionState from '../services/executionState.js';
export const executionRouter = Router();
/** Stream-owned aborts registered by the Jarvis stream handler. */
const streamAborters = new Map();
/** TASK_COMPLETED pub/sub (task-completion milestone). */
const completionSubscribers = new Set();
const publishedOperations = new Set();
const recentCompletions = [];
const MAX_RECENT_COMPLETIONS = 50;
export function registerStreamAborter(operationId, controller) {
    streamAborters.set(operationId, controller);
}
export function unregisterStreamAborter(operationId) {
    streamAborters.delete(operationId);
}
/**
 * Publish ONE user-facing completion event per operation (never replays).
 * The text summary and the spoken summary come from the same event.
 */
export function publishCompletion(event) {
    if (publishedOperations.has(event.operationId))
        return false;
    publishedOperations.add(event.operationId);
    recentCompletions.push(event);
    if (recentCompletions.length > MAX_RECENT_COMPLETIONS)
        recentCompletions.shift();
    for (const fn of completionSubscribers) {
        try {
            fn(event);
        }
        catch { /* subscriber error */ }
    }
    return true;
}
export function onCompletion(fn) {
    completionSubscribers.add(fn);
    return () => completionSubscribers.delete(fn);
}
export function recentCompletionEvents() {
    return [...recentCompletions];
}
async function dispatchCancel(c) {
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
executionRouter.get('/current', (_req, res) => {
    res.json(executionState.snapshot());
});
executionRouter.get('/completions', (_req, res) => {
    res.json(recentCompletionEvents());
});
executionRouter.get('/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();
    const send = (label, data) => {
        try {
            res.write(`event: ${label}\ndata: ${JSON.stringify(data)}\n\n`);
        }
        catch { /* client gone */ }
    };
    send('snapshot', executionState.snapshot());
    const off = executionState.onExecutionChange((s) => send('change', s));
    const offCompletion = onCompletion((event) => send('task_completed', event));
    req.on('close', () => { off(); offCompletion(); res.end(); });
});
executionRouter.post('/cancel', async (req, res) => {
    const operationId = req.body?.operationId;
    if (!operationId) {
        res.status(400).json({ error: 'operationId required' });
        return;
    }
    const rec = await executionState.cancel(operationId, dispatchCancel);
    if (!rec) {
        res.status(404).json({ error: 'No execution with this operationId' });
        return;
    }
    res.json({ success: true, status: 'STOPPING', operationId });
});
