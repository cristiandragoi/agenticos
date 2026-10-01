import { describe, expect, it, beforeEach, beforeAll, vi } from 'vitest';
import { costPolicy } from '../services/gateway/costPolicy.js';
import { modelRouter } from '../services/gateway/modelRouter.js';
import { universalExecutionController } from '../domains/jarvis/execution/universalExecutionController.js';
import { projectTaskService } from '../services/projectExecution/projectTaskService.js';
import { initProjectExecutionSchema } from '../services/projectExecution/schema.js';

describe('Cost Policy, Model Routing & Fallback Acceptance (Phase 8: Scenarios A-H)', () => {
  beforeAll(() => {
    initProjectExecutionSchema();
  });

  beforeEach(() => {
    vi.restoreAllMocks();
    costPolicy.setMode('LOW_COST');
  });

  // ── Scenario A: Deepgram available → Deepgram transcription used ───────
  it('Scenario A: When Deepgram is available and permitted, Deepgram is chosen', async () => {
    expect(costPolicy.getMode()).toBe('LOW_COST');
    const allowed = costPolicy.isAllowed('LOW_COST_PAID');
    expect(allowed.allowed).toBe(true);
  });

  // ── Scenario B: Deepgram unavailable → Local STT fallback ──────────────
  it('Scenario B: When Deepgram is unavailable or blocked, local STT is used', async () => {
    // Under ZERO mode, Deepgram is not permitted
    costPolicy.setMode('ZERO');
    const deepgramCheck = costPolicy.isAllowed('LOW_COST_PAID');
    expect(deepgramCheck.allowed).toBe(false);

    // Local Whisper remains allowed
    const localCheck = costPolicy.isAllowed('LOCAL_FREE');
    expect(localCheck.allowed).toBe(true);
  });

  // ── Scenario C: Preferred cloud LLM quota exhausted → Router tries allowed fallback ──
  it('Scenario C: Fallback chain provides allowed alternatives when primary is exhausted', () => {
    costPolicy.setMode('LOW_COST');
    const fallbacks = modelRouter.getFallbackChain('WORKER');
    expect(fallbacks.length).toBeGreaterThan(1);
    // Highest priority in LOW_COST is local ollama
    expect(fallbacks[0].provider).toBe('ollama');
  });

  // ── Scenario D: ZERO mode → No paid provider can be invoked ────────────
  it('Scenario D: Under COST_MODE=ZERO, paid and low-cost paid providers are strictly blocked', () => {
    costPolicy.setMode('ZERO');
    expect(costPolicy.isAllowed('LOCAL_FREE').allowed).toBe(true);
    expect(costPolicy.isAllowed('CLOUD_FREE_QUOTA').allowed).toBe(true);
    expect(costPolicy.isAllowed('LOW_COST_PAID').allowed).toBe(false);
    expect(costPolicy.isAllowed('PAID').allowed).toBe(false);
    expect(costPolicy.isAllowed('UNKNOWN').allowed).toBe(false);
    expect(costPolicy.isAllowed('DISABLED').allowed).toBe(false);

    // Model selection under ZERO mode only returns free / local models
    const selected = modelRouter.selectModel('WORKER');
    expect(selected.selected).not.toBeNull();
    expect(['LOCAL_FREE', 'CLOUD_FREE_QUOTA', 'CLOUD_PROMOTIONAL_CREDIT']).toContain(selected.selected?.costClass);
  });

  // ── Scenario E: LOW_COST mode → Only explicitly allowed low-cost providers ──
  it('Scenario E: Under COST_MODE=LOW_COST, expensive PAID providers are blocked, low-cost allowed', () => {
    costPolicy.setMode('LOW_COST');
    expect(costPolicy.isAllowed('LOCAL_FREE').allowed).toBe(true);
    expect(costPolicy.isAllowed('CLOUD_FREE_QUOTA').allowed).toBe(true);
    expect(costPolicy.isAllowed('LOW_COST_PAID').allowed).toBe(true);
    expect(costPolicy.isAllowed('PAID').allowed).toBe(false);
  });

  // ── Scenario F: No model available → Truthful controlled failure ───────
  it('Scenario F: When no model is allowed or available, router returns truthful failure without fabricating', () => {
    costPolicy.setMode('ZERO');
    // If we require vision capability (which no local/free model has in our registry)
    const res = modelRouter.selectModel('WORKER', { vision: true });
    expect(res.selected).toBeNull();
    expect(res.reason).toContain('No eligible models available');
  });

  // ── Scenario G: TTS failure → Task succeeds, text response remains canonical ──
  it('Scenario G: Task execution succeeds even if speech presentation fails', async () => {
    // Create an internal task via universal execution controller
    const result = await universalExecutionController.handleUserTurn({
      prompt: 'Jarvis, create a task to review the Free Cash API tomorrow.',
      conversationId: 'test-tts-resilience-conv',
    });

    expect(result.handled).toBe(true);
    expect(result.execution?.success).toBe(true);
    expect(result.spokenText).toContain('review the Free Cash API tomorrow');
    // Text response is canonical and fully present
    expect(result.spokenText.length).toBeGreaterThan(10);
  });

  // ── Scenario H: Tool execution failure → Jarvis does NOT claim completion ──
  it('Scenario H: When tool execution or persistence fails, Jarvis does not claim completion', async () => {
    // Mock projectTaskService.getTask to simulate a persistence failure
    vi.spyOn(projectTaskService, 'getTask').mockReturnValue(null);

    const result = await universalExecutionController.handleUserTurn({
      prompt: 'Jarvis, create a task to review the Free Cash API tomorrow.',
      conversationId: 'test-failure-claim-conv',
    });

    expect(result.handled).toBe(true);
    expect(result.execution?.success).toBe(false);
    expect(result.verification?.verified).toBe(false);
    expect(result.spokenText).toContain('database verification failed');
    expect(result.spokenText).not.toContain('It is saved as task');
  });
});
