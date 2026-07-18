import { conversationService } from '../conversations/service.js';
import { intentRouter } from './intentRouter.js';
import { codexService } from '../codex/service.js';
import { llmChat } from '../../services/llmGateway.js';

export class JarvisOrchestrator {
  
  async handleMessage(conversationId: string, prompt: string, workspacePath: string, approvalPolicy: 'manual' | 'auto') {
    // 1. Append user message
    await conversationService.appendMessage({
      conversationId,
      role: 'user',
      content: prompt
    });

    // 2. Route intent
    const intent = await intentRouter.routeIntent(prompt);

    // Append routing event
    await conversationService.appendMessage({
      conversationId,
      role: 'system',
      messageType: 'routing_event',
      content: `Intent routed to ${intent.route.toUpperCase()} (Confidence: ${(intent.confidence * 100).toFixed(0)}%) - ${intent.reason}`,
      metadata: { intent }
    });

    // 3. Dispatch
    switch (intent.route) {
      case 'codex':
        return this.handleCodex(conversationId, prompt, workspacePath, approvalPolicy);
      case 'hermes':
        return this.handleHermes(conversationId, prompt);
      case 'memory':
        return this.handleMemory(conversationId, prompt);
      case 'clarification_required':
        return this.handleClarification(conversationId, prompt);
      case 'direct':
      default:
        return this.handleDirect(conversationId, prompt);
    }
  }

  private async handleCodex(conversationId: string, prompt: string, workspacePath: string, approvalPolicy: 'manual' | 'auto') {
    try {
      const goalId = await codexService.createGoal(prompt, workspacePath, approvalPolicy);
      
      await conversationService.appendMessage({
        conversationId,
        role: 'system',
        messageType: 'system_status',
        content: `CodeX Goal initialized: ${goalId}. Generating plan...`,
        goalId
      });

      return { goalId, route: 'codex' };
    } catch (err: any) {
      await conversationService.appendMessage({
        conversationId,
        role: 'system',
        messageType: 'error',
        content: `Failed to initialize CodeX Goal: ${err.message}`
      });
    }
  }

  private async handleHermes(conversationId: string, prompt: string) {
    // Block: Hermes does not have a canonical backend execution engine yet.
    await conversationService.appendMessage({
      conversationId,
      role: 'system',
      messageType: 'error',
      content: 'Hermes execution engine is currently offline/unavailable in this environment.'
    });
    return { route: 'hermes', status: 'unavailable' };
  }

  private async handleMemory(conversationId: string, prompt: string) {
    await conversationService.appendMessage({
      conversationId,
      role: 'system',
      messageType: 'error',
      content: 'Memory indexing service is currently offline.'
    });
    return { route: 'memory', status: 'unavailable' };
  }

  private async handleDirect(conversationId: string, prompt: string) {
    try {
      const systemPrompt = `You are Jarvis, the core orchestration agent of Agentic OS. Keep answers short, direct, and conversational.`;
      const result = await llmChat({ systemPrompt, prompt });

      await conversationService.appendMessage({
        conversationId,
        role: 'agent',
        content: result.reply,
        routedAgent: 'jarvis'
      });
      return { route: 'direct' };
    } catch (err: any) {
      await conversationService.appendMessage({
        conversationId,
        role: 'system',
        messageType: 'error',
        content: `Direct chat failed: ${err.message}`
      });
    }
  }
  private async handleClarification(conversationId: string, prompt: string) {
    await conversationService.appendMessage({
      conversationId,
      role: 'agent',
      content: 'Could you please clarify your request? I want to make sure I route it to the correct subsystem (CodeX for engineering, Hermes for project tracking, or just a direct chat).',
      routedAgent: 'jarvis'
    });
    return { route: 'clarification_required' };
  }
}

export const jarvisOrchestrator = new JarvisOrchestrator();
