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
});
