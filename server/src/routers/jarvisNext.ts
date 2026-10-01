import { Router, Request, Response } from 'express';
import { generateClientToken } from '../domains/jarvisNext/tokenService.js';
import { healthSnapshot, resetHealthCounters } from '../domains/jarvisNext/jarvisHealth.js';
import { jarvisNextAgent } from '../domains/jarvisNext/jarvisNextAgent.js';
import { speechArbiter, SpeechPriority } from '../domains/jarvisNext/speechArbiter.js';
import { logger } from '../utils/logger.js';

const router = Router();

// Endpoint for Electron/React client to acquire LiveKit token
router.post('/token', async (req: Request, res: Response) => {
  try {
    const { roomName, identity, name } = req.body || {};
    const targetRoom = roomName || 'jarvis-next-main';

    // Ensure Jarvis server agent is fully connected and ready before returning client token
    await jarvisNextAgent.waitForReady(targetRoom, 15000);

    const tokenInfo = await generateClientToken({ roomName: targetRoom, identity, name });
    res.json(tokenInfo);
  } catch (error: any) {
    logger.error('[JarvisNextRouter] Error preparing agent / token:', error);
    res.status(500).json({ error: error.message || 'Failed to generate token' });
  }
});

// Operational counters Hermes 1 watches (generic re-asks, clarifications,
// correction resolution, orphan ACKs, withheld success claims). Runtime data,
// not inference: these are the numbers that open a regression automatically.
router.get('/metrics', (_req: Request, res: Response) => {
  try {
    res.json({ success: true, data: healthSnapshot() });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/metrics/reset', (_req: Request, res: Response) => {
  resetHealthCounters();
  res.json({ success: true, data: healthSnapshot() });
});

// Latency & Benchmark stats with 8-stage instrumentation and dual p50/p95
router.get('/latency-stats', async (_req: Request, res: Response) => {
  try {
    const { voiceLatencyTracker } = await import('../domains/jarvisNext/jarvisNextAgent.js');
    res.json({ success: true, ...voiceLatencyTracker.getStats() });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// VoiceStudio status & health check endpoint
router.get('/voicestudio/status', async (_req: Request, res: Response) => {
  try {
    const { voiceStudioService } = await import('../services/voice/VoiceStudioService.js');
    const status = await voiceStudioService.checkHealth(true);
    res.json({ success: true, status });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Authoritative Voice Runtime State snapshot
router.get('/runtime-state', async (_req: Request, res: Response) => {
  try {
    const { voiceRuntimeState } = await import('../services/voice/VoiceRuntimeState.js');
    const snapshot = await voiceRuntimeState.getSnapshot();
    res.json({ success: true, runtimeState: snapshot });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Query & update active voice configuration
router.get('/agent/voice', (_req: Request, res: Response) => {
  try {
    res.json({
      success: true,
      voiceConfig: jarvisNextAgent.getVoiceConfig(),
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/agent/voice', (req: Request, res: Response) => {
  try {
    const b = req.body || {};
    const voiceId = b.voiceId || b.voice || b.voice_id;
    const voiceProfile = b.voiceProfile || b.style || b.profile || b.voice_profile;
    const rate = b.rate;
    const pitch = b.pitch;
    jarvisNextAgent.setVoiceConfig({ voiceId, voiceProfile, rate, pitch });
    res.json({
      success: true,
      voiceConfig: jarvisNextAgent.getVoiceConfig(),
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Explicit control endpoints
router.post('/agent/start', async (req: Request, res: Response) => {
  try {
    const { roomName } = req.body || {};
    await jarvisNextAgent.start(roomName);
    res.json({ success: true, status: jarvisNextAgent.getStatus() });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/agent/stop', async (_req: Request, res: Response) => {
  try {
    await jarvisNextAgent.stop();
    res.json({ success: true, status: jarvisNextAgent.getStatus() });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/agent/interrupt', (_req: Request, res: Response) => {
  try {
    jarvisNextAgent.interrupt();
    res.json({ success: true, status: jarvisNextAgent.getStatus() });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/agent/suspend', (_req: Request, res: Response) => {
  try {
    jarvisNextAgent.suspend('api_suspend');
    res.json({ success: true, status: jarvisNextAgent.getStatus() });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/agent/resume', (_req: Request, res: Response) => {
  try {
    jarvisNextAgent.resume('api_resume');
    res.json({ success: true, status: jarvisNextAgent.getStatus() });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/agent/turn', async (req: Request, res: Response) => {
  try {
    const { text, confidence } = req.body || {};
    if (!text) {
      return res.status(400).json({ error: 'Missing text' });
    }
    await jarvisNextAgent.handleUserText(text, undefined, confidence);
    res.json({ success: true, status: jarvisNextAgent.getStatus() });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/agent/speak', async (req: Request, res: Response) => {
  try {
    const { text, priority: rawPriority, source, turnId } = req.body;
    if (!text) {
      return res.status(400).json({ error: 'Missing text to speak' });
    }
    // Default to P4 (background task completion) unless caller specifies a higher priority.
    // P0 and P1 must NEVER be injected via HTTP — they are internal-only.
    const clampedPriority = Math.max(
      SpeechPriority.P2_PROGRESS,
      Math.min(SpeechPriority.P5_STATUS, rawPriority ?? SpeechPriority.P4_BACKGROUND),
    );
    const accepted = await speechArbiter.request({
      text,
      priority: clampedPriority,
      source: source || 'api_speak_endpoint',
      turnId: typeof turnId === 'number' ? turnId : undefined,
    });
    res.json({
      success: true,
      accepted,
      message: accepted ? 'Speech accepted by arbiter' : 'Speech dropped by arbiter (foreground active or stale)',
    });
  } catch (error: any) {
    logger.error('[JarvisNextRouter] Speak error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Arbiter diagnostic snapshot (useful for monitoring and health checks)
router.get('/arbiter/status', (_req: Request, res: Response) => {
  res.json({ success: true, data: speechArbiter.snapshot() });
});


// Operator Execution & Mission Endpoints
router.post('/operate', async (req: Request, res: Response) => {
  try {
    const { text } = req.body;
    if (!text) {
      return res.status(400).json({ error: 'Missing user text' });
    }
    const { operatorController } = await import('../domains/jarvisNext/operator/operatorController.js');
    const result = await operatorController.handleIntent(text);
    res.json({ success: true, result });
  } catch (error: any) {
    logger.error('[JarvisNextRouter] Operator error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/mission', async (_req: Request, res: Response) => {
  try {
    const { missionPlanner } = await import('../domains/jarvisNext/operator/missionPlanner.js');
    const { buildGroundedStatus } = await import('../domains/jarvisNext/operator/statusReporter.js');
    const mission = missionPlanner.getActiveMission();
    const status = buildGroundedStatus(mission);
    res.json({ success: true, mission, status });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
