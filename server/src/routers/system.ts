/**
 * System router — machine-level diagnostics.
 *
 * GET /api/system/hardware-profile?refresh=1
 *   Normalized HardwareProfile (see services/system/hardwareProfiler.ts).
 *   Cached for HARDWARE_PROFILE_CACHE_TTL_MS (default 60s) so expensive
 *   exec probes never run on every UI poll; ?refresh=1 forces re-detection.
 *   Never returns environment variables or secrets.
 */
import { Router } from 'express';
import { getHardwareProfile } from '../services/system/hardwareProfiler.js';
import { llmChat } from '../services/llmGateway.js';

const router = Router();

router.get('/hardware-profile', async (req, res) => {
  try {
    const refresh = req.query.refresh === '1' || req.query.refresh === 'true';
    const profile = await getHardwareProfile(refresh);
    res.json(profile);
  } catch (err: any) {
    // Honest error, no crash of the poll loop, no secret leakage.
    res.status(500).json({ error: err?.message || 'hardware profile unavailable' });
  }
});

router.get('/debug-paths', (req, res) => {
  res.json({
    cwd: process.cwd(),
    dirname: __dirname,
    execPath: process.execPath
  });
});

const ALLOWED_SHOOTOUT_MODELS = [
  'poolside/laguna-s-2.1:free',
  'meituan/longcat-2.0',
  'qwen/qwen3.8-max'
];

router.post('/shootout-test', async (req, res) => {
  // Gate: Enabled ONLY via explicit server-side environment flag or dev mode
  const isDevOrDiagnostic =
    process.env.AGENTICOS_ENABLE_SHOOTOUT === 'true' ||
    process.env.NODE_ENV === 'development';

  if (!isDevOrDiagnostic) {
    res.status(403).json({ error: 'Endpoint restricted to development/diagnostic mode.' });
    return;
  }

  const { modelId, prompt } = req.body;

  // Input validation
  if (!modelId || typeof modelId !== 'string' || !ALLOWED_SHOOTOUT_MODELS.includes(modelId)) {
    res.status(400).json({ error: `Invalid modelId. Allowed candidates: ${ALLOWED_SHOOTOUT_MODELS.join(', ')}` });
    return;
  }

  if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0 || prompt.length > 2000) {
    res.status(400).json({ error: 'Invalid prompt. Must be a non-empty string <= 2000 characters.' });
    return;
  }

  const systemPrompt = `You are CodeX, a Restricted Process Runner. Achieve the user's goal autonomously.
CRITICAL: You MUST respond with exactly one valid JSON tool call object and NOTHING ELSE.
Do not use XML tags.
Do not use markdown code fences.
Do not include conversational preamble or explanations before or after the JSON.

Tools:
1. writeFile: { "type": "tool_call", "tool": "writeFile", "arguments": { "path": "relative/path/to/file", "content": "file contents" } }
2. readFile: { "type": "tool_call", "tool": "readFile", "arguments": { "path": "relative/path/to/file" } }
3. runCommand: { "type": "tool_call", "tool": "runCommand", "arguments": { "cmd": "npm", "args": ["install", "express"] } }
4. reasoningQuery: { "type": "tool_call", "tool": "reasoningQuery", "arguments": { "prompt": "ask OmniRoute for validation" } }
5. finish: { "type": "tool_call", "tool": "finish", "arguments": { "message": "Goal completed." } }
`;

  const start = Date.now();
  try {
    const result = await llmChat({
      systemPrompt,
      prompt,
      provider: 'openrouter',
      model: modelId
    });

    res.json({
      modelId,
      latencyMs: Date.now() - start,
      reply: result.reply,
      provider: result.provider,
      error: result.error
    });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : String(err)
    });
  }
});

router.post('/restart', (req, res) => {
  res.json({ status: 'restarting' });

  setTimeout(() => {
    process.exit(0);
  }, 100);
});

export default router;
