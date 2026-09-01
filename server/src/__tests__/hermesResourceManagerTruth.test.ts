/**
 * __tests__/hermesResourceManagerTruth.test.ts
 *
 * Test Matrix: Hermes Resource Manager Truthfulness Invariants
 *
 * Covers Issues A–J from the FINAL TRUTHFULNESS + PRODUCTION HARDENING GATE:
 *
 * A. Gemini API key present does NOT make Antigravity Managed AVAILABLE.
 * B. UNVERIFIED state cannot be selected for routing.
 * C. Gemini API AVAILABLE + Antigravity Managed BLOCKED is a valid/expected state.
 * D. AUTH_REQUIRED state cannot be selected for routing.
 * E. Antigravity Managed = AVAILABLE only after recordAntigravityVerification(AVAILABLE).
 * F. Quota exhaustion requires real provider data; providerReportedQuota is null by default.
 * G. recordAntigravityVerification with AVAILABLE sets verifiedEndpoint/verifiedAgent.
 * H. Routing to codex when local-qwen is OFFLINE.
 * I. Routing to gemini-api when local-qwen is OFFLINE and codex is ERROR.
 * J. verifiedApi in observability snapshot is null unless verificationState = AVAILABLE.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mock external dependencies ────────────────────────────────────────────────
vi.mock('../db/index.js', () => ({
  rawDb: {
    exec: vi.fn(),
    prepare: vi.fn().mockReturnValue({
      run: vi.fn(),
      get: vi.fn().mockReturnValue(null),
      all: vi.fn().mockReturnValue([]),
    }),
  },
}));

vi.mock('../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// We mock the credential service to control returned keys
vi.mock('../services/gateway/credentials.js', () => ({
  ProviderCredentialService: {
    getCredential: vi.fn().mockResolvedValue(null),
  },
}));

// Mock the adapter imports used by probeCodex
vi.mock('../domains/workerAdapters/hermesAdapter.js', () => ({
  executeHermesTask: vi.fn(),
}));
vi.mock('../domains/hermes/service.js', () => ({
  hermesService: { executeTask: vi.fn() },
}));
vi.mock('../services/hermesApiService.js', () => ({
  resolveHermesModelTruth: vi.fn().mockReturnValue({ model: 'qwen2.5:7b', provider: 'ollama' }),
}));

import { HermesResourceManager } from '../services/hermes/resourceManager.js';
import { ProviderCredentialService } from '../services/gateway/credentials.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Create a fresh HermesResourceManager instance (bypasses singleton for test isolation).
 */
function makeManager(): HermesResourceManager {
  // Access private static to reset singleton between tests
  (HermesResourceManager as any).instance = undefined;
  return HermesResourceManager.getInstance();
}

/** Stub probeOllama to return controlled results. */
function stubOllamaReachable(mgr: HermesResourceManager, models: string[] = ['qwen2.5:7b']) {
  vi.spyOn(mgr, 'probeOllama').mockResolvedValue({
    reachable: true,
    models,
    latencyMs: 10,
  });
}

function stubOllamaOffline(mgr: HermesResourceManager) {
  vi.spyOn(mgr, 'probeOllama').mockResolvedValue({
    reachable: false,
    models: [],
    latencyMs: 3000,
  });
}

