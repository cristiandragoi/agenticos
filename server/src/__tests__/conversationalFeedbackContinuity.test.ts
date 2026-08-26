import { describe, it, expect } from 'vitest';
import { sanitizeDirectResponse } from '../domains/jarvis/groundingGuardrail.js';
import { contextToSystemPrompt, assembleConversationContext } from '../domains/jarvis/conversationContext.js';

describe('Conversational Feedback Continuity', () => {
  it('handles "You said that already. Don\'t repeat it." without repetition', () => {
    const prompt = "You said that already. Don't repeat it.";
    const hallucinatedRepetition = `I apologize for the earlier repetition. The top 5 production blockers in the AgenticOS repository are:
1. **Insufficient memory allocation for worker processes**
2. **Unresolved compatibility issues with Llama 3.2**`;

    const sanitized = sanitizeDirectResponse(hallucinatedRepetition, {
      prompt,
      hasGroundedEvidence: false,
      isCorrection: true,
    });

    expect(sanitized).toBe('Understood. I will not repeat that. Let me know what you would like to focus on next.');
    expect(sanitized).not.toContain('production blockers');
  });

  it('handles "It didn\'t reply how I wanted" with active task state instead of hallucinating', () => {
    const mockCtx = {
      conversationId: 'conv-123',
      currentPrompt: "It didn't reply how I wanted.",
      recentTurns: [],
      previousWasClarification: false,
      workspaceRoot: 'B:\\AgenticOS',
      activeTask: {
        id: 'goal-1e01833a',
        worker: 'codex',
        status: 'running',
        title: 'Jarvis analyze the Agentic OS repo and tell me the five biggest production problems.'
      },
      recentTask: null,
      providers: { provider: 'openrouter', model: 'auto', fallbackProvider: 'ollama', fallbackModel: 'llama3.2:3b' },
      capabilities: '',
      approvalMode: 'manual' as const,
      activeProject: null,
      hasGroundedEvidence: false,
    };

    const promptText = contextToSystemPrompt(mockCtx, { includeOperational: true });
    expect(promptText).toContain('codex is currently running');
    expect(promptText).toContain('Do not guess what it will find.');
  });

  it('verifies non-existent claims like "Llama 3.2" against grounded findings', () => {
    const groundedFindings = `# Real CodeX Findings
1. Missing core data persistence layer.
2. Absence of runtime state normalization.`;

    const prompt = 'Why did you list Llama 3.2 as a problem? Show me where you found it.';
    // If model tries to invent a file location for Llama 3.2 when it was never in grounded findings
    const fabricatedExplanation = 'I found the Llama 3.2 issue in server/src/routers/llm.ts on line 45.';
    
    // In direct chat without grounded evidence of Llama 3.2
    const sanitized = sanitizeDirectResponse(fabricatedExplanation, {
      prompt,
      hasGroundedEvidence: false,
      groundedResult: groundedFindings,
    });

    // When the claim is not supported by grounded evidence, guardrail prompts for inspection
    expect(sanitized).toContain('I need to inspect the repository or use the result from the delegated CodeX task');
  });

  it('serves grounded evidence accurately for "What did Codex find?"', () => {
    const groundedFindings = `# Real CodeX Findings
1. Missing core data persistence layer.
2. Absence of runtime state normalization.`;

    const prompt = 'What did Codex find?';
    const truthfulReply = `Based on CodeX's inspection:\n1. Missing core data persistence layer.\n2. Absence of runtime state normalization.`;

    const sanitized = sanitizeDirectResponse(truthfulReply, {
      prompt,
      hasGroundedEvidence: true,
      groundedResult: groundedFindings,
    });

    expect(sanitized).toBe(truthfulReply);
  });
});
