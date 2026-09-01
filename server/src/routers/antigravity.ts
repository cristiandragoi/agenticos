import { Router } from 'express';
import { antigravityProviderService } from '../services/antigravity/antigravityProviderService.js';
import { z } from 'zod';

const router = Router();

const UpdateConfigSchema = z.object({
  maxTotalTokens: z.number().int().min(256).max(128000).optional(),
  maxEstimatedCostUsd: z.number().min(0.01).max(20.0).optional(),
  timeoutMs: z.number().int().min(5000).max(300000).optional(),
  autoRetries: z.number().int().min(0).max(5).optional(),
  defaultModel: z.string().min(1).max(100).optional(),
  enabled: z.boolean().optional(),
});

const PutCredentialSchema = z.object({
  apiKey: z.string().min(1).max(2048),
});

const RunProbeSchema = z.object({
  prompt: z.string().min(1).max(10000),
  systemPrompt: z.string().max(2000).optional(),
  model: z.string().max(100).optional(),
  files: z.array(z.object({ path: z.string(), content: z.string() })).optional(),
  approvedForExternalTransmission: z.boolean().optional(),
});

/* ─── GET /api/antigravity/status (Truthful health, limits, configured status) ─── */
router.get('/status', async (_req, res) => {
  try {
    const status = await antigravityProviderService.getStatus();
    res.json(status);
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch Antigravity status', message: err?.message });
  }
});

/* ─── POST /api/antigravity/test (Live connection test) ─── */
router.post('/test', async (_req, res) => {
  try {
    const testResult = await antigravityProviderService.testConnection();
    res.json(testResult);
  } catch (err: any) {
    res.status(500).json({ reachable: false, latencyMs: 0, errorMessage: err?.message || 'Connection test failed' });
  }
});

/* ─── GET & PUT /api/antigravity/config (Limits: tokens, cost, timeout, retries) ─── */
router.get('/config', (_req, res) => {
  try {
    const config = antigravityProviderService.getConfig();
    res.json(config);
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch Antigravity config' });
  }
});

router.put('/config', (req, res) => {
  try {
    const patch = UpdateConfigSchema.parse(req.body);
    const updated = antigravityProviderService.updateConfig(patch);
    res.json(updated);
  } catch (err: any) {
    res.status(400).json({ error: 'Invalid config payload', details: err?.message });
  }
});

/* ─── PUT & DELETE /api/antigravity/credentials ─── */
router.put('/credentials', async (req, res) => {
  try {
    const { apiKey } = PutCredentialSchema.parse(req.body);
    await antigravityProviderService.saveApiKey(apiKey);
    const status = await antigravityProviderService.getStatus(true);
    res.json(status);
  } catch (err: any) {
    res.status(400).json({ error: 'Failed to save credential', message: err?.message });
  }
});

router.delete('/credentials', async (_req, res) => {
  try {
    await antigravityProviderService.deleteApiKey();
    const status = await antigravityProviderService.getStatus(true);
    res.json(status);
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to delete credential', message: err?.message });
  }
});

/* ─── POST /api/antigravity/run (Experimental Read-Only Run) ─── */
router.post('/run', async (req, res) => {
  try {
    const payload = RunProbeSchema.parse(req.body);
    const result = await antigravityProviderService.executeReadOnlyRun(payload);
    res.json(result);
  } catch (err: any) {
    if (err?.message?.includes('SAFETY_BLOCK')) {
      return res.status(403).json({ error: 'SAFETY_BLOCK', message: err.message });
    }
    res.status(400).json({ error: 'Execution failed', message: err?.message });
  }
});

export default router;
