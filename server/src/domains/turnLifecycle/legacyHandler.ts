/**
 * turnLifecycle/legacyHandler.ts — the pre-Phase-1 routing systems as ONE handler.
 *
 * turnRouter (which internally reaches ControlPlaneTurnHandler,
 * CanonicalTurnExecutionService, UniversalExecutionController, the
 * supervisor and capability discovery) and, when it does not handle the
 * request, jarvisOrchestrator (intentRouter + workers) are invoked exactly
 * once, under the lifecycle's context key and turn-ownership frame.
 *
 * They no longer own the turn: their text, `executed` and `verified` flags are
 * converted into an ExecutionReceipt. `verified` is discarded. They do not
 * speak (TTS is the controller's), and they do not write to the user-facing
 * conversation (they write into the lifecycle's context conversation).
 */
import { logger } from '../../utils/logger.js';
import { conversationService } from '../conversations/service.js';
import type { ExecutionReceipt, TurnRecord, TurnSink } from './types.js';

/** Legacy routes that change the world when `executed` is true. */
const SIDE_EFFECT_ROUTES = new Set(['action', 'navigate', 'browser', 'project_operate', 'engineering_delegation']);
/** Orchestrator routes that dispatch work or mutate state. */
const ORCHESTRATOR_SIDE_EFFECT_ROUTES = new Set(['codex', 'hermes', 'agent_teams', 'magnitude', 'memory', 'maintenance', 'team']);

export async function ensureContextConversation(contextKey: string, conversationId: string): Promise<void> {
  const existing = await conversationService.getConversation(contextKey);
  if (!existing) {
    await conversationService.createConversation(`[lifecycle context] ${conversationId}`, undefined, 'jarvis-context', contextKey);
  }
}

async function latestAgentMessageSince(conversationId: string, sinceIso: string): Promise<string> {
  try {
    const msgs: any[] = await conversationService.getMessages(conversationId);
    const fresh = msgs.filter((m) => m.role === 'agent' && String(m.createdAt) >= sinceIso && typeof m.content === 'string');
    return fresh.length ? String(fresh[fresh.length - 1].content) : '';
  } catch { return ''; }
}

export async function runLegacyHandler(record: TurnRecord, sink: TurnSink, isStale: () => boolean): Promise<ExecutionReceipt> {
  const startedAt = new Date().toISOString();
  const req = record.request;
  const contextKey = record.contextKey;
  await ensureContextConversation(contextKey, req.conversationId);

  const { runWithTurnOwnership } = await import('../jarvis/perception/turnOwnership.js');
  const turnId = req.externalTurnId && /^\d+$/.test(req.externalTurnId) ? Number(req.externalTurnId) : Date.parse(req.receivedAt);

  return runWithTurnOwnership({ conversationId: contextKey, turnId, operationId: req.requestId }, async () => {
    try {
      const { routeTurn } = await import('../jarvisNext/turnRouter.js');
      const routed = await routeTurn({
        prompt: req.text,
        conversationId: contextKey,
        turnId,
        rawStt: req.text,
        confidence: req.sttConfidence,
        isStale,
        navigationVerifier: sink.navigationVerifier,
        onActionProgress: (p: any) => sink.progress?.({ type: 'action_status', ...p }),
      });
      if (routed.handled && (routed.text || '').trim()) {
        const sideEffect = Boolean(routed.executed) && SIDE_EFFECT_ROUTES.has(String(routed.route));
        return {
          executor: `legacy.turnRouter:${routed.route}`,
          attempted: true,
          completedWithoutError: !routed.fallbackReason,
          startedAt,
          finishedAt: new Date().toISOString(),
          error: routed.fallbackReason,
          handlerText: routed.text,
          handlerClaimedSideEffect: sideEffect,
          // `verified`/`evidence` from the legacy router are intentionally not carried over.
          details: { route: routed.route, legacyExecuted: Boolean(routed.executed), entityName: routed.entityName ?? null, uiRoute: routed.uiRoute ?? null },
        };
      }
    } catch (err: any) {
      logger.warn('[TurnLifecycle] turnRouter handler error; falling back to orchestrator', { requestId: req.requestId, error: err?.message });
    }

    // turnRouter did not handle it: jarvisOrchestrator (intentRouter + worker dispatch + direct LLM), once.
    try {
      const { jarvisOrchestrator } = await import('../jarvis/orchestrator.js');
      const { getWorkspaceRoot } = await import('../../services/workspaceStore.js');
      let workspace = '';
      try { workspace = getWorkspaceRoot(); } catch { /* optional */ }
      const since = new Date().toISOString();
      const res: any = await jarvisOrchestrator.handleMessage(contextKey, req.text, workspace, 'manual', req.requestId);
      const text = (res?.message as string) || (await latestAgentMessageSince(contextKey, since)) || (res?.error ? String(res.error) : '');
      const route = String(res?.route || 'direct');
      return {
        executor: `legacy.jarvisOrchestrator:${route}`,
        attempted: true,
        completedWithoutError: !res?.error,
        startedAt,
        finishedAt: new Date().toISOString(),
        error: res?.error,
        handlerText: text,
        handlerClaimedSideEffect: ORCHESTRATOR_SIDE_EFFECT_ROUTES.has(route) && !res?.error,
        details: { route, status: res?.status ?? null, goalId: res?.goalId ?? null, taskId: res?.taskId ?? null },
      };
    } catch (err: any) {
      return {
        executor: 'legacy.jarvisOrchestrator',
        attempted: true,
        completedWithoutError: false,
        startedAt,
        finishedAt: new Date().toISOString(),
        error: `legacy_handler_error: ${err?.message || err}`,
        details: {},
      };
    }
  });
}
