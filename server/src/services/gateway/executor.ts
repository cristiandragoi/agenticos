import { GatewayConfig, ChatRequest } from './types.js';
import { GatewayRouter } from './router.js';
import { WorkspaceMemoryManager } from './memory.js';
import { GatewayRunLedger } from './ledger.js';

export class CodeExecutor {
  private router: GatewayRouter;
  private memoryManager: WorkspaceMemoryManager;
  private ledger: GatewayRunLedger;

  constructor(config: GatewayConfig, projectId: string) {
    this.router = GatewayRouter.getInstance(config);
    this.memoryManager = WorkspaceMemoryManager.getInstance(config.workspaceRoot, projectId);
    this.ledger = new GatewayRunLedger(config.logsPath);
    
    // Bind ledger tracking
    this.router.onEvent((event) => {
      if (event.type === 'gateway.completed' || event.type === 'gateway.failed') {
         this.ledger.record({
           taskId: event.requestId || 'unknown',
           provider: event.provider,
           fallbackAttempts: event.fallbackCount || 0,
           latencyMs: event.latencyMs || 0,
           model: 'unknown', // can be populated from response
           status: event.type === 'gateway.completed' ? 'success' : 'failure',
           responseMetadata: { error: event.error }
         });
      }
    });
  }

  public async execute(taskId: string, objective: string, overrides?: { provider?: string }) {
    const memory = this.memoryManager.getMemory();

    // 1. Prompt Normalization
    const req: ChatRequest = {
      requestId: taskId,
      prompt: objective,
      taskObjective: objective,
      projectPath: memory.projectPath,
      projectSummary: memory.projectSummary,
      systemPrompt: `You are a helpful coding assistant. You are working in ${memory.projectPath}.\nSummary: ${memory.projectSummary}`
    };

    // 2. Select Provider & Execute
    try {
      const response = await this.router.chat(req, overrides);
      
      // 3. Save artifacts or snippets based on response (stub implementation)
      this.memoryManager.addHistory({ taskId, provider: response.provider, success: true });
      
      return response;
    } catch (err: any) {
      this.memoryManager.addHistory({ taskId, success: false, error: err.message });
      throw err;
    }
  }
}
