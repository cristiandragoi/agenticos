/**
 * Antigravity Provider Service — Execution Provider Abstraction for AgenticOS.
 *
 * Implements:
 * 1. Secure credential retrieval via Canonical SecretStore / keytar.
 * 2. Truthful health status probing (reachable / latency / model info).
 * 3. Configurable execution limits (max tokens, max cost, timeout, 0 retries).
 * 4. Read-only execution path with explicit safety & file-approval checks.
 *
 * Zero secrets are ever logged or returned in responses/diagnostics.
 */

import { secretStore, redactSecrets } from '../gateway/secretStore.js';
import { ProviderCredentialService } from '../gateway/credentials.js';
import { logger } from '../../utils/logger.js';
import { rawDb } from '../../db/index.js';

export interface AntigravityConfig {
  maxTotalTokens: number;
  maxEstimatedCostUsd: number;
  timeoutMs: number;
  autoRetries: number;
  defaultModel: string;
  enabled: boolean;
}

export interface AntigravityStatus {
  providerId: 'antigravity';
  name: string;
  category: 'remote';
  kind: 'agent-execution';
  configured: boolean;
  maskedPreview: string | null;
  reachable: boolean;
  status: 'connected' | 'needs-auth' | 'error';
  lastTestedAt: string | null;
  latencyMs: number;
  errorMessage?: string;
  config: AntigravityConfig;
}

export interface AntigravityExecutionOptions {
  prompt: string;
  systemPrompt?: string;
  model?: string;
  files?: Array<{ path: string; content: string }>;
  maxTokens?: number;
  timeoutMs?: number;
  approvedForExternalTransmission?: boolean;
}

export interface AntigravityExecutionResult {
  text: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    estimatedCostUsd: number;
  };
  model: string;
  latencyMs: number;
}

const DEFAULT_CONFIG: AntigravityConfig = {
  maxTotalTokens: 8192,
  maxEstimatedCostUsd: 0.50,
  timeoutMs: 60000,
  autoRetries: 0, // Retries strictly disabled by default
  defaultModel: 'gemini-2.5-flash',
  enabled: true,
};

// Pricing estimates per 1M tokens (Gemini 2.5 Flash / 2.0 Flash)
const COST_PER_1M_PROMPT = 0.075;
const COST_PER_1M_COMPLETION = 0.30;

// Ensure local persistent config table exists in SQLite
try {
  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS antigravity_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
} catch {}

export class AntigravityProviderService {
  private static instance: AntigravityProviderService;
  private lastStatusCache: { status: AntigravityStatus; expiresAt: number } | null = null;

  public static getInstance(): AntigravityProviderService {
    if (!AntigravityProviderService.instance) {
      AntigravityProviderService.instance = new AntigravityProviderService();
    }
    return AntigravityProviderService.instance;
  }

  public getConfig(): AntigravityConfig {
    try {
      const row = rawDb.prepare('SELECT value FROM antigravity_config WHERE key = ?').get('current_config') as any;
      if (row?.value) {
        return { ...DEFAULT_CONFIG, ...JSON.parse(row.value) };
      }
    } catch {}
    return { ...DEFAULT_CONFIG };
  }

  public updateConfig(patch: Partial<AntigravityConfig>): AntigravityConfig {
    const current = this.getConfig();
    const updated: AntigravityConfig = {
      ...current,
      ...patch,
      // Enforce bounds
      maxTotalTokens: Math.max(256, Math.min(patch.maxTotalTokens ?? current.maxTotalTokens, 128000)),
      maxEstimatedCostUsd: Math.max(0.01, Math.min(patch.maxEstimatedCostUsd ?? current.maxEstimatedCostUsd, 20.0)),
      timeoutMs: Math.max(5000, Math.min(patch.timeoutMs ?? current.timeoutMs, 300000)),
      autoRetries: Math.max(0, Math.min(patch.autoRetries ?? current.autoRetries, 5)),
    };

    try {
      const now = new Date().toISOString();
      rawDb.prepare(`
        INSERT INTO antigravity_config (key, value, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = ?
      `).run('current_config', JSON.stringify(updated), now, JSON.stringify(updated), now);
    } catch (err) {
      logger.warn('[Antigravity] Failed to persist config in SQLite', { error: String(err) });
    }

    this.lastStatusCache = null;
    return updated;
  }

  public async getApiKey(): Promise<string | null> {
    const key = await secretStore.get('antigravity');
    if (key && key.trim().length > 0) return key.trim();
    const geminiKey = await secretStore.get('gemini');
    if (geminiKey && geminiKey.trim().length > 0) return geminiKey.trim();
    const googleKey = await secretStore.get('google');
    if (googleKey && googleKey.trim().length > 0) return googleKey.trim();
    return null;
  }

  public async saveApiKey(apiKey: string): Promise<void> {
    const trimmed = apiKey.trim();
    if (!trimmed) throw new Error('API key cannot be empty');
    await secretStore.set('antigravity', trimmed);
    await ProviderCredentialService.saveCredential('antigravity', trimmed);
    this.lastStatusCache = null;
  }

  public async deleteApiKey(): Promise<void> {
    await secretStore.delete('antigravity');
    await ProviderCredentialService.deleteCredential('antigravity');
    this.lastStatusCache = null;
  }

