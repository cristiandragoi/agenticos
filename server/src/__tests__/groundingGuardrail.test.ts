import { describe, it, expect } from 'vitest';
import {
  isRepositorySpecificQuery,
  isModelIdentityQuery,
  isConversationalCorrection,
  containsUngroundedRepositoryClaims,
  getUngroundedGroundingStatement,
  sanitizeDirectResponse
} from '../domains/jarvis/groundingGuardrail.js';

describe('Grounding Guardrail', () => {
  it('identifies repository-specific queries correctly', () => {
    expect(isRepositorySpecificQuery('Jarvis, analyze the Agentic OS repo and tell me the five biggest production problems.')).toBe(true);
    expect(isRepositorySpecificQuery('What are the production blockers in this repo?')).toBe(true);
    expect(isRepositorySpecificQuery('Why did you list Llama 3.2 as a problem? Show me where you found it.')).toBe(true);
    expect(isRepositorySpecificQuery('What did Codex find in the codebase?')).toBe(true);
    expect(isRepositorySpecificQuery('Where is the bug located in the repository?')).toBe(true);

    expect(isRepositorySpecificQuery('Hello Jarvis, how are you?')).toBe(false);
    expect(isRepositorySpecificQuery('What model are you using?')).toBe(false);
    expect(isRepositorySpecificQuery('You said that already.')).toBe(false);
  });

  it('identifies model identity queries and conversational corrections', () => {
    expect(isModelIdentityQuery('What model are you using for this conversation?')).toBe(true);
    expect(isModelIdentityQuery('Which model are you running?')).toBe(true);
    expect(isConversationalCorrection('You said that already. Don\'t repeat it.')).toBe(true);
    expect(isConversationalCorrection('No need to repeat that.')).toBe(true);
  });

  it('prevents direct chat from inventing repository findings when no grounded evidence exists', () => {
    const prompt = 'Tell me the five biggest production problems in AgenticOS.';
    const hallucinatedReply = `The top 5 production blockers in the Agentic OS repository are:
1. **Insufficient memory allocation for worker processes** (Priority: High)
2. **Unresolved compatibility issues with Llama 3.2** (Priority: Medium)
3. **Incomplete code coverage for critical task paths** (Priority: Medium)
4. **Inadequate testing for edge cases** (Priority: Low)
5. **Unoptimized database queries for data retrieval** (Priority: Low)`;

    const sanitized = sanitizeDirectResponse(hallucinatedReply, {
      prompt,
      hasGroundedEvidence: false,
    });

    expect(sanitized).toBe(getUngroundedGroundingStatement());
    expect(sanitized).toContain('I need to inspect the repository or use the result from the delegated CodeX task before I can answer that accurately.');
  });

  it('allows responses when grounded evidence is present', () => {
    const prompt = 'What did Codex find?';
    const groundedReply = 'Based on the inspection of AGENTICOS_ARCHITECTURE_SPEC.md, CodeX identified missing core data models as the primary blocker.';

    const sanitized = sanitizeDirectResponse(groundedReply, {
      prompt,
      hasGroundedEvidence: true,
      groundedResult: groundedReply,
    });

    expect(sanitized).toBe(groundedReply);
  });

  it('strips appended repository blocker lists when answering model identity questions', () => {
    const prompt = 'What model are you using for this conversation?';
    const pollutedReply = `I'm running gpt-oss:20b via Ollama, with Llama 3.2 available locally as a fallback.

Top 5 production blockers in the AgenticOS repository are:
1. Insufficient memory allocation for worker processes (Priority: High)
2. Unresolved compatibility issues with Llama 3.2 (Priority: Medium)`;

    const sanitized = sanitizeDirectResponse(pollutedReply, {
      prompt,
      hasGroundedEvidence: false,
      isModelQuery: true,
    });

    expect(sanitized).toBe("I'm running gpt-oss:20b via Ollama, with Llama 3.2 available locally as a fallback.");
    expect(sanitized).not.toContain('Top 5 production blockers');
  });

  it('prevents list repetition on conversational corrections', () => {
    const prompt = 'You said that already. Don\'t repeat it.';
    const repeatedReply = `I apologize for the earlier repetition. The top 5 production blockers in the AgenticOS repository are:
1. Insufficient memory allocation for worker processes`;

    const sanitized = sanitizeDirectResponse(repeatedReply, {
      prompt,
      hasGroundedEvidence: false,
      isCorrection: true,
    });

    expect(sanitized).toBe('Understood. I will not repeat that. Let me know what you would like to focus on next.');
    expect(sanitized).not.toContain('Insufficient memory allocation');
  });
});
