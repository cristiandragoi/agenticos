import { describe, it, expect } from 'vitest';
import { intentRouter, isConversationalFeedback } from '../domains/jarvis/intentRouter.js';
import { classifyExecutiveIntent, isReadOnlyConstraint } from '../domains/jarvis/executiveIntent.js';
import { sanitizeMarkdownForSpeech } from '../utils/speechSanitizer.js';
import { buildConversationalAcknowledgement } from '../domains/jarvis/conversationalAck.js';

describe('P0 FIX 1 — Negative constraint routing', () => {
  it('does not route read-only analysis as repository_change / mutation workflow', async () => {
    const prompt = 'Jarvis analyze the AgenticOS repo, list the top5 production blockers, rank them, and propose a plan. Do not change any code.';
    const result = await intentRouter.routeIntent(prompt);
    
    expect(result.route).toBe('codex');
    expect(result.category).toBe('repository_analysis');
    expect(result.requiresApproval).toBe(false);
    expect(result.reason).toContain('Read-only');
  });

  it('correctly detects variations of read-only / negative constraints', () => {
    const variations = [
      'do not change any code',
      'don\'t change the code',
      'do not modify code',
      'do not edit the codebase',
      'do not touch any code',
      'without changing code',
      'without modifying anything',
      'no code changes',
      'no changes',
      'analysis only',
      'read only',
      'read-only',
    ];

    for (const v of variations) {
      expect(isReadOnlyConstraint(v)).toBe(true);
    }
  });

  it('does not trigger write verbs from negative clauses', async () => {
    const prompt = 'Inspect the server routing without modifying any code.';
    const result = await intentRouter.routeIntent(prompt);
    expect(result.category).not.toBe('repository_change');
    expect(result.requiresApproval).toBe(false);
  });
});

describe('P0 FIX 2 — Conversational feedback / meta-turn routing', () => {
  it('routes feedback about previous turns to direct conversation instead of pipeline_operation', async () => {
    const prompt = 'I give a task, but it approved and started, but it didn\'t reply to me like I want it.';
    const isFeedback = isConversationalFeedback(prompt);
    expect(isFeedback).toBe(true);

    const execIntent = classifyExecutiveIntent(prompt);
    expect(execIntent).toBeNull();

    const result = await intentRouter.routeIntent(prompt);
    expect(result.route).toBe('direct');
    expect(result.category).toBe('conversation');
  });

  it('detects conversational complaints and meta-feedback correctly', () => {
    const feedbacks = [
      'it didn\'t reply how I wanted',
      'that\'s not what I asked',
      'why did you do that',
      'I meant the previous task',
      'you started it but didn\'t answer me',
      'that response was wrong',
      'I don\'t like how that answered',
      'what happened with that task',
    ];

    for (const fb of feedbacks) {
      expect(isConversationalFeedback(fb)).toBe(true);
    }
  });

  it('preserves legitimate execution commands', async () => {
    const commands = [
      'start the task',
      'run the pipeline',
      'continue the project',
    ];

    for (const cmd of commands) {
      expect(isConversationalFeedback(cmd)).toBe(false);
      const result = await intentRouter.routeIntent(cmd);
      expect(result.route).not.toBe('direct');
    }
  });
});

describe('P0 FIX 3 — Markdown-to-speech normalization', () => {
  it('normalizes markdown bold, headings, bullets, and links for speech', () => {
    expect(sanitizeMarkdownForSpeech('**Access System Logs**')).toBe('Access System Logs');
    expect(sanitizeMarkdownForSpeech('__Access System Logs__')).toBe('Access System Logs');
    expect(sanitizeMarkdownForSpeech('### Step 1')).toBe('Step 1');
    expect(sanitizeMarkdownForSpeech('- Run tests')).toBe('Run tests');
    expect(sanitizeMarkdownForSpeech('[Open CodeX](#/codex)')).toBe('Open CodeX');
  });

  it('does not damage ordinary punctuation, identifiers, or paths', () => {
    expect(sanitizeMarkdownForSpeech('gpt-oss:20b')).toBe('gpt-oss:20b');
    expect(sanitizeMarkdownForSpeech('qwen3.5:cloud')).toBe('qwen3.5:cloud');
    expect(sanitizeMarkdownForSpeech('B:\\AgenticOS')).toBe('B:\\AgenticOS');
  });
});

describe('P0 FIX 4 — Executive acknowledgement during delegation', () => {
  it('generates natural conversational acknowledgements for read-only inspection', () => {
    const ack = buildConversationalAcknowledgement('Analyze the repo. Do not change code.', 'codex', true);
    expect(ack).toContain('inspect the repository without making changes');
  });

  it('generates natural conversational acknowledgements for CodeX mutation', () => {
    const ack = buildConversationalAcknowledgement('Fix the bug in server/src/routers/chat.ts', 'codex', false);
    expect(ack).toContain('delegating the implementation to CodeX');
  });

  it('generates natural conversational acknowledgements for Hermes planning', () => {
    const ack = buildConversationalAcknowledgement('Create a project plan for migration', 'hermes', false);
    expect(ack).toContain('sending this to Hermes for planning');
  });
});
