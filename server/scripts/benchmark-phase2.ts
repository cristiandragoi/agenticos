import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.join(process.cwd(), '.env') });

const startupStart = Date.now();
import { loadGatewayConfig } from '../src/services/gateway/config.js';
import { GatewayRouter } from '../src/services/gateway/router.js';
import { GatewayShutdownManager } from '../src/services/gateway/shutdown.js';

import os from 'os';

async function runBenchmark() {
  console.log('=== PHASE 2: PERFORMANCE BENCHMARK ===\n');

  console.log('--- System Information ---');
  console.log(`OS: ${os.type()} ${os.release()} (${os.arch()})`);
  console.log(`Node.js Version: ${process.version}`);
  console.log(`CPUs: ${os.cpus().length} x ${os.cpus()[0].model}`);
  console.log(`Memory: ${Math.round(os.totalmem() / 1024 / 1024 / 1024)}GB\n`);

  const beforeMem = process.memoryUsage();
  
  const initStart = Date.now();
  const config = loadGatewayConfig();
  const router = GatewayRouter.getInstance(config);
  
  // Isolate providers so network fetch doesn't pollute routing logic overhead
  const isolatedRegistry = (router as any).registry;
  isolatedRegistry.providers.set('mock', {
    name: 'mock',
    chat: async () => ({ reply: 'ok', provider: 'mock' })
  });
  (router as any).config.providerOrder = ['mock'];
  
  const initLatency = Date.now() - initStart;

  const afterMem = process.memoryUsage();

  console.log(`Server Startup (File Load) Overhead: ${initStart - startupStart}ms`);
  console.log(`Gateway Initialization Latency: ${initLatency}ms`);
  console.log(`Idle Memory Increase (RSS): ${Math.round((afterMem.rss - beforeMem.rss) / 1024 / 1024)} MB`);

  console.log('\nMeasuring routing overhead (100 iterations)...');
  const samples: number[] = [];
  
  for (let i=0; i<100; i++) {
    const routeStart = performance.now();
    try {
      await router.chat({ prompt: 'test' });
    } catch {}
    samples.push(performance.now() - routeStart);
  }
  
  samples.sort((a, b) => a - b);
  const min = samples[0];
  const max = samples[samples.length - 1];
  const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
  const median = samples[Math.floor(samples.length / 2)];
  const p95 = samples[Math.floor(samples.length * 0.95)];

  console.log(`Min Latency: ${min.toFixed(2)}ms`);
  console.log(`Max Latency: ${max.toFixed(2)}ms`);
  console.log(`Average Latency: ${avg.toFixed(2)}ms`);
  console.log(`Median Latency: ${median.toFixed(2)}ms`);
  console.log(`P95 Latency: ${p95.toFixed(2)}ms`);

  console.log('\n=== BENCHMARK COMPLETE ===');
  await GatewayShutdownManager.getInstance().shutdown();
}

runBenchmark().catch(err => {
  console.error(err);
  process.exit(1);
});
