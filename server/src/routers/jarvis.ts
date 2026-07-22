import { Router } from 'express';
import { conversationService } from '../domains/conversations/service.js';
import { jarvisOrchestrator } from '../domains/jarvis/orchestrator.js';
import { TeamRunner } from '../services/agentTeams/teamRunner.js';
import { db } from '../db/index.js';
import { conversations, teams, teamRuns } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';

const router = Router();

/* ── GET /api/jarvis/conversations ────────────────────────── */
router.get('/conversations', async (req, res) => {
  try {
    const list = await conversationService.listConversations();
    res.json(list);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/* ── POST /api/jarvis/conversations ───────────────────────── */
router.post('/conversations', async (req, res) => {
  try {
    const { title, workspaceId } = req.body;
    const id = await conversationService.createConversation(title || 'New Conversation', workspaceId);
    res.json({ id });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/* ── GET /api/jarvis/conversations/:id/messages ───────────── */
router.get('/conversations/:id/messages', async (req, res) => {
  try {
    const messages = await conversationService.getMessages(req.params.id);
    res.json(messages);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/* ── POST /api/jarvis/conversations/:id/message ───────────── */
/**
 * Normalize the UI approval-policy vocabulary ('auto' | 'strict') to the
 * backend vocabulary ('auto' | 'manual'). Anything unknown defaults to
 * 'manual' — actions that need approval must never be silently auto-approved.
 */
function normalizeApprovalPolicy(value: any): 'manual' | 'auto' {
  if (value === 'auto') return 'auto';
  return 'manual';
}

router.post('/conversations/:id/message', async (req, res) => {
  try {
    const { prompt, workspacePath, approvalPolicy, operationId } = req.body;
    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ error: 'prompt is required' });
    }

    // Let the orchestrator handle everything (recording user message, routing, and acting).
    // workspacePath is passed through verbatim: routes that create real work validate
    // it and return an explicit error instead of falling back to a fake 'default'.
    const result = await jarvisOrchestrator.handleMessage(
      req.params.id,
      prompt,
      typeof workspacePath === 'string' ? workspacePath.trim() : '',
      normalizeApprovalPolicy(approvalPolicy),
      typeof operationId === 'string' ? operationId : undefined
    );

    if (result?.error) {
      // The error is already recorded as a conversation message by the orchestrator;
      // surface it honestly at the HTTP level too.
      return res.status(400).json({ error: result.error, route: result.route });
    }
    res.json(result || { success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/* ── POST /api/jarvis/conversations/:id/approve_team ──────── */
router.post('/conversations/:id/approve_team', async (req, res) => {
  try {
    const conversationId = req.params.id;
    const { teamId } = req.body;
    if (!teamId) return res.status(400).json({ error: 'teamId is required' });

    // 1. Validate conversation exists
    const conv = await db.query.conversations.findFirst({
      where: eq(conversations.id, conversationId)
    });
    if (!conv) return res.status(404).json({ error: 'Conversation not found' });

    // 2. Validate team exists and is awaiting approval
    const team = await db.query.teams.findFirst({
      where: eq(teams.id, teamId)
    });
    if (!team) return res.status(404).json({ error: 'Team not found' });

    // Idempotency: If already running or completed, return existing run
    if (team.status !== 'awaiting_approval' && team.status !== 'cancelled' && team.status !== 'declined') {
      const existingRun = await db.query.teamRuns.findFirst({
        where: eq(teamRuns.teamId, teamId)
      });
      if (existingRun) {
        return res.json({ runId: existingRun.id, teamId, status: existingRun.status });
      }
    }

    if (team.status === 'cancelled' || team.status === 'declined') {
      return res.status(400).json({ error: 'Cannot approve a cancelled team' });
    }

    // 3. Mark team as approved
    await db.update(teams)
      .set({ status: 'approved' })
      .where(eq(teams.id, teamId))
      .run();

    const runId = await TeamRunner.startTeam(teamId);

    // Update conversation activeRunId
    await db.update(conversations)
      .set({ activeRunId: runId })
      .where(eq(conversations.id, conversationId))
      .run();

    // Append execution message so UI switches to live card
    await conversationService.appendMessage({
      conversationId,
      role: 'system',
      messageType: 'team_execution',
      content: 'Agent Team execution started.',
      runId, // store the runId natively
      metadata: { runId, teamId, executionStatus: 'started', createdAt: new Date().toISOString() }
    });

    res.json({ runId, teamId });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/* ── POST /api/jarvis/conversations/:id/cancel_team ──────── */
router.post('/conversations/:id/cancel_team', async (req, res) => {
  try {
    const conversationId = req.params.id;
    const { teamId } = req.body;
    if (!teamId) return res.status(400).json({ error: 'teamId is required' });

    const team = await db.query.teams.findFirst({
      where: eq(teams.id, teamId)
    });
    if (!team) return res.status(404).json({ error: 'Team not found' });

    if (team.status !== 'awaiting_approval') {
      return res.status(400).json({ error: 'Team is not awaiting approval' });
    }

    await db.update(teams)
      .set({ status: 'cancelled' })
      .where(eq(teams.id, teamId))
      .run();

    await conversationService.appendMessage({
      conversationId,
      role: 'system',
      messageType: 'system_status',
      content: `Team execution cancelled.`
    });

    res.json({ success: true, teamId, status: 'cancelled' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/* ── GET /api/jarvis/stream/:id ───────────────────────────── */
router.get('/stream/:id', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  conversationService.addStreamClient(req.params.id, res);

  req.on('close', () => {
    conversationService.removeStreamClient(req.params.id, res);
  });
});
/* ── GET /api/jarvis/diagnostics ─────────────────────────── */
router.get('/diagnostics', async (_req, res) => {
  // Return lightweight system diagnostics without exposing model reasoning
  res.json({
    summary: {
      connectedProviders: 1,
      totalProviders: 1,
      healthyRuntimes: 1,
      totalRuntimes: 1,
    },
    services: {
      hermes: { status: 'unavailable', reason: 'Not yet integrated' },
      memory: { status: 'unavailable', reason: 'Not yet integrated' },
      stt: { status: 'unavailable', reason: 'Not yet integrated' },
    }
  });
});

export default router;
