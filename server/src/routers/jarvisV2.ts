/**
 * jarvisV2.ts — Development-Only HTTP Router for Jarvis V2 Conversational Kernel & Voice Transport.
 *
 * Requirements:
 * - Completely separate from V1 (never intercepts or modifies V1 routes).
 * - No production switchover.
 * - No V1 fallback inside V2.
 * - Returns structured contract: conversationId, turnId, intent, text, activeEntity,
 *   activeProject, expectedInput, pendingAction, currentTask.
 * - Voice endpoints gated behind JARVIS_V2_VOICE_ENABLED (active unless explicitly set to 'false').
 */

import { Router, Request, Response } from 'express';
import multer from 'multer';
import { jarvisV2TurnController } from '../domains/jarvisV2/turnController.js';
import { loadState } from '../domains/jarvisV2/state.js';
import { normalizeTranscript } from '../domains/jarvisV2/sttNormalizer.js';
import { voiceTurnManager } from '../domains/jarvisV2/voiceTurnManager.js';
import { recordVoiceTelemetry, listVoiceTelemetry } from '../domains/jarvisV2/telemetry.js';
import { transcribeLocally, isMeaningfulSpeech } from '../services/voice/localTranscribe.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

// Middleware: Development gate check
router.use((req, res, next) => {
  if (process.env.JARVIS_V2_ENABLED === 'false') {
    return res.status(403).json({
      error: 'Jarvis V2 development endpoint is disabled (JARVIS_V2_ENABLED=false).'
    });
  }
  next();
});

/**
 * POST /api/jarvis-v2/conversations/:conversationId/message
 * Handles an interactive text turn for the given conversation.
 */
router.post('/conversations/:conversationId/message', async (req: Request, res: Response) => {
  const { conversationId } = req.params;
  const userText = req.body.message || req.body.userText || req.body.text || '';

  if (!userText || typeof userText !== 'string' || !isMeaningfulSpeech(userText)) {
    return res.status(400).json({ error: 'No meaningful speech detected.', noSpeech: true });
  }

  try {
    const result = await jarvisV2TurnController.handleTurn({
      conversationId,
      userText,
      workspaceContext: req.body.workspaceContext
    });

    return res.status(200).json({
      conversationId: result.state.conversationId,
      turnId: result.state.turnId,
      intent: result.intent,
      text: result.responseText,
      activeEntity: result.state.activeEntity,
      activeProject: result.state.activeProject,
      expectedInput: result.state.expectedInput,
      pendingAction: result.state.pendingAction,
      currentTask: result.state.currentTask,
      engine: 'jarvis-v2'
    });
  } catch (err: any) {
    return res.status(500).json({
      error: err?.message || 'Internal error in Jarvis V2 turn controller.'
    });
  }
});

/**
 * POST /api/jarvis-v2/conversations/:conversationId/voice/turn
 * Voice transport turn endpoint:
 * Accepts either JSON transcript OR uploaded audio file.
 * Handles normalization, turn ownership, V2 turn execution, TTS synthesis, and telemetry.
 */
