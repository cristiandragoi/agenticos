import { config } from 'dotenv';
import { loadGatewayConfig } from '../src/services/gateway/config.js';
import { CodeExecutor } from '../src/services/gateway/executor.js';

config(); // load .env

async function runDemo() {
  console.log('Loading Multi-Provider Gateway Config...');
  const cfg = loadGatewayConfig();
  console.log(`Provider order: ${cfg.providerOrder.join(' -> ')}`);
  
  const router = GatewayRouter.getInstance(cfg);
  console.log('Benchmarking providers on startup...');
  await router.benchmarkProviders();
  
  const projectId = 'demo-project-001';
  console.log(`Loading Workspace Memory for project: ${projectId}...`);
  const memoryManager = WorkspaceMemoryManager.getInstance(process.env.WORKSPACE_ROOT || './workspace', projectId);
  
  const executor = new CodeExecutor(cfg, projectId);
  
  console.log('\n--- Normal Execution (Attempts Omniroot first) ---');
  try {
    const objective = 'Generate a small React button component with styling.';
    const response = await executor.execute('task-1001', objective);
    
    console.log(`\nSuccess!`);
    console.log(`Provider: ${response.provider}`);
    console.log(`Model: ${response.model}`);
    console.log(`Reply Preview: ${response.reply.substring(0, 100)}...`);
  } catch (err: any) {
    console.error('Execution Failed:', err.message);
  }
  
  console.log('\n--- Forced Local Execution (Bypasses order, uses Ollama) ---');
  try {
    const objective = 'Summarize the architecture of a multi-provider gateway in one sentence.';
    const response = await executor.execute('task-1002', objective, { provider: 'ollama' });
    
    console.log(`\nSuccess!`);
    console.log(`Provider: ${response.provider}`);
    console.log(`Model: ${response.model}`);
    console.log(`Reply Preview: ${response.reply.substring(0, 100)}...`);
  } catch (err: any) {
    console.error('Execution Failed:', err.message);
  }
}

runDemo().catch(console.error);
