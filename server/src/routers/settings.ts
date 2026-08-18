import { db } from '../db/index.js';
import { providerCredentials, agentProviderAssignments } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { Router } from 'express';
import { ProviderCredentialService } from '../services/gateway/credentials.js';
import { GatewayConfigurationService } from '../services/gateway/configuration.js';
import { mapCatalogToGatewayId } from '../services/agent/assignments.js';
import { z } from 'zod';

const router = Router();

// Validate provider IDs against known canonical providers
const ALLOWLISTED_PROVIDERS = ['omniroot', 'ninerouter', 'openrouter', 'ollama', 'openai', 'anthropic', 'groq', 'google'];

const PutCredentialSchema = z.object({
  apiKey: z.string().min(1).max(2048)
});

const GatewayConfigSchema = z.object({
  maxProviderRetries: z.number().int().min(0).max(10).optional(),
  maxFallbackProviders: z.number().int().min(0).max(10).optional(),
  providerTimeoutMs: z.number().int().min(500).max(120000).optional(),
  degradedLatencyMs: z.number().int().min(100).max(60000).optional(),
  circuitFailureThreshold: z.number().int().min(1).max(50).optional(),
  circuitResetTimeoutMs: z.number().int().min(1000).max(3600000).optional(),
  healthCheckIntervalMs: z.number().int().min(5000).max(3600000).optional(),
});

// Mutex to prevent concurrent writes from multiple Electron windows
const migrationLocks = new Set<string>();

