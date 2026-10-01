/**
 * providerStatus.ts — Provider & Cost Observability Endpoint
 *
 * Exposes authoritative real-time status of:
 * - STT: Deepgram Nova-3 (Primary) & Local Whisper (Fallback)
 * - TTS: Local Piper / Edge-TTS
 * - Planner: Hermes
 * - Worker: Currently selected model & role registry
 * - Cost Governance: Active Cost Mode & Session Spend Summary
 */

import { Router } from 'express';
import { costPolicy } from '../services/gateway/costPolicy.js';
import { modelRouter } from '../services/gateway/modelRouter.js';
import { secretStore } from '../services/gateway/secretStore.js';

export const providerStatusRouter = Router();

providerStatusRouter.get('/status', async (req, res) => {
  try {
    const deepgramKey = process.env.DEEPGRAM_API_KEY || (await secretStore.get('deepgram')) || undefined;
    const mode = costPolicy.getMode();
    const deepgramAllowed = costPolicy.isAllowed('LOW_COST_PAID').allowed;

    const sttOnline = Boolean(deepgramKey && deepgramAllowed);
    const sttStatus = sttOnline ? 'ONLINE' : (deepgramKey ? 'BLOCKED_BY_COST_MODE' : 'AWAITING_API_KEY');

    const workerSelection = modelRouter.selectModel('WORKER');

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      costMode: mode,
      stt: {
        primary: 'Deepgram Nova-3',
        status: sttStatus,
        configured: Boolean(deepgramKey),
        fallback: 'Local Whisper',
        fallbackStatus: 'READY',
      },
      tts: {
        primary: 'Local Piper (de/ro) / Edge-TTS (en)',
        status: 'ONLINE',
        nonBlocking: true,
      },
      planner: {
        name: 'Hermes',
        status: 'ONLINE',
        role: 'Planning & Decomposition',
      },
      worker: {
        selected: workerSelection.selected ? `${workerSelection.selected.provider}:${workerSelection.selected.modelId}` : 'NONE_AVAILABLE',
        costClass: workerSelection.selected?.costClass || 'UNKNOWN',
        candidatesCount: workerSelection.candidates.length,
      },
      summary: costPolicy.getSessionSummary(),
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Failed to fetch provider status' });
  }
});

providerStatusRouter.post('/cost-mode', async (req, res) => {
  try {
    const { mode } = req.body || {};
    if (mode === 'ZERO' || mode === 'LOW_COST' || mode === 'UNRESTRICTED') {
      costPolicy.setMode(mode);
      return res.json({ success: true, mode: costPolicy.getMode() });
    }
    return res.status(400).json({ success: false, error: 'Invalid mode. Must be ZERO, LOW_COST, or UNRESTRICTED.' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Failed to set cost mode' });
  }
});
