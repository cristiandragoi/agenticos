import { describe, expect, it, vi, beforeEach } from 'vitest';
import { classifyExecutiveIntent, mentionsInternalCapability } from '../domains/jarvis/executiveIntent.js';
import { resolveCapability, CAPABILITY_REGISTRY } from '../domains/jarvis/capabilityRegistry.js';
import { buildCapabilityExplanation } from '../domains/jarvis/workerInsights.js';

/* ── Registry sanity ─────────────────────────────────────── */
describe('capability registry', () => {
  it('registers all eight internal capabilities', () => {
    const ids = CAPABILITY_REGISTRY.map((c) => c.id);
    expect(ids).toEqual(
      expect.arrayContaining(['jarvis', 'hermes', 'codex', 'research', 'agent_teams', 'boards', 'memory', 'automations'])
    );
  });

  it('each capability has all contract fields', () => {
    for (const cap of CAPABILITY_REGISTRY) {
      expect(typeof cap.id).toBe('string');
      expect(typeof cap.displayName).toBe('string');
      expect(cap.responsibilities.length).toBeGreaterThan(10);
      expect(Array.isArray(cap.supportedActions)).toBe(true);
      expect(typeof cap.statusSource).toBe('string');
      expect(typeof cap.route).toBe('string');
      expect(typeof cap.limitations).toBe('string');
    }
  });

  it('resolves worker mentions to capabilities', () => {
    expect(resolveCapability('Give me feedback regarding CodeX')?.id).toBe('codex');
    expect(resolveCapability('How is Hermes doing?')?.id).toBe('hermes');
    expect(resolveCapability('Open CodeX')?.id).toBe('codex');
    expect(resolveCapability('show me the task board')?.id).toBe('boards');
  });

  it('explanation answers come from the registry (no task, no fabrication)', () => {
    const cap = resolveCapability('Explain what CodeX does')!;
    const text = buildCapabilityExplanation(cap);
    expect(text).toContain('CodeX');
    expect(text).toContain(cap.responsibilities);
  });
});