router.post('/conversations/:conversationId/voice/turn', upload.single('audio'), async (req: Request, res: Response) => {
  if (process.env.JARVIS_V2_VOICE_ENABLED === 'false') {
    return res.status(403).json({
      error: 'Jarvis V2 voice transport is disabled (JARVIS_V2_VOICE_ENABLED=false).'
    });
  }

  const { conversationId } = req.params;
  const startTime = Date.now();

  let rawText = req.body.transcript || req.body.message || req.body.text || '';
  let confidence: number | null = req.body.confidence ? Number(req.body.confidence) : null;

  // If audio file was uploaded, run local STT
  if (req.file) {
    try {
      const ext = req.file.originalname ? (req.file.originalname.includes('.') ? req.file.originalname.substring(req.file.originalname.lastIndexOf('.')) : '.webm') : '.webm';
      const stt = await transcribeLocally(req.file.buffer, ext, req.body.language || 'en');
      rawText = stt.text;
      confidence = stt.probability !== undefined ? stt.probability : null;
    } catch (sttErr: any) {
      return res.status(500).json({ error: `STT transcription failed: ${sttErr?.message}` });
    }
  }

  if (!rawText || !rawText.trim() || !isMeaningfulSpeech(rawText)) {
    return res.status(400).json({ error: 'No meaningful speech detected.', noSpeech: true });
  }

  const normalized = normalizeTranscript(rawText, confidence);
  const stateBefore = loadState(conversationId);
  const turnId = Number(req.body.turnId) || (stateBefore.turnId + 1);
  const operationId = req.body.operationId || `v2-op-${turnId}-${Date.now()}`;

  // Register active voice turn (automatically interrupts any previous turn)
  const voiceTurn = voiceTurnManager.startVoiceTurn(conversationId, operationId, turnId);

  try {
    console.log(`[JARVIS_ENGINE_ROUTE]\nselectedEngine=v2\ndestination=/api/jarvis-v2/conversations/${conversationId}/voice/turn\nconversationId=${conversationId}`);
    console.log('engine=jarvis-v2');
    console.log('controller=JarvisV2TurnController');

    // ONE conversational brain: calls the exact same JarvisV2TurnController
    const result = await jarvisV2TurnController.handleTurn({
      conversationId,
      userText: normalized.normalizedTranscript,
      workspaceContext: req.body.workspaceContext
    });

    // Check if turn was interrupted while processing
    if (voiceTurn.state === 'interrupted') {
      return res.status(409).json({
        error: 'Voice turn was interrupted by a newer turn.',
        turnId,
        operationId,
        engine: 'jarvis-v2'
      });
    }

    // TTS synthesis if requested (defaults to true for voice turns)
    const shouldSynthesize = req.body.synthesizeTts !== false && req.body.synthesizeTts !== 'false';
    let audioBase64: string | null = null;
    let audioLengthBytes = 0;

    if (shouldSynthesize) {
      const ttsResult = await voiceTurnManager.synthesizeTurnTts(
        conversationId,
        turnId,
        result.responseText,
        req.body.voice
      );
      if (ttsResult.audioBuffer) {
        audioBase64 = ttsResult.audioBuffer.toString('base64');
        audioLengthBytes = ttsResult.audioBuffer.byteLength;
      }
    }

    const totalLatencyMs = Date.now() - startTime;

    // Record Telemetry
    recordVoiceTelemetry({
      conversationId,
      operationId,
      turnId,
      sttRawTranscript: normalized.rawTranscript,
      sttNormalizedTranscript: normalized.normalizedTranscript,
      sttConfidence: normalized.confidence,
      classification: result.intent,
      activeEntity: result.state.activeEntity?.name || null,
      expectedInput: result.state.expectedInput ? JSON.stringify(result.state.expectedInput) : null,
      pendingActionId: result.state.pendingAction?.id || null,
      currentTaskId: result.state.currentTask?.taskId || null,
      responseText: result.responseText,
      ttsStartedAt: voiceTurn.ttsStartedAt || null,
      ttsCompletedAt: voiceTurn.ttsCompletedAt || null,
      interruptedByTurnId: voiceTurn.interruptedByTurnId || null,
      totalLatencyMs,
      engine: 'jarvis-v2'
    });

    return res.status(200).json({
      conversationId: result.state.conversationId,
      operationId,
      turnId: result.state.turnId,
      intent: result.intent,
      text: result.responseText,
      audioBase64,
      audioBytes: audioLengthBytes,
      activeEntity: result.state.activeEntity,
      activeProject: result.state.activeProject,
      expectedInput: result.state.expectedInput,
      pendingAction: result.state.pendingAction,
      currentTask: result.state.currentTask,
      engine: 'jarvis-v2',
      metrics: {
        totalLatencyMs,
        sttConfidence: normalized.confidence,
        ttsDurationMs: (voiceTurn.ttsCompletedAt && voiceTurn.ttsStartedAt) ? voiceTurn.ttsCompletedAt - voiceTurn.ttsStartedAt : 0
      }
    });
  } catch (err: any) {
    return res.status(500).json({
      error: err?.message || 'Internal error in Jarvis V2 voice turn handler.'
    });
  }
});

/**
 * POST /api/jarvis-v2/conversations/:conversationId/voice/interrupt
 * Immediate Barge-in Stop Endpoint:
 * Cancels the current speaking turn and stops active TTS.
 */
router.post('/conversations/:conversationId/voice/interrupt', (req: Request, res: Response) => {
  const { conversationId } = req.params;
  const interruptingTurnId = req.body.turnId ? Number(req.body.turnId) : undefined;

  const result = voiceTurnManager.interruptVoiceTurn(conversationId, interruptingTurnId);
  return res.status(200).json({
    ok: true,
    interrupted: result.interrupted,
    previousTurnId: result.previousTurnId,
    latencyMs: result.latencyMs,
    engine: 'jarvis-v2'
  });
});

/**
 * GET /api/jarvis-v2/conversations/:conversationId/voice/telemetry
 * Returns recorded telemetry for the conversation.
 */
router.get('/conversations/:conversationId/voice/telemetry', (req: Request, res: Response) => {
  const { conversationId } = req.params;
  const records = listVoiceTelemetry(conversationId);
  return res.status(200).json({ conversationId, records });
});

/**
 * GET /api/jarvis-v2/conversations/:conversationId/state
 * Inspects authoritative persisted V2 state for a conversation.
 */
router.get('/conversations/:conversationId/state', (req: Request, res: Response) => {
  const { conversationId } = req.params;
  const state = loadState(conversationId);
  return res.status(200).json(state);
});

export default router;
