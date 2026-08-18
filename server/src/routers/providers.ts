import { Router } from 'express';
import { db } from '../services/db.js';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { secretStore } from '../services/gateway/secretStore.js';
import { ProviderCredentialService } from '../services/gateway/credentials.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.resolve(__dirname, '..', '.env');

const router = Router();

/* ─── Provider → Env Var Map ─── */
const ENV_VAR_MAP: Record<string, string> = {
  'prov-openai': 'OPENAI_API_KEY',
  'prov-openrouter': 'OPENROUTER_API_KEY',
  'prov-anthropic': 'ANTHROPIC_API_KEY',
  'prov-deepseek': 'DEEPSEEK_API_KEY',
  'prov-longcat': 'OPENROUTER_API_KEY',
  'prov-minimax': 'MINIMAX_API_KEY',
  'prov-kimi': 'KIMI_API_KEY',
  'prov-qwen': 'QWEN_API_KEY',
  'prov-xai': 'XAI_API_KEY',
  'prov-mistral': 'MISTRAL_API_KEY',
  'prov-gemini': 'GOOGLE_API_KEY',
  'prov-perplexity': 'PERPLEXITY_API_KEY',
  'prov-fugu': 'SAKANA_API_KEY',
  'prov-apify': 'APIFY_API_KEY',
  'prov-storage': 'STORAGE_API_KEY',
  'prov-automation': 'N8N_API_KEY',
  'prov-ollama': '', // local, no key needed
  'prov-ornith': '', // local, no key needed
  'prov-mcp-filesystem': '',
  'prov-browser-tool': '',
  'prov-internal-api': 'INTERNAL_OAUTH_TOKEN',
};

/* ─── LIST all providers ─── */
router.get('/', async (_req, res) => {
  const providers = db.providers.list();
  const enriched = await Promise.all(
    providers.map(async (p) => {
      const hasKey = await providerHasKey(p.id);
      return {
        ...p,
        hasKey,
      };
    })
  );
  res.json(enriched);
});

/* ─── LIST models for a provider (dynamic discovery) ─── */
router.get('/:id/models', async (req, res) => {
  const provider = db.providers.get(req.params.id);
  if (!provider) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Provider not found' } });
    return;
  }
  
  if (provider.id === 'prov-ollama') {
    const ollamaBase = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
    try {
      const resp = await fetch(`${ollamaBase}/api/tags`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!resp.ok) {
        res.status(200).json({ reachable: false, models: [], error: `Ollama returned HTTP ${resp.status}` });
        return;
      }
      const data: any = await resp.json();
      const models = (data.models || []).map((m: any) => ({
        id: m.name || m.model,
        name: m.name || m.model,
        size: m.size,
        modifiedAt: m.modified_at,
        contextLength: m.details?.context_length,
        quantization: m.details?.quantization_level,
        family: m.details?.family,
      }));
      res.json({ reachable: true, models });
    } catch (err: any) {
      res.json({ reachable: false, models: [], error: err.message });
    }
  } else {
    // Return statically configured models for this provider
    res.json({ reachable: true, models: provider.models || [] });
  }
});


