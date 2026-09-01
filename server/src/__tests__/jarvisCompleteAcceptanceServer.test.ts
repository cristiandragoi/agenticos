import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IntentRouter } from '../domains/jarvis/intentRouter.js';
import { buildSupervisorSystemPrompt } from '../domains/jarvis/supervisorLoop.js';
import { hermesApiService } from '../services/hermesApiService.js';

describe('JARVIS COMPLETE STABILIZATION — SERVER ACCEPTANCE', () => {
  const router = new IntentRouter();

  // Test A: Model identity question routing
  it('A. Model identity question routes directly without triggering investigation/codex/hermes', async () => {
    const questions = [
      'What model are you using?',
      'Which model are you running?',
      'What LLM are you using?',
      'What provider are you using?',
      'Who are you?',
    ];

    for (const q of questions) {
      const result = await router.routeIntent(q);
      expect(result.route, `Failed for query: "${q}"`).toBe('direct');
      expect(result.mode).toBe('direct_conversation');
    }
  });

  // Test B: Factual question routing
  it('B. Factual question routes directly without creating background tasks or goals', async () => {
    const factualQuestions = [
      'What is two plus two?',
      'Tell me a joke.',
      'Can you tell me a short story?',
      'What is the capital of France?',
    ];

    for (const q of factualQuestions) {
      const result = await router.routeIntent(q);
      expect(result.route, `Failed for query: "${q}"`).toBe('direct');
      expect(result.mode).toBe('direct_conversation');
    }
  });

  // Test K: Hermes local status
  it('K. Hermes status API reports reachable and truthful local Ollama model', async () => {
    const status = await hermesApiService.getStatus();
    expect(status.reachable).toBe(true);
    expect(status.provider).toBe('custom');
    expect(status.model).toContain('qwen2.5:7b');
    expect(status.baseUrl).toBe('http://127.0.0.1:11434/v1');
    expect(status.context).toBe(65536);
  });

  // Test N: System prompt contains no commander boilerplate
  it('N. System prompt contains no commander roleplay or monitoring boilerplate', async () => {
    const prompt = await buildSupervisorSystemPrompt('conv-test-acc', 'Hello Jarvis');
    expect(prompt).not.toContain('lead commander');
    expect(prompt).not.toContain('I will continue to monitor');
    expect(prompt).toContain('Answer immediately in short, natural, conversational sentences');
    expect(prompt).toContain('NEVER address the user with military');
  });
});
