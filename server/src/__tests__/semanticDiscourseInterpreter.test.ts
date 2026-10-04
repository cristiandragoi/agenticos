import { describe, it, expect, beforeEach } from 'vitest';
import {
  validateStructuredIntent,
  type StructuredIntent,
} from '../domains/controlPlane/StructuredIntent.js';
import {
  AuthoritativeIntentCompiler,
  type IntentCompilerContext,
} from '../domains/controlPlane/AuthoritativeIntentCompiler.js';
import {
  semanticDiscourseInterpreter,
} from '../domains/controlPlane/SemanticDiscourseInterpreter.js';

describe('SemanticDiscourseInterpreter & StructuredIntent Suite', () => {
  beforeEach(() => {
    semanticDiscourseInterpreter.setMockProvider(null);
    semanticDiscourseInterpreter.setExecutionMode('AUTHORITATIVE');
  });

  describe('1. Deterministic StructuredIntent Validation', () => {
    it('accepts a valid StructuredIntent with allowed action and bounded count', () => {
      const intent: StructuredIntent = {
        schemaVersion: '1',
        turnType: 'COMMAND',
        confidence: 0.95,
        userGoal: 'Read 4 messages in Telegram',
        steps: [
          {
            action: 'READ_MESSAGES',
            application: 'Telegram',
            target: 'Agentic OS bot',
            entityCount: 4,
          },
        ],
      };

      const res = validateStructuredIntent(intent);
      expect(res.valid).toBe(true);
      expect(res.validatedIntent?.steps?.[0].entityCount).toBe(4);
    });

    it('rejects invalid schemaVersion', () => {
      const intent = {
        schemaVersion: '2',
        turnType: 'COMMAND',
        confidence: 0.9,
        steps: [{ action: 'CONVERSATIONAL' }],
      };

      const res = validateStructuredIntent(intent);
      expect(res.valid).toBe(false);
      expect(res.error).toBe('INVALID_SCHEMA_VERSION');
    });

    it('rejects invalid entityCount (<1 or >100)', () => {
      const intent: StructuredIntent = {
        schemaVersion: '1',
        turnType: 'COMMAND',
        confidence: 0.9,
        steps: [
          {
            action: 'READ_MESSAGES',
            application: 'Telegram',
            entityCount: 500,
          },
        ],
      };

      const res = validateStructuredIntent(intent);
      expect(res.valid).toBe(false);
      expect(res.error).toBe('INVALID_ENTITY_COUNT');
    });

    it('rejects invented verified entities when context has no verified read', () => {
      const intent: StructuredIntent = {
        schemaVersion: '1',
        turnType: 'COMMAND',
        confidence: 0.9,
        referents: [
          {
            expression: 'them',
            resolvedType: 'VERIFIED_ENTITY',
            confidence: 0.9,
          },
        ],
        steps: [
          {
            action: 'READ_MESSAGES',
            useVerifiedPreviousResult: true,
          },
        ],
      };

      const res = validateStructuredIntent(intent, { conversationId: 'empty-conv' });
      expect(res.valid).toBe(false);
      expect(res.error).toBe('UNVERIFIED_REFERENT_INVENTED');
    });

    it('sanitizes physical steps in venting/complaints without explicit directives', () => {
      const intent: StructuredIntent = {
        schemaVersion: '1',
        turnType: 'VENTING_OR_META',
        confidence: 0.9,
        userGoal: 'Complaining about URL message',
        steps: [
          {
            action: 'NAVIGATE_WEB',
            url: 'https://www.youtube.com',
            target: 'YouTube',
          },
        ],
      };

      const res = validateStructuredIntent(intent);
      expect(res.valid).toBe(true);
      expect(res.validatedIntent?.steps?.[0].action).toBe('CONVERSATIONAL');
    });
  });

  describe('2. Authoritative Intent Compilation from StructuredIntent', () => {
    it('compiles multi-step compound intent (Chrome + YouTube) with SEMANTIC_LLM tag', () => {
      const intent: StructuredIntent = {
        schemaVersion: '1',
        turnType: 'COMMAND',
        confidence: 0.98,
        userGoal: 'Open Chrome and go to YouTube',
        steps: [
          {
            action: 'OPEN_APPLICATION',
            application: 'Chrome',
          },
          {
            action: 'NAVIGATE_WEB',
            application: 'Chrome',
            target: 'YouTube',
            url: 'https://www.youtube.com',
          },
        ],
      };

      const plan = AuthoritativeIntentCompiler.compileFromStructuredIntent(
        intent,
        'open google chrome and go to youtube'
      );

      expect(plan.isCompound).toBe(true);
      expect(plan.steps.length).toBe(2);
      expect(plan.steps[0].action).toBe('OPEN_APPLICATION');
      expect(plan.steps[0].application).toBe('Chrome');
      expect(plan.steps[0].interpretationPath).toBe('SEMANTIC_LLM');

      expect(plan.steps[1].action).toBe('NAVIGATE_WEB');
      expect(plan.steps[1].contentRequest).toBe('https://www.youtube.com');
      expect(plan.steps[1].interpretationPath).toBe('SEMANTIC_LLM');
    });

    it('compiles CAUSAL_QUERY into EXPLAIN_PREVIOUS_OUTCOME step', () => {
      const intent: StructuredIntent = {
        schemaVersion: '1',
        turnType: 'CAUSAL_QUERY',
        confidence: 0.95,
        userGoal: "Why didn't that work?",
        steps: [{ action: 'CONVERSATIONAL' }],
      };

      const plan = AuthoritativeIntentCompiler.compileFromStructuredIntent(
        intent,
        "Why didn't that work?"
      );

      expect(plan.steps.length).toBe(1);
      expect(plan.steps[0].action).toBe('CONVERSATIONAL');
      expect(plan.steps[0].interpretationPath).toBe('SEMANTIC_LLM');
      expect(plan.steps[0].reason).toContain("Causal intent resolution: Why didn't that work?");
    });
  });

  describe('3. SemanticDiscourseInterpreter Modes & Fallbacks', () => {
    it('executes fallback plan and records shadow diff in SHADOW mode', async () => {
      semanticDiscourseInterpreter.setExecutionMode('SHADOW');

      semanticDiscourseInterpreter.setMockProvider(async () => ({
        schemaVersion: '1',
        turnType: 'COMMAND',
        confidence: 0.99,
        steps: [
          {
            action: 'OPEN_APPLICATION',
            application: 'Chrome',
          },
        ],
      }));

      const res = await semanticDiscourseInterpreter.interpret('open Chrome');
      expect(res.interpretationPath).toBe('DETERMINISTIC_FALLBACK');
      expect(res.shadowDiff).toBeDefined();
      expect(res.shadowDiff?.transcript).toBe('open Chrome');
      expect(res.shadowDiff?.currentCompilerAction).toBe('OPEN_APPLICATION');
      expect(res.shadowDiff?.semanticAction).toBe('OPEN_APPLICATION');
      expect(res.shadowDiff?.disagreementCategory).toBe('NONE');
    });

    it('switches to SEMANTIC_LLM plan in AUTHORITATIVE mode', async () => {
      semanticDiscourseInterpreter.setExecutionMode('AUTHORITATIVE');

      semanticDiscourseInterpreter.setMockProvider(async () => ({
        schemaVersion: '1',
        turnType: 'COMMAND',
        confidence: 0.98,
        steps: [
          {
            action: 'CAMERA_OBSERVE',
          },
        ],
      }));

      const res = await semanticDiscourseInterpreter.interpret('can you see me');
      expect(res.interpretationPath).toBe('SEMANTIC_LLM');
      expect(res.plan.steps[0].action).toBe('CAMERA_OBSERVE');
      expect(res.plan.steps[0].interpretationPath).toBe('SEMANTIC_LLM');
    });

    it('falls back cleanly to DETERMINISTIC_FALLBACK if model returns null or errors', async () => {
      semanticDiscourseInterpreter.setExecutionMode('AUTHORITATIVE');
      semanticDiscourseInterpreter.setMockProvider(async () => null);

      const res = await semanticDiscourseInterpreter.interpret('open Chrome');
      expect(res.interpretationPath).toBe('DETERMINISTIC_FALLBACK');
      expect(res.plan.steps[0].action).toBe('OPEN_APPLICATION');
    });
  });
});
