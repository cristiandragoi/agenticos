import { describe, it, expect } from 'vitest';
import {
  isFastConversationRequest,
  buildFastConversationSystemPrompt,
  validateGroundedSocialProof,
  FAST_CONVERSATION_MODEL
} from '../domains/jarvis/fastConversationLane.js';

describe('Fast Conversation Lane — Unit & Routing Verification', () => {
  it('default model is the warmed Jarvis Ollama model', () => {
    expect(FAST_CONVERSATION_MODEL).toBe('qwen3.5:9b-hermes-64k');
  });

  describe('isFastConversationRequest classification', () => {
    it('classifies ordinary grounded informational inquiries as FAST', () => {
      const fastPrompts = [
        'Tell me about the Notion template.',
        'Tell me about this opportunity.',
        'What evidence supports it?',
        'What verified customer interview evidence do we have?',
        'How much revenue do we estimate?',
        'What should happen next?',
        'Explain that more simply.',
        'Okay, explain this more simply.',
        'What are we missing?',
        'Can you describe this product bundle?'
      ];

      for (const p of fastPrompts) {
        const res = isFastConversationRequest(p);
        expect(res.isFast, `Expected "${p}" to be fast conversation`).toBe(true);
      }
    });

    it('classifies operational, execution, delegation, and action commands as SUPERVISOR (not fast)', () => {
      const supervisorPrompts = [
        'Start working on this opportunity.',
        'Start the Revenue Operator mission.',
        'Execute this plan now.',
        'Build a landing page for the template.',
        'Deploy the changes to production.',
        'Delegate this task to Hermes.',
        'Ask CodeX to inspect the codebase.',
        'Fix the bug in the checkout flow.',
        'Create a marketing strategy plan.',
        'Stop the current task.',
        'Check system health and running tasks.'
      ];

      for (const p of supervisorPrompts) {
        const res = isFastConversationRequest(p);
        expect(res.isFast, `Expected "${p}" to NOT be fast conversation`).toBe(false);
      }
    });
  });

  describe('buildFastConversationSystemPrompt', () => {
    it('assembles a clean lightweight prompt without tool schemas or delegation bloat', () => {
      const prompt = buildFastConversationSystemPrompt({
        activeModule: 'revenue-operator',
        entityContext: '## CURRENTLY REFERENCED REVENUE OPERATOR ENTITY\nid: opp-dfd16cad-',
        workspacePath: 'D:\\AgenticOS'
      });

      expect(prompt).toContain('You are Jarvis, the fast conversational assistant');
      expect(prompt).toContain('ACTIVE MODULE: revenue-operator');
      expect(prompt).toContain('opp-dfd16cad-');
      expect(prompt).toContain('STORED FACT');
      expect(prompt).toContain('MISSING DATA');

      // Crucial: Must NOT contain tool schemas or delegation instructions
      expect(prompt).not.toContain('<tool_call>');
      expect(prompt).not.toContain('delegate_hermes_task');
      expect(prompt).not.toContain('delegate_codex_goal');
      expect(prompt).not.toContain('get_system_health');
      expect(prompt).not.toContain('You delegate implementation and debugging to CodeX');

      // Crucial: Must contain prohibition on unsupported social proof & grounded inference rule
      expect(prompt).toContain('ABSOLUTE PROHIBITION ON UNSUPPORTED SOCIAL PROOF');
      expect(prompt).toContain('A reasonable inference may ONLY be derived directly from an explicit stored fact');
    });
  });

  describe('Social Proof Grounding Regression Tests', () => {
    it('validateGroundedSocialProof passes for compliant grounded statements', () => {
      const compliantAnswers = [
        'There is no verified customer interview evidence recorded for this entity.',
        'The stored evidence states: High margin digital product with automated checkout delivery.',
        'The title positions the product for solopreneurs, but no interview records exist.',
        'We do not have any customer interview evidence recorded in the system.'
      ];

      for (const ans of compliantAnswers) {
        const res = validateGroundedSocialProof(ans);
        expect(res.valid, `Expected answer to be valid: "${ans}"`).toBe(true);
        expect(res.violations).toHaveLength(0);
      }
    });

    it('validateGroundedSocialProof explicitly FAILS on unsupported testimonials', () => {
      const unsupported = 'There are positive testimonials indicating improved organization.';
      const res = validateGroundedSocialProof(unsupported);
      expect(res.valid).toBe(false);
      expect(res.violations).toContain('testimonials');
    });

    it('validateGroundedSocialProof explicitly FAILS on unsupported user feedback', () => {
      const unsupported = 'Based on user feedback, solopreneurs find the templates helpful.';
      const res = validateGroundedSocialProof(unsupported);
      expect(res.valid).toBe(false);
      expect(res.violations).toContain('user feedback');
    });

    it('validateGroundedSocialProof explicitly FAILS on unsupported customer feedback or reviews', () => {
      const ans1 = 'Customer feedback suggests strong adoption.';
      expect(validateGroundedSocialProof(ans1).valid).toBe(false);
      expect(validateGroundedSocialProof(ans1).violations).toContain('customer feedback');

      const ans2 = 'Several reviews indicate good quality.';
      expect(validateGroundedSocialProof(ans2).valid).toBe(false);
      expect(validateGroundedSocialProof(ans2).violations).toContain('reviews');
    });

    it('validateGroundedSocialProof explicitly FAILS on users reporting claims', () => {
      const unsupported = 'Users report improved productivity after setup.';
      const res = validateGroundedSocialProof(unsupported);
      expect(res.valid).toBe(false);
      expect(res.violations).toContain('users reporting');
    });

    it('injects passive core memory, authoritative project priorities, and closed-world lane invariants', () => {
      const prompt = buildFastConversationSystemPrompt({
        activeModule: 'revenue-operator',
        entityContext: '## CURRENTLY REFERENCED REVENUE OPERATOR ENTITY\nid: opp-free-cash',
        workspacePath: 'D:\\AgenticOS',
        memoryContext: 'STRUCTURED CORE MEMORY:\nUser prefers concise replies.',
        projectContext: '## AUTHORITATIVE PROJECT & PRIORITY STATE\n- Active Project: Free Cash\n- Stored Project Priorities:\n  * Priority 1: Free Cash\n  * Priority 2: Shopify',
        dialogueContext: 'CURRENT DIALOGUE FOCUS: Entity "Free Cash"'
      });

      expect(prompt).toContain('STRUCTURED CORE MEMORY:\nUser prefers concise replies.');
      expect(prompt).toContain('AUTHORITATIVE PROJECT & PRIORITY STATE');
      expect(prompt).toContain('Priority 1: Free Cash');
      expect(prompt).toContain('Priority 2: Shopify');
      expect(prompt).toContain('CURRENT DIALOGUE FOCUS: Entity "Free Cash"');
      expect(prompt).toContain('AUTHORITY PRECEDENCE: AUTHORITATIVE CURRENT RUNTIME STATE');
      expect(prompt).toContain('CLOSED-WORLD TOOL & LANE RUNTIME');
      expect(prompt).toContain('The absence of a callable tool in this lane does NOT mean AgenticOS memory, terminal, or delegation tools are disconnected');
      expect(prompt).toContain('HISTORICAL CLAIM VERIFICATION: Past assistant statements about system/tool availability are not authoritative');
    });
  });
});