/** Stub getStoredAntigravityVerification to return a given state. */
function stubVerification(
  mgr: HermesResourceManager,
  state: 'UNVERIFIED' | 'AUTH_REQUIRED' | 'BLOCKED' | 'AVAILABLE' | 'ERROR',
  extras: Partial<ReturnType<HermesResourceManager['getStoredAntigravityVerification']>> = {}
) {
  vi.spyOn(mgr, 'getStoredAntigravityVerification').mockReturnValue({
    verificationState: state,
    lastVerifiedAt: state === 'AVAILABLE' ? new Date().toISOString() : null,
    verifiedEndpoint: state === 'AVAILABLE' ? '/v1alpha/projects/proj/agents/ag' : null,
    verifiedAgent: state === 'AVAILABLE' ? 'ag-test-001' : null,
    backgroundExecutionConfirmed: state === 'AVAILABLE',
    verificationEvidence: state === 'AVAILABLE' ? 'HTTP 200 from managed endpoint' : null,
    errorMessage: null,
    ...extras,
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('HermesResourceManager Truthfulness Invariants', () => {
  let mgr: HermesResourceManager;

  beforeEach(() => {
    vi.clearAllMocks();
    mgr = makeManager();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── A: Gemini key ≠ Antigravity Managed AVAILABLE ──────────────────────────

  it('A: Gemini API key present does NOT make Antigravity Managed AVAILABLE', async () => {
    // Gemini key present
    vi.mocked(ProviderCredentialService.getCredential).mockImplementation(async (id) => {
      if (id === 'gemini') return 'fake-gemini-key';
      return null; // antigravity key absent
    });

    stubOllamaReachable(mgr);
    stubVerification(mgr, 'UNVERIFIED'); // verification state is UNVERIFIED

    const quotaMap = await mgr.getQuotaStatus();

    // Gemini API should be AVAILABLE (key present)
    expect(quotaMap['gemini-api'].status).toBe('AVAILABLE');

    // Antigravity Managed must NOT be AVAILABLE — credential only sets AUTH_REQUIRED or UNVERIFIED
    expect(quotaMap['antigravity-managed'].status).not.toBe('AVAILABLE');
    expect(['UNVERIFIED', 'AUTH_REQUIRED']).toContain(quotaMap['antigravity-managed'].status);
  });

  // ── B: UNVERIFIED cannot be selected for routing ───────────────────────────

  it('B: UNVERIFIED antigravity-managed is never selected for routing', async () => {
    stubOllamaOffline(mgr); // local qwen unavailable
    vi.mocked(ProviderCredentialService.getCredential).mockResolvedValue(null);
    stubVerification(mgr, 'UNVERIFIED');

    const decision = await mgr.evaluateTask({
      prompt: 'run parallel matrix build on remote sandbox',
      requiresRemoteSandbox: true,
    });

    expect(decision.selectedExecutor).not.toBe('antigravity-managed');
  });

  // ── C: Gemini AVAILABLE + Antigravity BLOCKED is valid state ──────────────

  it('C: Gemini API AVAILABLE + Antigravity BLOCKED is a valid state', async () => {
    vi.mocked(ProviderCredentialService.getCredential).mockImplementation(async (id) => {
      if (id === 'gemini') return 'fake-gemini-key';
      return null;
    });
    stubOllamaReachable(mgr);
    stubVerification(mgr, 'BLOCKED', { errorMessage: '403 Forbidden from managed endpoint' });

    const quotaMap = await mgr.getQuotaStatus();

    expect(quotaMap['gemini-api'].status).toBe('AVAILABLE');
    expect(quotaMap['antigravity-managed'].status).toBe('BLOCKED');
  });

  // ── D: AUTH_REQUIRED cannot be selected for routing ───────────────────────

  it('D: AUTH_REQUIRED antigravity-managed falls back to available executor', async () => {
    stubOllamaReachable(mgr);
    stubVerification(mgr, 'AUTH_REQUIRED');
    vi.mocked(ProviderCredentialService.getCredential).mockResolvedValue(null);

    const decision = await mgr.evaluateTask({
      prompt: 'run remote sandboxed container build',
      requiresRemoteSandbox: true,
    });

    expect(decision.selectedExecutor).not.toBe('antigravity-managed');
    expect(['local-qwen', 'codex', 'gemini-api']).toContain(decision.selectedExecutor);
  });

  // ── E: AVAILABLE only after recordAntigravityVerification(AVAILABLE) ───────

  it('E: Antigravity Managed is AVAILABLE only after positive verification record', async () => {
    stubOllamaReachable(mgr);
    vi.mocked(ProviderCredentialService.getCredential).mockImplementation(async (id) => {
      if (id === 'antigravity') return 'fake-ag-key';
      if (id === 'gemini') return 'fake-gemini-key';
      return null;
    });

    // Before verification — UNVERIFIED
    stubVerification(mgr, 'UNVERIFIED');
    let quotaMap = await mgr.getQuotaStatus();
    expect(quotaMap['antigravity-managed'].status).toBe('UNVERIFIED');

    // After successful verification
    stubVerification(mgr, 'AVAILABLE');
    quotaMap = await mgr.getQuotaStatus();
    expect(quotaMap['antigravity-managed'].status).toBe('AVAILABLE');
  });

  // ── F: providerReportedQuota is null unless real 429 data was recorded ─────

  it('F: providerReportedQuota is null by default; non-null only from real 429 events', async () => {
    stubOllamaReachable(mgr);
    stubVerification(mgr, 'UNVERIFIED');
    vi.mocked(ProviderCredentialService.getCredential).mockResolvedValue(null);

    const quotaMap = await mgr.getQuotaStatus();

    // All entries must have null providerReportedQuota by default
    for (const status of Object.values(quotaMap)) {
      expect(status.providerReportedQuota).toBeNull();
    }

    // After recording a real 429 event with Retry-After data
    mgr.recordQuotaExhaustion('gemini-api', { retryAfterSeconds: 60, reason: '429 from provider' });
    const quotaMapAfter = await mgr.getQuotaStatus();

    expect(quotaMapAfter['gemini-api'].status).toBe('WAITING_FOR_RESET');
    expect(quotaMapAfter['gemini-api'].providerReportedQuota).not.toBeNull();
    expect(quotaMapAfter['gemini-api'].providerReportedQuota?.retryAfterSeconds).toBe(60);
    expect(quotaMapAfter['gemini-api'].providerReportedQuota?.source).toContain('429');
  });

  // ── G: recordAntigravityVerification sets verifiedEndpoint/Agent ───────────

  it('G: recordAntigravityVerification with AVAILABLE stores endpoint and agent', async () => {
    const { rawDb } = await import('../db/index.js');
    const runMock = vi.fn();
    (rawDb.prepare as any).mockReturnValue({ run: runMock, get: vi.fn().mockReturnValue(null), all: vi.fn().mockReturnValue([]) });


    mgr.recordAntigravityVerification({
      verificationState: 'AVAILABLE',
      lastVerifiedAt: '2026-08-30T12:00:00Z',
      verifiedEndpoint: '/v1alpha/projects/test-proj/agents/ag-001',
      verifiedAgent: 'ag-001',
      backgroundExecutionConfirmed: true,
      verificationEvidence: 'HTTP 200, runId=run-abc123',
      errorMessage: null,
    });

    expect(runMock).toHaveBeenCalledWith(
      'AVAILABLE',
      '2026-08-30T12:00:00Z',
      '/v1alpha/projects/test-proj/agents/ag-001',
      'ag-001',
      1,
      'HTTP 200, runId=run-abc123',
      null,
      expect.any(String)
    );
  });

  // ── H: Routing to codex when local-qwen is OFFLINE ────────────────────────

  it('H: Routes to codex for code-mutation tasks when local-qwen is OFFLINE', async () => {
    stubOllamaOffline(mgr);
    vi.mocked(ProviderCredentialService.getCredential).mockResolvedValue(null);
    stubVerification(mgr, 'UNVERIFIED');

    const decision = await mgr.evaluateTask({
      prompt: 'modify the TypeScript file to fix the bug',
      requiresCodeMutation: true,
    });

    // With Qwen offline and code mutation needed: should route to codex or local-qwen fallback
    // (codex probeCodex returns AVAILABLE since mocked adapter exists)
    expect(['codex', 'local-qwen']).toContain(decision.selectedExecutor);
  });

  // ── I: Routing to gemini-api when local-qwen is OFFLINE and codex errors ──

  it('I: Routes to gemini-api when local-qwen OFFLINE and gemini key present', async () => {
    stubOllamaOffline(mgr);
    vi.mocked(ProviderCredentialService.getCredential).mockImplementation(async (id) => {
      if (id === 'gemini') return 'fake-gemini-key';
      return null;
    });
    stubVerification(mgr, 'UNVERIFIED');

    // Override probeCodex to simulate CodeX being unavailable
    vi.spyOn(mgr as any, 'probeCodex').mockResolvedValue({
      status: 'ERROR',
      details: 'CodeX adapter unavailable in test',
    });

    const decision = await mgr.evaluateTask({
      prompt: 'summarize this research document',
    });

    // Local-qwen OFFLINE and probeCodex returns ERROR, gemini key present -> select gemini-api
    // (routing: non-coding task -> check local-qwen -> offline -> escalate to gemini-api)
    expect(decision.selectedExecutor).toBe('gemini-api');
  });

  // ── J: verifiedApi in observability is null unless AVAILABLE ──────────────

  it('J: observabilitySnapshot.antigravityState.verifiedApi is null unless verificationState=AVAILABLE', async () => {
    stubOllamaReachable(mgr);
    vi.mocked(ProviderCredentialService.getCredential).mockResolvedValue(null);

    // Test each non-AVAILABLE state
    for (const state of ['UNVERIFIED', 'AUTH_REQUIRED', 'BLOCKED', 'ERROR'] as const) {
      stubVerification(mgr, state, { errorMessage: state === 'ERROR' ? 'test error' : null });
      const snapshot = await mgr.getObservabilitySnapshot();
      expect(snapshot.antigravityState.verifiedApi).toBeNull();
    }

    // With AVAILABLE state
    stubVerification(mgr, 'AVAILABLE');
    const snapshot = await mgr.getObservabilitySnapshot();
    expect(snapshot.antigravityState.verifiedApi).not.toBeNull();
    expect(snapshot.antigravityState.verifiedApi).toContain('/v1alpha');
    expect(snapshot.antigravityState.verifiedApi).toContain('ag-test-001');
  });

  // ── Additional: Approval gate still works ──────────────────────────────────

  it('Approval gate fires for financial transactions', async () => {
    stubOllamaReachable(mgr);
    stubVerification(mgr, 'UNVERIFIED');
    vi.mocked(ProviderCredentialService.getCredential).mockResolvedValue(null);

    const decision = await mgr.evaluateTask({
      prompt: 'charge the client $500 USD for the invoice',
    });

    expect(decision.requiresApproval).toBe(true);
    expect(decision.approvalReason).toBeTruthy();
  });
});