/* ─── GET /runtime-status (Unified Health) ─── */
router.get('/runtime-status', async (_req, res) => {
  try {
    const { llmProbe } = await import('../services/llmGateway.js');
    const [omniProbe, ollamaResp] = await Promise.all([
      llmProbe(),
      fetch(`${process.env.OLLAMA_BASE_URL || 'http://localhost:11434'}/api/tags`, { signal: AbortSignal.timeout(5000) }).catch(() => null)
    ]);
    
    let ollamaReachable = false;
    let ollamaModels: any[] = [];
    if (ollamaResp && ollamaResp.ok) {
      ollamaReachable = true;
      const data: any = await ollamaResp.json();
      ollamaModels = (data.models || []).map((m: any) => ({
        id: m.name || m.model,
        displayName: m.name || m.model,
      }));
    }

    res.json({
      omniRoute: omniProbe,
      ollama: { reachable: ollamaReachable, models: ollamaModels }
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/* ─── GET key status for a provider ─── */
router.get('/:id/key', async (req, res) => {
  const provider = db.providers.get(req.params.id);
  if (!provider) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Provider not found' } });
    return;
  }
  const envVar = ENV_VAR_MAP[provider.id];
  const secret = await secretStore.get(provider.id) || (envVar ? await secretStore.get(envVar) : null);
  const hasKey = Boolean(secret && secret.length > 0);
  const rawVal = secret || '';
  const lastFour = rawVal.length >= 4 ? rawVal.slice(-4) : rawVal;
  res.json({
    providerId: provider.id,
    hasKey,
    envVar: envVar || null,
    maskedKey: hasKey ? `•••• •••• •••• ${lastFour}` : null,
    isLocal: provider.authScheme === 'none',
  });
});

/* ─── SAVE key for a provider (writes to secure secretStore) ─── */
router.put('/:id/key', async (req, res) => {
  const provider = db.providers.get(req.params.id);
  if (!provider) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Provider not found' } });
    return;
  }
  const envVar = ENV_VAR_MAP[provider.id];
  const { keyValue } = req.body;
  if (!keyValue || typeof keyValue !== 'string' || keyValue.trim().length === 0) {
    res.status(400).json({ error: { code: 'INVALID_KEY', message: 'keyValue is required and must be a non-empty string' } });
    return;
  }

  const trimmed = keyValue.trim();

  try {
    // 1. Store in Canonical SecretStore & ProviderCredentialService
    await secretStore.set(provider.id, trimmed);
    if (envVar) await secretStore.set(envVar, trimmed);
    await ProviderCredentialService.saveCredential(provider.id, trimmed);

    // 2. Set in current process.env for immediate in-process propagation
    if (envVar) process.env[envVar] = trimmed;

    // 3. Update provider status
    provider.status = 'connected';
    provider.errorMessage = undefined;
    provider.lastActivity = 'just now';
    db.providers.upsert(provider);

    const lastFour = trimmed.length >= 4 ? trimmed.slice(-4) : trimmed;
    res.json({
      success: true,
      providerId: provider.id,
      envVar,
      maskedKey: `•••• •••• •••• ${lastFour}`,
      message: `API key saved securely for ${provider.name}`,
    });
  } catch (err: any) {
    res.status(500).json({ error: { code: 'WRITE_FAILED', message: `Failed to save credential: ${err.message}` } });
  }
});

/* ─── DELETE key for a provider ─── */
router.delete('/:id/key', async (req, res) => {
  const provider = db.providers.get(req.params.id);
  if (!provider) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Provider not found' } });
    return;
  }
  const envVar = ENV_VAR_MAP[provider.id];

  try {
    await secretStore.delete(provider.id);
    if (envVar) {
      await secretStore.delete(envVar);
      delete process.env[envVar];
    }
    await ProviderCredentialService.deleteCredential(provider.id);

    // Update provider status
    provider.status = 'needs-auth';
    provider.errorMessage = 'API key not configured';
    provider.lastActivity = 'just now';
    db.providers.upsert(provider);

    res.json({
      success: true,
      providerId: provider.id,
      message: `API key removed for ${provider.name}`,
    });
  } catch (err: any) {
    res.status(500).json({ error: { code: 'WRITE_FAILED', message: `Failed to delete secret: ${err.message}` } });
  }
});

/* ─── GET single provider ─── */
router.get('/:id', async (req, res) => {
  const provider = db.providers.get(req.params.id);
  if (!provider) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Provider not found' } });
    return;
  }
  const hasKey = await providerHasKey(provider.id);
  res.json({ ...provider, hasKey });
});

/* ─── REFRESH provider status ─── */
router.post('/:id/refresh', async (req, res) => {
  const provider = db.providers.get(req.params.id);
  if (!provider) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Provider not found' } });
    return;
  }

  // Refresh logic — if key exists, attempt a connection test
  const hasKey = await providerHasKey(provider.id);
  if (hasKey) {
    provider.status = 'connected';
    provider.errorMessage = undefined;
  } else if (provider.authScheme !== 'none') {
    provider.status = 'needs-auth';
    provider.errorMessage = 'API key not configured';
  }
  provider.lastActivity = 'just now';
  db.providers.upsert(provider);

  res.json({ message: 'Auth refreshed successfully', provider: { ...provider, hasKey } });
});

/* ─── TEST provider connectivity (ping) ─── */
router.post('/:id/test', async (req, res) => {
  const provider = db.providers.get(req.params.id);
  if (!provider) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Provider not found' } });
    return;
  }

  const hasKey = providerHasKey(provider.id);
  let reachable = false;
  let latencyMs = 0;
  let errorMessage: string | undefined;

  if (provider.authScheme !== 'none' && !hasKey) {
    errorMessage = 'No API key configured — cannot test';
  } else {
    try {
      const start = Date.now();
      reachable = await pingProvider(provider);
      latencyMs = Date.now() - start;
    } catch (err: any) {
      errorMessage = err.message || 'Connection test failed';
    }
  }

  if (reachable) {
    provider.status = 'connected';
    provider.errorMessage = undefined;
  } else if (errorMessage) {
    provider.status = 'error';
    provider.errorMessage = errorMessage;
  }
  provider.lastActivity = 'just now';
  db.providers.upsert(provider);

  res.json({
    providerId: provider.id,
    providerName: provider.name,
    reachable,
    latencyMs,
    status: provider.status,
    errorMessage,
    hasKey,
  });
});

