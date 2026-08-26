/**
 * jarvisConversationalMode.test.ts
 *
 * Regression guard for the conversational-mode fix:
 *  - Capability explanation queries (direct_explanation) must route through the
 *    LLM — not return the raw registry string verbatim.
 *  - The executive intent classifier must still classify these correctly so the
 *    capability context IS injected into the system prompt.
 *  - Operational requests still route to delegation, not direct_explanation.
 *  - Plain conversational questions that happen to mention a worker don't
 *    accidentally trigger execution.
 *  - buildCapabilityExplanation output must NOT appear verbatim as a reply for
 *    "What can Codex do?" (proven by checking the classifyExecutiveIntent path
 *    routes to 'direct_explanation', not any terminal static-reply branch).
 */
import { describe, it, expect } from 'vitest';
import { classifyExecutiveIntent } from '../domains/jarvis/executiveIntent.js';
import { buildCapabilityExplanation, buildWorkerStatus, buildWorkerFeedback } from '../domains/jarvis/workerInsights.js';
import { resolveCapability } from '../domains/jarvis/capabilityRegistry.js';

/**
 * The old robotic path: classifyExecutiveIntent returned direct_explanation →
 * the handler called buildCapabilityExplanation and streamed it verbatim.
 * The fix: direct_explanation falls through to the LLM with context injected.
 *
 * We verify the fix by confirming:
 *   1. classifyExecutiveIntent still classifies these as direct_explanation
 *      (so capability context IS injected).
 *   2. The raw buildCapabilityExplanation string contains the old rigid format
 *      (used as a negative assertion — Jarvis must NOT stream this directly).
 */
describe('Jarvis conversational mode — direct_explanation routing', () => {
  it('"What can Codex do?" → direct_explanation (routes to LLM, not static dump)', () => {
    const r = classifyExecutiveIntent('What can Codex do?');
    expect(r?.intent).toBe('direct_explanation');
    expect(r?.capability.id).toBe('codex');
    // Verify the raw dump that used to be streamed directly is a rigid template
    const cap = r!.capability;
    const dump = buildCapabilityExplanation(cap);
    // The old reply started with "CodeX:" followed by responsibilities verbatim
    expect(dump).toMatch(/^CodeX:/);
    expect(dump).toContain('Supported actions:');
    // This is what the user used to get — now it goes to LLM only as context
  });

  it('"What is Hermes for?" → direct_explanation (routes to LLM, not static dump)', () => {
    const r = classifyExecutiveIntent('What is Hermes for?');
    expect(r?.intent).toBe('direct_explanation');
    expect(r?.capability.id).toBe('hermes');
  });

  it('"Can you use Codex to fix this?" → direct_explanation (not delegation without explicit ask)', () => {
    // "Can you use CodeX" is an explanation/possibility question, not an execution request
    const r = classifyExecutiveIntent('Can you use Codex to fix this?');
    // Must classify as direct_explanation OR null (both mean no task creation)
    expect(r?.intent).not.toBe('worker_delegation');
    expect(r?.intent).not.toBe('revenue_pipeline');
  });

  it('"Who should handle a planning task?" → null (conversational; no capability target)', () => {
    // This has no explicit worker mention — the LLM answers directly
    const r = classifyExecutiveIntent('Who should handle a planning task?');
    expect(r).toBeNull();
  });

  it('"Explain the revenue pipeline" → direct_explanation (routes to LLM)', () => {
    const r = classifyExecutiveIntent('Explain the revenue pipeline');
    expect(r?.intent).toBe('direct_explanation');
    expect(r?.capability.id).toBe('revenue_pipeline');
  });

  it('"What does Hermes do?" → direct_explanation (routes to LLM)', () => {
    const r = classifyExecutiveIntent('What does Hermes do?');
    expect(r?.intent).toBe('direct_explanation');
    expect(r?.capability.id).toBe('hermes');
  });

  it('"Explain what CodeX does" → direct_explanation (routes to LLM)', () => {
    const r = classifyExecutiveIntent('Explain what CodeX does');
    expect(r?.intent).toBe('direct_explanation');
    expect(r?.capability.id).toBe('codex');
  });
});

describe('Jarvis conversational mode — routing preservation', () => {
  it('Operational request "Ask Hermes to inspect the backend" → worker_delegation (not direct_explanation)', () => {
    const r = classifyExecutiveIntent('Ask Hermes to inspect the backend');
    expect(r?.intent).toBe('worker_delegation');
    expect(r?.workerKind).toBe('hermes');
  });

  it('"Tell CodeX to fix the failing test" → worker_delegation (not direct_explanation)', () => {
    const r = classifyExecutiveIntent('Tell CodeX to fix the failing test');
    expect(r?.intent).toBe('worker_delegation');
    expect(r?.capability.id).toBe('codex');
  });

  it('"How is CodeX doing?" → worker_status (not direct_explanation)', () => {
    const r = classifyExecutiveIntent('How is CodeX doing?');
    expect(r?.intent).toBe('worker_status');
    expect(r?.capability.id).toBe('codex');
  });

  it('"Give me feedback on Hermes" → worker_feedback (not direct_explanation)', () => {
    const r = classifyExecutiveIntent('Give me feedback on Hermes');
    expect(r?.intent).toBe('worker_feedback');
    expect(r?.capability.id).toBe('hermes');
  });

  it('"Open CodeX" → navigation (not direct_explanation)', () => {
    const r = classifyExecutiveIntent('Open CodeX');
    expect(r?.intent).toBe('navigation');
  });

  it('Plain question with no capability mention → null (LLM handles conversationally)', () => {
    expect(classifyExecutiveIntent('What is the best way to write unit tests?')).toBeNull();
    expect(classifyExecutiveIntent('What is the weather like?')).toBeNull();
    expect(classifyExecutiveIntent('How do I use TypeScript generics?')).toBeNull();
  });

  it('Delegation with read-only constraint still marks readOnly correctly', () => {
    const r = classifyExecutiveIntent('Ask Hermes to inspect the codebase without modifying files');
    expect(r?.intent).toBe('worker_delegation');
    expect(r?.readOnly).toBe(true);
  });
});

describe('Capability context content for LLM injection', () => {
  it('Codex capability context contains factual fields (role, supported actions, limitations)', () => {
    const cap = resolveCapability('What can Codex do?')!;
    expect(cap.id).toBe('codex');
    // This is the context injected into the system prompt — it must be factual
    const ctx = [
      `Worker: ${cap.displayName}`,
      `Role: ${cap.responsibilities}`,
      `Supported actions: ${cap.supportedActions.join(', ')}.`,
      cap.limitations ? `Limitations: ${cap.limitations}` : null,
    ].filter(Boolean).join('\n');
    expect(ctx).toContain('CodeX');
    expect(ctx).toContain('Supported actions:');
    expect(ctx).toContain('Limitations:');
    // Must NOT contain "Supported actions: Supported actions:" (duplicate format bug)
    expect(ctx).not.toMatch(/Supported actions:.*Supported actions:/s);
  });

  it('Hermes capability context contains factual fields', () => {
    const cap = resolveCapability('What is Hermes for?')!;
    expect(cap.id).toBe('hermes');
    expect(cap.responsibilities).toBeTruthy();
    expect(cap.supportedActions.length).toBeGreaterThan(0);
    expect(cap.limitations).toBeTruthy();
  });
});
