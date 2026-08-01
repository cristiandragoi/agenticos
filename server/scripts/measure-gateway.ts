import { performance } from 'perf_hooks';
import { loadGatewayConfig } from '../src/services/gateway/config.js';
import { GatewayRouter } from '../src/services/gateway/router.js';
import { CodeExecutor } from '../src/services/gateway/executor.js';
import fs from 'fs';
import path from 'path';

async function measure() {
  console.log('--- Benchmarking Gateway ---');
  
  // 1. Idle Memory & Startup Overhead
  const memBefore = process.memoryUsage();
  const t0 = performance.now();
  
  const config = loadGatewayConfig();
  const router = GatewayRouter.getInstance(config);
  
  const t1 = performance.now();
  const memAfter = process.memoryUsage();
  
  console.log(`Startup Overhead: ${(t1 - t0).toFixed(3)} ms`);
  console.log(`Idle Memory Increase (Heap Used): ${((memAfter.heapUsed - memBefore.heapUsed) / 1024).toFixed(2)} KB`);
  
  // 2. Routing Overhead (mocking fetch)
  // We will override the chat method of Omniroot to just return immediately
  const omniroot = (router as any).providers.get('omniroot');
  const originalChat = omniroot.chat.bind(omniroot);
  omniroot.chat = async () => { return { reply: 'mock', provider: 'omniroot', model: 'mock', offline: false }; };
  
  const t2 = performance.now();
  await router.chat({ requestId: 'bench-1', prompt: 'test' }, { provider: 'omniroot' });
  const t3 = performance.now();
  
  console.log(`Routing Overhead (Router logic only): ${(t3 - t2).toFixed(3)} ms`);
  
  // Restore
  omniroot.chat = originalChat;

  // 3. Disk Writes (Executor)
  const logsPath = config.logsPath;
  const metricsPath = path.join(path.dirname(logsPath), 'gateway-metrics.json');
  
  let initialLogSize = fs.existsSync(logsPath) ? fs.statSync(logsPath).size : 0;
  let initialMetricsSize = fs.existsSync(metricsPath) ? fs.statSync(metricsPath).size : 0;

  const executor = new CodeExecutor(config, 'bench-project');
  
  // Mock the router in executor
  const execRouter = (executor as any).router;
  const originalRouterChat = execRouter.chat.bind(execRouter);
  execRouter.chat = async () => { 
    execRouter.emit({ type: 'gateway.completed', provider: 'omniroot', requestId: 'bench-2', latencyMs: 10, fallbackCount: 0 });
    return { reply: 'mock', provider: 'omniroot', model: 'mock', offline: false }; 
  };
  
  await executor.execute('bench-2', 'bench objective');
  
  let newLogSize = fs.existsSync(logsPath) ? fs.statSync(logsPath).size : 0;
  let newMetricsSize = fs.existsSync(metricsPath) ? fs.statSync(metricsPath).size : 0;
  
  console.log(`Additional Disk Writes per request (Logs): ${newLogSize - initialLogSize} bytes`);
  console.log(`Additional Disk Writes per request (Metrics): ${newMetricsSize - initialMetricsSize} bytes (rewritten)`);
}

measure().catch(console.error);