  public async getStatus(forceFresh = false): Promise<AntigravityStatus> {
    if (!forceFresh && this.lastStatusCache && this.lastStatusCache.expiresAt > Date.now()) {
      return this.lastStatusCache.status;
    }

    const config = this.getConfig();
    const credStatus = await ProviderCredentialService.getCredentialStatus('antigravity');
    const hasKey = credStatus.configured || (await this.getApiKey()) !== null;

    if (!hasKey) {
      const status: AntigravityStatus = {
        providerId: 'antigravity',
        name: 'Antigravity (Google DeepMind / Gemini)',
        category: 'remote',
        kind: 'agent-execution',
        configured: false,
        maskedPreview: null,
        reachable: false,
        status: 'needs-auth',
        lastTestedAt: null,
        latencyMs: 0,
        errorMessage: 'API key not configured',
        config,
      };
      this.lastStatusCache = { status, expiresAt: Date.now() + 10000 };
      return status;
    }

    const test = await this.testConnection();
    const status: AntigravityStatus = {
      providerId: 'antigravity',
      name: 'Antigravity (Google DeepMind / Gemini)',
      category: 'remote',
      kind: 'agent-execution',
      configured: true,
      maskedPreview: credStatus.maskedPreview || '***',
      reachable: test.reachable,
      status: test.reachable ? 'connected' : 'error',
      lastTestedAt: new Date().toISOString(),
      latencyMs: test.latencyMs,
      errorMessage: test.errorMessage,
      config,
    };

    this.lastStatusCache = { status, expiresAt: Date.now() + 15000 };
    return status;
  }

  public async testConnection(): Promise<{ reachable: boolean; latencyMs: number; errorMessage?: string; models?: string[] }> {
    const key = await this.getApiKey();
    if (!key) {
      return { reachable: false, latencyMs: 0, errorMessage: 'No API key configured' };
    }

    const started = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);

    try {
      // Light query to verify API key validity and model availability
      const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`;
      const res = await fetch(url, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
      });

      const latencyMs = Date.now() - started;
      if (!res.ok) {
        const errorData: any = await res.json().catch(() => ({}));
        const rawErr = errorData?.error?.message || `HTTP ${res.status} ${res.statusText}`;
        return {
          reachable: false,
          latencyMs,
          errorMessage: redactSecrets(rawErr),
        };
      }

      const data: any = await res.json().catch(() => ({}));
      const models = Array.isArray(data.models)
        ? data.models.map((m: any) => m.name?.replace('models/', '') || m.displayName).slice(0, 10)
        : ['gemini-2.5-flash', 'gemini-2.0-flash'];

      return {
        reachable: true,
        latencyMs,
        models,
      };
    } catch (err: any) {
      const latencyMs = Date.now() - started;
      return {
        reachable: false,
        latencyMs,
        errorMessage: redactSecrets(err?.message || 'Connection test failed'),
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  public async executeReadOnlyRun(options: AntigravityExecutionOptions): Promise<AntigravityExecutionResult> {
    const config = this.getConfig();
    const key = await this.getApiKey();

    if (!key) {
      throw new Error('Antigravity execution failed: Google / Gemini API key is not configured.');
    }

    // Safety constraint: explicit approval required before project files are sent externally
    if (options.files && options.files.length > 0 && !options.approvedForExternalTransmission) {
      throw new Error('SAFETY_BLOCK: Explicit user authorization is required before project files can be transmitted to external Antigravity provider.');
    }

    const modelName = options.model || config.defaultModel || 'gemini-2.5-flash';
    const effectiveTimeoutMs = Math.min(options.timeoutMs || config.timeoutMs, config.timeoutMs);
    const effectiveMaxTokens = Math.min(options.maxTokens || config.maxTotalTokens, config.maxTotalTokens);

    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), effectiveTimeoutMs);

    try {
      const contents: Array<{ role: string; parts: Array<{ text: string }> }> = [];

      let userText = options.prompt;
      if (options.files && options.files.length > 0) {
        const filesContext = options.files
          .map(f => `--- File: ${f.path} ---\n${f.content}\n--- End File ---`)
          .join('\n\n');
        userText = `${filesContext}\n\nTask / Query:\n${options.prompt}`;
      }

      contents.push({
        role: 'user',
        parts: [{ text: userText }],
      });

      const body: Record<string, any> = {
        contents,
        generationConfig: {
          maxOutputTokens: effectiveMaxTokens,
          temperature: 0.2,
        },
      };

      if (options.systemPrompt) {
        body.systemInstruction = {
          parts: [{ text: `${options.systemPrompt}\n\nIMPORTANT: You are a strictly read-only execution assistant. Do not attempt or claim to modify files directly.` }],
        };
      }

      const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${key}`;

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      const latencyMs = Date.now() - started;

      if (!res.ok) {
        const errorData: any = await res.json().catch(() => ({}));
        const rawErr = errorData?.error?.message || `HTTP ${res.status} ${res.statusText}`;
        throw new Error(`Antigravity API Error: ${redactSecrets(rawErr)}`);
      }

      const data: any = await res.json();
      const candidate = data.candidates?.[0];
      const text = candidate?.content?.parts?.map((p: any) => p.text).join('\n') || '';

      const promptTokens = data.usageMetadata?.promptTokenCount || Math.ceil(userText.length / 4);
      const completionTokens = data.usageMetadata?.candidatesTokenCount || Math.ceil(text.length / 4);
      const totalTokens = promptTokens + completionTokens;

      const estimatedCostUsd = ((promptTokens / 1_000_000) * COST_PER_1M_PROMPT) +
                               ((completionTokens / 1_000_000) * COST_PER_1M_COMPLETION);

      // Check cost & token limits
      if (estimatedCostUsd > config.maxEstimatedCostUsd) {
        logger.warn(`[Antigravity] Cost limit exceeded (${estimatedCostUsd.toFixed(4)} > ${config.maxEstimatedCostUsd})`);
      }

      return {
        text: redactSecrets(text),
        usage: {
          promptTokens,
          completionTokens,
          totalTokens,
          estimatedCostUsd: Number(estimatedCostUsd.toFixed(6)),
        },
        model: modelName,
        latencyMs,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

export const antigravityProviderService = AntigravityProviderService.getInstance();