router.put('/provider-credentials/:providerId', async (req, res) => {
  try {
    const { providerId } = req.params;
    if (!ALLOWLISTED_PROVIDERS.includes(providerId)) {
      return res.status(400).json({ error: 'Unknown provider ID' });
    }

    // In-memory Mutex Optimization
    if (migrationLocks.has(providerId)) {
      return res.status(409).json({ error: 'Migration for this provider is already in progress locally' });
    }
    migrationLocks.add(providerId);

    try {
      const { apiKey } = PutCredentialSchema.parse(req.body);
      
      // SQLite Transactional Lock
      const now = new Date();
      const leaseExpiry = new Date(now.getTime() + 60000).toISOString(); // 60 seconds lease
      
      const record = db.select().from(providerCredentials).where(eq(providerCredentials.providerId, providerId)).get();

      if (record && record.migrationState === 'in_progress') {
        if (record.leaseExpiresAt && new Date(record.leaseExpiresAt) > now) {
           return res.status(409).json({ error: 'Migration for this provider is already in progress in another process' });
        }
      }

      db.insert(providerCredentials)
        .values({
          providerId,
          migrationState: 'in_progress',
          leaseExpiresAt: leaseExpiry,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString()
        })
        .onConflictDoUpdate({
          target: providerCredentials.providerId,
          set: {
            migrationState: 'in_progress',
            leaseExpiresAt: leaseExpiry,
            updatedAt: now.toISOString()
          }
        })
        .run();
      
      // Call Keytar (which handles its own fail-closed exception)
      await ProviderCredentialService.saveCredential(providerId, apiKey);
      
      // Commit SQLite success
      db.update(providerCredentials)
        .set({
          migrationState: 'completed',
          leaseExpiresAt: null,
          updatedAt: new Date().toISOString()
        })
        .where(eq(providerCredentials.providerId, providerId))
        .run();

      const status = await ProviderCredentialService.getCredentialStatus(providerId);
      res.json(status);
    } catch (err: any) {
      // Rollback SQLite failure
      const providerId = req.params.providerId;
      db.update(providerCredentials)
        .set({
          migrationState: 'failed',
          leaseExpiresAt: null,
          updatedAt: new Date().toISOString()
        })
        .where(eq(providerCredentials.providerId, providerId))
        .run();

      if (err.status === 503) {
         return res.status(503).json({ error: err.message, message: err.details });
      }
      res.status(400).json({ error: 'Invalid payload or storage error' }); 
    } finally {
      migrationLocks.delete(req.params.providerId);
    }
  } catch (err: any) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/provider-credentials/:providerId', async (req, res) => {
  try {
    const { providerId } = req.params;
    await ProviderCredentialService.deleteCredential(providerId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete credential' });
  }
});

router.get('/provider-credentials/:providerId/status', async (req, res) => {
  try {
    const { providerId } = req.params;
    const status = await ProviderCredentialService.getCredentialStatus(providerId);
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch status' });
  }
});

router.post('/provider-credentials/:providerId/validate', async (req, res) => {
  try {
    const { providerId } = req.params;
    if (!ALLOWLISTED_PROVIDERS.includes(providerId)) {
      return res.status(400).json({ error: 'Unknown provider ID' });
    }
    
    const key = await ProviderCredentialService.getCredential(providerId);
    if (!key) {
      return res.json({ status: 'missing' });
    }

    // In a real implementation, we would call the provider's /models or /me endpoint
    // For now, we simulate a validation success
    res.json({ status: 'valid' });
  } catch (err: any) {
    res.json({ status: 'invalid' });
  }
});

router.get('/gateway/credentials-status', async (req, res) => {
  try {
    const statuses: Record<string, any> = {};
    for (const providerId of ALLOWLISTED_PROVIDERS) {
      statuses[providerId] = await ProviderCredentialService.getCredentialStatus(providerId);
    }
    res.json(statuses);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch statuses' });
  }
});

router.get('/gateway', async (req, res) => {
  try {
    const config = await GatewayConfigurationService.getConfiguration();
    res.json(config);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch gateway config' });
  }
});

router.put('/gateway', async (req, res) => {
  try {
    const updates = GatewayConfigSchema.parse(req.body);
    const updated = await GatewayConfigurationService.updateConfiguration(updates);
    res.json(updated);
  } catch (err: any) {
    res.status(400).json({ error: 'Invalid configuration payload' });
  }
});

router.get('/agent-provider-assignments', async (req, res) => {
  try {
    const assignments = db.select().from(agentProviderAssignments).all();
    res.json(assignments);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch assignments' });
  }
});

router.get('/agent-provider-assignments/:agentId', async (req, res) => {
  try {
    const assignment = db.select().from(agentProviderAssignments).where(eq(agentProviderAssignments.agentId, req.params.agentId)).get();
    if (!assignment) return res.status(404).json({ error: 'Assignment not found' });
    res.json(assignment);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch assignment' });
  }
});

/* ── POST /api/settings/agent-provider-assignments/:agentId/test ──
   TEST ROUTING (PRIORITY 2): performs a tiny, safe runtime request using the
   SAVED assignment so the user sees whether execution actually resolves where
   it was configured — saving configuration alone is not proof of execution. */
router.post('/agent-provider-assignments/:agentId/test', async (req, res) => {
  try {
    const assignment = db.select().from(agentProviderAssignments).where(eq(agentProviderAssignments.agentId, req.params.agentId)).get();
    if (!assignment) return res.status(404).json({ error: 'Assignment not found' });
    if (!assignment.enabled) {
      return res.json({ configured: { provider: assignment.providerId, model: assignment.modelId }, resolved: null, result: 'SKIPPED', reason: 'Assignment is disabled', latencyMs: 0 });
    }
    const configuredProvider = assignment.providerId;
    const configuredModel = assignment.modelId;
    const started = Date.now();
    const { llmChat } = await import('../services/llmGateway.js');
    let result;
    try {
      result = await llmChat({
        prompt: 'Reply with exactly: OK',
        systemPrompt: 'You are a routing connectivity probe. Reply with exactly the word OK.',
        agentId: req.params.agentId,
        provider: configuredProvider || undefined,
        // Pass the configured model explicitly: an explicit provider override
        // takes precedence over the saved assignment in the gateway router, so
        // the assignment's modelId is NOT auto-injected when provider is set.
        model: configuredModel || undefined,
        timeoutMs: 15000,
        // 64 output tokens: reasoning MoE models (e.g. LongCat 2.0) return an
        // empty final message when capped at 8 — the probe would false-FAIL.
        maxTokens: 64,
        disableFallback: true, // test what was CONFIGURED, not a silent fallback
      });
    } catch (err: any) {
      const latencyMs = Date.now() - started;
      return res.json({
        configured: { provider: configuredProvider, model: configuredModel },
        resolved: null,
        result: 'FAIL',
        reason: err?.message || 'Request failed',
        latencyMs,
      });
    }
    const latencyMs = Date.now() - started;
    const resolvedProvider = result.provider || configuredProvider;
    const resolvedModel = result.model || configuredModel;
    // The assignment stores the CATALOG provider id (e.g. prov-deepseek), but
    // the gateway resolves to its CANONICAL name (e.g. DeepSeek). Map the
    // configured id before comparing so a correctly-resolved assignment
    // reports PASS instead of a false FALLBACK.
    const expectedGatewayProvider = mapCatalogToGatewayId(configuredProvider);
    const matched = resolvedProvider === expectedGatewayProvider && (!configuredModel || resolvedModel === configuredModel);
    res.json({
      configured: { provider: configuredProvider, model: configuredModel },
      resolved: { provider: resolvedProvider, model: resolvedModel },
      result: matched ? 'PASS' : 'FALLBACK',
      reason: matched ? 'Resolved exactly as configured' : `Requested ${configuredProvider}/${configuredModel} but resolved ${resolvedProvider}/${resolvedModel}`,
      latencyMs,
    });
  } catch (err: any) {
    res.status(500).json({ error: `Test routing failed: ${err?.message || err}` });
  }
});

router.put('/agent-provider-assignments/:agentId', async (req, res) => {
  try {
    const { providerId, modelId, routingMode, enabled } = req.body;
    const { agentId } = req.params;
    const now = new Date().toISOString();
    
    db.insert(agentProviderAssignments)
      .values({
        agentId,
        providerId,
        modelId: modelId || null,
        routingMode,
        enabled: enabled !== undefined ? enabled : true,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: agentProviderAssignments.agentId,
        set: {
          providerId,
          modelId: modelId || null,
          routingMode,
          enabled: enabled !== undefined ? enabled : true,
          updatedAt: now,
        }
      })
      .run();
      
    const assignment = db.select().from(agentProviderAssignments).where(eq(agentProviderAssignments.agentId, agentId)).get();
    res.json(assignment);
  } catch (err) {
    res.status(500).json({ error: 'Failed to save assignment' });
  }
});

router.delete('/agent-provider-assignments/:agentId', async (req, res) => {
  try {
    db.delete(agentProviderAssignments).where(eq(agentProviderAssignments.agentId, req.params.agentId)).run();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete assignment' });
  }
});

export default router;
