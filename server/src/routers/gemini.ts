import { logger } from '../utils/logger.js';
import { Router } from 'express';
import { geminiInteractionsService } from '../services/geminiInteractionsService.js';
import { llmChat } from '../services/llmGateway.js';

const router = Router();

/* ─── POST /api/gemini/chat ─── */
router.post('/chat', async (req, res) => {
  const { model, prompt } = req.body;
  if (!model || !prompt) {
    res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Missing model or prompt' } });
    return;
  }

  // Try the Google Generative Language API directly first
  const apiKey = process.env.GOOGLE_API_KEY;
  if (apiKey) {
    try {
      const response = await fetch('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: model,
          messages: [{ role: 'user', content: prompt }]
        }),
        signal: AbortSignal.timeout(30_000),
      });

      if (response.ok) {
        const data: any = await response.json();
        const reply = data.choices?.[0]?.message?.content || '';
        if (reply) {
          res.json({ reply });
          return;
        }
      }
      // Non-ok or empty reply — fall through to shared gateway
      logger.warn(`[Gemini API] Direct Google call failed or returned empty (HTTP ${response.status}). Falling through to OmniRoute.`);
    } catch (err: any) {
      logger.warn(`[Gemini API] Direct Google call error: ${err.message}. Falling through to OmniRoute.`);
    }
  }

  // Fallback: use the shared OmniRoute → Ollama → offline chain
  const result = await llmChat({ prompt, maxTokens: 2048 });
  res.json({
    reply: result.reply,
    ...(result.offline ? { offline: true, error: result.error } : {}),
  });
});

/* ─── POST /api/gemini/research ─── */
router.post('/research', async (req, res) => {
  const { background } = req.body;
  try {
    const result = await geminiInteractionsService.startWeldersResearch(!!background);
    res.json(result);
  } catch (err: any) {
    logger.error('[Gemini API] Research Error:', err);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

/* ─── GET /api/gemini/research/status/:jobId ─── */
router.get('/research/status/:jobId', (req, res) => {
  const job = geminiInteractionsService.getJob(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Job not found' } });
    return;
  }
  res.json(job);
});

/* ─── POST /api/gemini/email ─── */
router.post('/email', async (req, res) => {
  const { interactivePrompt } = req.body;
  try {
    const result = await geminiInteractionsService.generateEmailTemplates(interactivePrompt);
    res.json(result);
  } catch (err: any) {
    logger.error('[Gemini API] Email Error:', err);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

export default router;