/* ─── UPDATE provider (model defaults, etc.) ─── */
router.put('/:id', (req, res) => {
  const existing = db.providers.get(req.params.id);
  if (!existing) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Provider not found' } });
    return;
  }

  const updates = req.body;
  // Only allow updating safe fields
  const safeFields = ['defaultModel', 'status', 'errorMessage', 'usedByAgentDefaults'];
  for (const field of safeFields) {
    if (updates[field] !== undefined) {
      (existing as any)[field] = updates[field];
    }
  }
  existing.lastActivity = 'just now';
  db.providers.upsert(existing);

  res.json({ ...existing, hasKey: providerHasKey(existing.id) });
});

/* ─── AGENT MODEL DEFAULTS ─── */
// GET per-agent model routing
router.get('/agent-defaults/:agentId', (req, res) => {
  const agent = db.agents.get(req.params.agentId);
  if (!agent) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Agent not found' } });
    return;
  }

  const providers = db.providers.list();
  const agentProviders = (agent.providerIds || [])
    .map((pid: string) => providers.find((p: any) => p.id === pid))
    .filter(Boolean);

  const modelDefaults = {
    agentId: agent.id,
    agentName: agent.name,
    providerIds: agent.providerIds || [],
    providers: agentProviders.map((p: any) => ({
      id: p.id,
      name: p.name,
      category: p.category,
      status: p.status,
      defaultModel: p.defaultModel,
      models: p.models || [],
      hasKey: providerHasKey(p.id),
      authScheme: p.authScheme,
    })),
  };

  res.json(modelDefaults);
});

// PUT update agent provider assignment
router.put('/agent-defaults/:agentId', (req, res) => {
  const agent = db.agents.get(req.params.agentId);
  if (!agent) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Agent not found' } });
    return;
  }

  const { providerIds } = req.body;
  if (!Array.isArray(providerIds)) {
    res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'providerIds must be an array' } });
    return;
  }

  agent.providerIds = providerIds;
  agent.updatedAt = new Date().toISOString();
  db.agents.upsert(agent);

  const providers = db.providers.list();
  const agentProviders = providerIds
    .map((pid: string) => providers.find((p: any) => p.id === pid))
    .filter(Boolean);

  res.json({
    agentId: agent.id,
    agentName: agent.name,
    providerIds: agent.providerIds,
    providers: agentProviders.map((p: any) => ({
      id: p.id,
      name: p.name,
      category: p.category,
      status: p.status,
      defaultModel: p.defaultModel,
      hasKey: providerHasKey(p.id),
    })),
  });
});

/* ─── Helpers ─── */

async function providerHasKey(providerId: string): Promise<boolean> {
  const hasInStore = await secretStore.has(providerId);
  if (hasInStore) return true;
  const envVar = ENV_VAR_MAP[providerId];
  if (!envVar) return false;
  return await secretStore.has(envVar);
}

async function pingProvider(provider: any): Promise<boolean> {
  const baseUrls: Record<string, string> = {
    'prov-openai': 'https://api.openai.com/v1/models',
    'prov-openrouter': 'https://openrouter.ai/api/v1/models',
    'prov-anthropic': 'https://api.anthropic.com/v1/messages',
    'prov-deepseek': 'https://api.deepseek.com/v1/models',
    'prov-longcat': 'https://openrouter.ai/api/v1/models',
    'prov-minimax': 'https://api.minimax.chat/v1/models',
    'prov-kimi': 'https://api.moonshot.cn/v1/models',
    'prov-qwen': 'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation',
    'prov-xai': 'https://api.x.ai/v1/models',
    'prov-mistral': 'https://api.mistral.ai/v1/models',
    'prov-gemini': 'https://generativelanguage.googleapis.com/v1/models',
    'prov-perplexity': 'https://api.perplexity.ai/v1/models',
    'prov-apify': 'https://api.apify.com/v2/acts',
    'prov-ollama': (process.env.OLLAMA_BASE_URL || 'http://localhost:11434') + '/api/tags',
    'prov-ornith': (process.env.OLLAMA_BASE_URL || 'http://localhost:11434') + '/api/tags',
  };

  const url = baseUrls[provider.id];
  if (!url) return true; // infra providers auto-pass

  const envVarMap: Record<string, string> = { ...ENV_VAR_MAP };

  const apiKey = (await secretStore.get(provider.id)) || (envVarMap[provider.id] ? await secretStore.get(envVarMap[provider.id]) : '') || '';
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  if (apiKey) {
    if (provider.id === 'prov-gemini') {
      // Gemini uses query param
    } else {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }
  }

  // For Gemini, key is in URL
  const testUrl = provider.id === 'prov-gemini' && apiKey
    ? `${url}?key=${apiKey}`
    : url;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const res = await fetch(testUrl, { headers, signal: controller.signal });
    return res.ok || res.status === 401 || res.status === 403; // key recognized even if no access
  } catch {
    return (provider.id === 'prov-ollama' || provider.id === 'prov-ornith') ? false : true; // Ollama unreachable = fail, others might be network
  } finally {
    clearTimeout(timeout);
  }
}

export default router;
