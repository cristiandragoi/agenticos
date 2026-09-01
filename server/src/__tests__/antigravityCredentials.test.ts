import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { antigravityProviderService } from '../services/antigravity/antigravityProviderService.js';
import { secretStore, redactSecrets, sanitizeDiagnostics } from '../services/gateway/secretStore.js';

describe('Antigravity Provider Credentials & Secret Safety', () => {
  const testKey = 'AIzaSyTestKeyForAntigravityValidation987654';

  beforeEach(async () => {
    await antigravityProviderService.deleteApiKey();
    antigravityProviderService.updateConfig({
      maxTotalTokens: 8192,
      maxEstimatedCostUsd: 0.50,
      timeoutMs: 60000,
      autoRetries: 0,
      defaultModel: 'gemini-2.5-flash',
    });
  });

  afterEach(async () => {
    await antigravityProviderService.deleteApiKey();
  });

  it('1. Initial status reports unconfigured without crashing or leaking secrets', async () => {
    const status = await antigravityProviderService.getStatus(true);
    expect(status.configured).toBe(false);
    expect(status.status).toBe('needs-auth');
    expect(status.maskedPreview).toBeNull();
    expect(JSON.stringify(status)).not.toContain('AIzaSy');
  });

  it('2. Securely saves API key and updates configuration status', async () => {
    await antigravityProviderService.saveApiKey(testKey);

    const hasKey = await secretStore.has('antigravity');
    expect(hasKey).toBe(true);

    const status = await antigravityProviderService.getStatus(true);
    expect(status.configured).toBe(true);
    // Masked preview should not expose full key
    expect(status.maskedPreview).not.toBe(testKey);
    expect(JSON.stringify(status)).not.toContain(testKey);
  });

  it('3. Deletes API key cleanly from vault', async () => {
    await antigravityProviderService.saveApiKey(testKey);
    expect(await secretStore.has('antigravity')).toBe(true);

    await antigravityProviderService.deleteApiKey();
    expect(await secretStore.has('antigravity')).toBe(false);

    const status = await antigravityProviderService.getStatus(true);
    expect(status.configured).toBe(false);
    expect(status.status).toBe('needs-auth');
  });

  it('4. Configurable execution limits persist and enforce boundaries', () => {
    const original = antigravityProviderService.getConfig();
    expect(original.autoRetries).toBe(0); // Disabled by default

    const updated = antigravityProviderService.updateConfig({
      maxTotalTokens: 16000,
      maxEstimatedCostUsd: 1.25,
      timeoutMs: 45000,
      autoRetries: 1,
    });

    expect(updated.maxTotalTokens).toBe(16000);
    expect(updated.maxEstimatedCostUsd).toBe(1.25);
    expect(updated.timeoutMs).toBe(45000);
    expect(updated.autoRetries).toBe(1);

    const reloaded = antigravityProviderService.getConfig();
    expect(reloaded.maxTotalTokens).toBe(16000);
    expect(reloaded.maxEstimatedCostUsd).toBe(1.25);
  });

  it('5. Central redaction cleans secrets from logs, text, and diagnostics', () => {
    const rawLog = `Calling Gemini endpoint with key=${testKey} and Bearer eyJhbGciOiJIUzI1NiJ9.test`;
    const redacted = redactSecrets(rawLog);

    expect(redacted).not.toContain(testKey);
    expect(redacted).toContain('[REDACTED]');

    const diagnostics = {
      provider: 'antigravity',
      apiKey: testKey,
      clientSecret: 'secret-12345',
      nested: { token: 'secret-token' },
      info: 'Safe information',
    };

    const sanitized = sanitizeDiagnostics(diagnostics);
    expect(sanitized.apiKey).toBe('[REDACTED]');
    expect(sanitized.clientSecret).toBe('[REDACTED]');
    expect(sanitized.nested.token).toBe('[REDACTED]');
    expect(sanitized.info).toBe('Safe information');
  });
});