/* ── Executive intent classification ─────────────────────── */
describe('executive intent classification', () => {
  it('explain what CodeX does → direct_explanation (no task)', () => {
    const r = classifyExecutiveIntent('Explain what CodeX does');
    expect(r?.intent).toBe('direct_explanation');
    expect(r?.capability.id).toBe('codex');
  });

  it('"Tell me only what Hermes does" → direct_explanation (NOT worker_status)', () => {
    // Phase 8: a "what X does" question must produce a clean explanation,
    // never a status dump with raw task IDs.
    const r = classifyExecutiveIntent('Tell me only what Hermes does');
    expect(r?.intent).toBe('direct_explanation');
    expect(r?.capability.id).toBe('hermes');
  });

  it('"what does Hermes do" → direct_explanation', () => {
    const r = classifyExecutiveIntent('what does Hermes do');
    expect(r?.intent).toBe('direct_explanation');
    expect(r?.capability.id).toBe('hermes');
  });

  it('Give me feedback regarding CodeX → worker_feedback', () => {
    const r = classifyExecutiveIntent('Give me feedback regarding CodeX');
    expect(r?.intent).toBe('worker_feedback');
    expect(r?.capability.id).toBe('codex');
  });

  it('How is Hermes doing? → worker_status', () => {
    const r = classifyExecutiveIntent('How is Hermes doing?');
    expect(r?.intent).toBe('worker_status');
    expect(r?.capability.id).toBe('hermes');
  });

  it('What model is CodeX using? → worker_status (no task)', () => {
    const r = classifyExecutiveIntent('What model is CodeX using?');
    expect(r?.intent).toBe('worker_status');
    expect(r?.capability.id).toBe('codex');
  });

  it('What is CodeX working on? → worker_status', () => {
    const r = classifyExecutiveIntent('What is CodeX working on?');
    expect(r?.intent).toBe('worker_status');
    expect(r?.capability.id).toBe('codex');
  });

  // P4 — explicit task creation must WIN over the investigation fall-through.
  it('Create a task for Hermes to inspect the backend tests → worker_delegation (hermes)', () => {
    const r = classifyExecutiveIntent('Create a task for Hermes to inspect the backend tests');
    expect(r?.intent).toBe('worker_delegation');
    expect(r?.workerKind).toBe('hermes');
  });

  it('Add a task for CodeX to review the UI → worker_delegation (codex)', () => {
    const r = classifyExecutiveIntent('Add a task for CodeX to review the UI');
    expect(r?.intent).toBe('worker_delegation');
    expect(r?.workerKind).toBe('codex');
  });

  it('Queue a task for Hermes to trace the startup path → worker_delegation (hermes)', () => {
    const r = classifyExecutiveIntent('Queue a task for Hermes to trace the startup path');
    expect(r?.intent).toBe('worker_delegation');
    expect(r?.workerKind).toBe('hermes');
  });

  // P4 — discussion/evaluation must NEVER delegate without execution intent.
  it('I am thinking about adding a recruiting agent → null (discussion stays direct)', () => {
    const r = classifyExecutiveIntent('I am thinking about adding a recruiting agent. What do you think?');
    expect(r).toBeNull();
  });

  it('Dont implement it. Just explain your reasoning → null (no delegation)', () => {
    const r = classifyExecutiveIntent("Don't implement it. Just explain your reasoning.");
    expect(r).toBeNull();
  });

  it('What model are you using? → null (Jarvis direct conversation)', () => {
    const r = classifyExecutiveIntent('What model are you using?');
    expect(r).toBeNull();
  });

  it('Ask Hermes to inspect the Boards integration → worker_delegation with read-only constraint', () => {
    const r = classifyExecutiveIntent('Ask Hermes to inspect the Boards integration');
    expect(r?.intent).toBe('worker_delegation');
    expect(r?.capability.id).toBe('hermes');
    expect(r?.workerKind).toBe('hermes');
  });

  it('Ask Hermes to inspect src/components/jarvis/JarvisCore.tsx. Do not modify files. → read-only delegation', () => {
    const r = classifyExecutiveIntent('Ask Hermes to inspect src/components/jarvis/JarvisCore.tsx. Do not modify files.');
    expect(r?.intent).toBe('worker_delegation');
    expect(r?.readOnly).toBe(true);
    expect(r?.workerKind).toBe('hermes');
  });

  it('Tell CodeX to implement the approved fix → worker_delegation (not read-only)', () => {
    const r = classifyExecutiveIntent('Tell CodeX to implement the approved fix');
    expect(r?.intent).toBe('worker_delegation');
    expect(r?.capability.id).toBe('codex');
    expect(r?.readOnly).toBeFalsy();
  });

  it('Open CodeX → navigation', () => {
    const r = classifyExecutiveIntent('Open CodeX');
    expect(r?.intent).toBe('navigation');
    expect(r?.capability.route).toBe('/codex');
  });

  it('show me the task board → board_query', () => {
    const r = classifyExecutiveIntent('show me the task board');
    expect(r?.intent).toBe('board_query');
    expect(r?.capability.id).toBe('boards');
  });

  it('what do you remember → memory_query', () => {
    const r = classifyExecutiveIntent('what do you remember from my preferences?');
    expect(r?.intent).toBe('memory_query');
    expect(r?.capability.id).toBe('memory');
  });

  it('bare "please remember that" context statement does NOT route to memory (runtime fix)', () => {
    const r = classifyExecutiveIntent('My favorite color is teal. Please remember that for this conversation.');
    expect(r).toBeNull();
  });

  it('create a daily automation → automation_request', () => {
    const r = classifyExecutiveIntent('create a daily automation for briefings');
    expect(r?.intent).toBe('automation_request');
    expect(r?.capability.id).toBe('automations');
  });

  it('low-confidence generic question about a worker does NOT delegate', () => {
    // "what is CodeX" with no verb — must not create a task.
    const r = classifyExecutiveIntent('what is CodeX');
    expect(r?.intent).not.toBe('worker_delegation');
  });

  it('plain conversation with no capability mention is untouched', () => {
    expect(mentionsInternalCapability('What is the weather like?')).toBe(false);
    expect(classifyExecutiveIntent('What is the weather like?')).toBeNull();
  });

  it('explicit delegation overrides explanation verbs', () => {
    // "Ask Hermes to explain..." is a delegation, not a status question.
    const r = classifyExecutiveIntent('Ask Hermes to explain the voice pipeline');
    expect(r?.intent).toBe('worker_delegation');
    expect(r?.capability.id).toBe('hermes');
  });

  it('acceptance pipeline phrase → revenue_pipeline (creates a task)', () => {
    const r = classifyExecutiveIntent(
      'Find three roofing businesses in Berlin with weak websites. Audit them, rank the opportunities, and prepare a staged rebuild concept and proposal for the strongest candidate. Do not contact anyone and do not publish anything.'
    );
    expect(r?.intent).toBe('revenue_pipeline');
    expect(r?.capability.id).toBe('revenue_pipeline');
    expect(r?.workerKind).toBe('revenue');
  });

  it('explicit worker delegation is NOT hijacked by pipeline detection', () => {
    const r = classifyExecutiveIntent('Ask Hermes to audit the revenue pipeline code');
    expect(r?.intent).toBe('worker_delegation');
    expect(r?.capability.id).toBe('hermes');
  });

  it('status query about the pipeline does NOT create a task', () => {
    const r = classifyExecutiveIntent('How is the revenue pipeline doing?');
    expect(r?.intent).toBe('worker_status');
    expect(r?.capability.id).toBe('revenue_pipeline');
  });

  it('explain the revenue pipeline → direct_explanation (no task)', () => {
    const r = classifyExecutiveIntent('Explain the revenue pipeline');
    expect(r?.intent).toBe('direct_explanation');
    expect(r?.capability.id).toBe('revenue_pipeline');
  });

  it('live-mode pipeline request still classifies as revenue_pipeline', () => {
    const r = classifyExecutiveIntent(
      'Find 5 real roofing businesses in Berlin with publicly accessible websites. Audit and rank them. Build a staged website concept and proposal for the strongest candidate. Do not contact anyone, publish anything, or spend money.'
    );
    expect(r?.intent).toBe('revenue_pipeline');
    expect(r?.workerKind).toBe('revenue');
  });

  it('short revenue prompts classify as revenue_pipeline (never ambiguous clarification)', () => {
    for (const prompt of [
      'find roofing businesses',
      'Find 5 real roofing businesses in Berlin',
      'audit roofing businesses',
      'discover plumbers in Hamburg',
    ]) {
      const r = classifyExecutiveIntent(prompt);
      expect(r?.intent, prompt).toBe('revenue_pipeline');
      expect(r?.workerKind).toBe('revenue');
    }
  });

  it('revenue prompt with niche/city/count is a task request, not clarification', () => {
    // The classifier must not emit any clarification intent for a complete
    // revenue request; the intake-level missing-field check (not the generic
    // routing clarification) is the only permitted clarification.
    const r = classifyExecutiveIntent('Find 5 real roofing businesses in Berlin');
    expect(r?.intent).toBe('revenue_pipeline');
    expect(r).not.toHaveProperty('reason', 'Ambiguous short prompt requires clarification');
  });

  it('status question during a revenue run does not create a revenue task', () => {
    const r = classifyExecutiveIntent('What is CodeX doing?');
    expect(r?.intent).not.toBe('revenue_pipeline');
    expect(r?.intent).not.toBe('worker_delegation');
  });

  it('live-mode pipeline request still classifies as revenue_pipeline (original)', () => {
    const r = classifyExecutiveIntent('Find five roofing businesses in Berlin. Live mode. Do contact them.');
    expect(r?.intent).toBe('revenue_pipeline');
  });

  it('full live-system health inspection falls through to routeIntent (null → INVESTIGATE)', () => {
    const r = classifyExecutiveIntent(
      'Jarvis, perform a read-only AgenticOS health inspection.\nCheck active model/provider, frontend model/provider, Hermes, Ollama, OpenRouter, failed operations and backend errors.\nDo not change anything.'
    );
    expect(r).toBeNull();
  });

  it('single-worker live health checks also fall through to INVESTIGATE', () => {
    expect(classifyExecutiveIntent('Check Hermes, Ollama, and OpenRouter health.')).toBeNull();
    expect(classifyExecutiveIntent('Check Hermes health.')).toBeNull();
  });

  it('informational status questions stay worker_status', () => {
    const r = classifyExecutiveIntent('How is Hermes doing?');
    expect(r?.intent).toBe('worker_status');
  });

  it('explicit delegation + navigation still win over the live-investigation fall-through', () => {
    expect(classifyExecutiveIntent('Ask Hermes to inspect the gateway health')?.intent).toBe('worker_delegation');
    expect(classifyExecutiveIntent('Open CodeX')?.intent).toBe('navigation');
    expect(classifyExecutiveIntent('Give me feedback regarding CodeX')?.intent).toBe('worker_feedback');
  });

  it('worker-as-OBJECT health checks fall through to INVESTIGATE even with "tell me"', () => {
    const r = classifyExecutiveIntent('Check Hermes, Ollama, OpenRouter and the frontend model display. Tell me only if something is wrong.');
    expect(r).toBeNull();
    expect(classifyExecutiveIntent('Check Hermes health.')).toBeNull();
    // Explicit worker-target cue still delegates.
    expect(classifyExecutiveIntent('Ask Hermes to inspect intentRouter.ts.')?.intent).toBe('worker_delegation');
  });
});
