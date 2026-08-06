import { db } from '../db/index.js';
import { agentProviderAssignments } from '../db/schema.js';
import { GatewayRouter } from '../services/gateway/router.js';
import { loadGatewayConfig } from '../services/gateway/config.js';
import { GatewayConfigurationService } from '../services/gateway/configuration.js';
import fs from 'fs';
import path from 'path';

import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env'), override: true });

export interface DiagnosticCheckResult {
  id: string;
  status: 'passed' | 'warning' | 'failed' | 'skipped';
  summary: string;
  durationMs: number;
  details: any;
  recommendation?: string | null;
}

export interface DiagnosticReport {
  overallStatus: 'Healthy' | 'Degraded' | 'Broken';
  timestamp: string;
  checks: DiagnosticCheckResult[];
  firstFailingBoundary?: string;
  originalError?: any;
}

async function runDoctor() {
  console.log('Starting AgenticOS Doctor...');
  const checks: DiagnosticCheckResult[] = [];
  const startTime = Date.now();
  let overallStatus: 'Healthy' | 'Degraded' | 'Broken' = 'Healthy';

  function recordCheck(id: string, status: DiagnosticCheckResult['status'], summary: string, details: any = {}, recommendation: string | null = null) {
    checks.push({
      id,
      status,
      summary,
      durationMs: Date.now() - startTime,
      details,
      recommendation
    });
    if (status === 'failed') overallStatus = 'Broken';
    else if (status === 'warning' && overallStatus === 'Healthy') overallStatus = 'Degraded';
    console.log(`[${status.toUpperCase()}] ${id}: ${summary}`);
  }

  // 1. Database Check
  try {
    const assignments = await db.select().from(agentProviderAssignments).execute();
    recordCheck('DB_CONNECTION', 'passed', 'Database is reachable and schema is valid.');
    
    const codexAssignment = assignments.find(a => a.agentId === 'agent-codex');
    if (codexAssignment) {
      recordCheck('ASSIGNMENT_AGENT_CODEX', 'passed', `Found CodeX assignment: ${codexAssignment.providerId} (${codexAssignment.modelId})`, codexAssignment);
    } else {
      recordCheck('ASSIGNMENT_AGENT_CODEX', 'warning', 'No CodeX assignment found.', null, 'Set a provider assignment for CodeX in the UI.');
    }
  } catch (err: any) {
    recordCheck('DB_CONNECTION', 'failed', `Database connection or schema failed: ${err.message}`, err);
  }

  // Direct Ollama Check
  try {
    const res = await fetch('http://127.0.0.1:11434/api/tags');
    if (res.ok) {
      recordCheck('DIRECT_OLLAMA_HEALTH', 'passed', 'Direct Ollama connection succeeded.');
    } else {
      recordCheck('DIRECT_OLLAMA_HEALTH', 'failed', `Direct Ollama returned ${res.status}`);
    }
  } catch (err: any) {
    recordCheck('DIRECT_OLLAMA_HEALTH', 'failed', `Direct Ollama connection failed: ${err.message}`);
  }

  // 2. Gateway Router Config
  let gatewayRouter: GatewayRouter;
  try {
    const config = loadGatewayConfig();
    gatewayRouter = GatewayRouter.getInstance(config);
    if (config.providers.length > 0) {
      recordCheck('PROVIDER_REGISTRY_COUNT', 'passed', `Loaded at least 1 provider (${config.providers.length} total).`, { providers: config.providers.map(p => p.name) });
    } else {
      recordCheck('PROVIDER_REGISTRY_COUNT', 'failed', 'No providers were loaded.', { providers: [] });
    }
  } catch (err: any) {
    recordCheck('PROVIDER_REGISTRY_COUNT', 'failed', `Failed to initialize GatewayRouter: ${err.message}`, err);
    return saveReport({ overallStatus, timestamp: new Date().toISOString(), checks });
  }

  // 3. Healthcheck Ollama via Registry
  try {
    const health = await gatewayRouter.healthcheck('ollama');
    if (health.reachable) {
      recordCheck('PROVIDER_REGISTRY_OLLAMA_LOOKUP', 'passed', 'Ollama is reachable via registry.');
    } else {
      recordCheck('PROVIDER_REGISTRY_OLLAMA_LOOKUP', 'failed', `Ollama is unreachable via registry: ${health.error || 'Unknown provider'}`, health);
    }
  } catch (err: any) {
    recordCheck('PROVIDER_REGISTRY_OLLAMA_LOOKUP', 'failed', `Ollama healthcheck crashed: ${err.message}`, err);
  }

  // 4. Test GatewayRouter Request for CodeX
  try {
    const res = await gatewayRouter.chat({
      prompt: 'Reply with exactly DIAGNOSTIC_OK',
      agentId: 'agent-codex',
      timeoutMs: 120000
    });
    recordCheck('GATEWAY_ROUTER_CHAT', 'passed', `GatewayRouter succeeded via ${res.provider}`, res);
  } catch (err: any) {
    let parsed: any = null;
    try { parsed = JSON.parse(err.message); } catch {}
    
    if (parsed) {
      console.log('\n[FAILED] GATEWAY_ROUTER_CHAT\n');
      if (parsed.attemptedProviders) {
        console.log('attemptedProviders:');
        parsed.attemptedProviders.forEach((p: string) => console.log(`- ${p}`));
        console.log('');
      }
      if (parsed.attemptErrors && Array.isArray(parsed.attemptErrors) && parsed.attemptErrors.length > 0) {
        console.log('attemptErrors:');
        parsed.attemptErrors.forEach((errObj: any) => {
          console.log(`- provider: ${errObj.provider}`);
          console.log(`  model: ${errObj.model}`);
          console.log(`  stage: ${errObj.stage}`);
          console.log(`  category: ${errObj.category}`);
          console.log(`  message: ${errObj.message}`);
          if (errObj.statusCode) console.log(`  statusCode: ${errObj.statusCode}`);
          if (errObj.durationMs) console.log(`  durationMs: ${errObj.durationMs}`);
        });
        console.log('');
      }
      if (parsed.errors || parsed.reasons || parsed.cause) {
        if (parsed.errors) console.log('errors:', parsed.errors);
        if (parsed.reasons) console.log('reasons:', parsed.reasons);
        if (parsed.cause) console.log('cause:', parsed.cause);
      }
    }

    const firstFailingBoundary = 'GatewayRouter -> ProviderAdapter';
    const originalError = parsed?.attemptErrors?.[0] || err.message;
    
    recordCheck('GATEWAY_ROUTER_CHAT', 'failed', `GatewayRouter request failed: ${parsed?.message || err.message}`, parsed || err.message);
    
    return saveReport({
      overallStatus,
      timestamp: new Date().toISOString(),
      checks,
      firstFailingBoundary,
      originalError
    });
  }

  // 5. Test GatewayRouter Stream Request for Jarvis
  try {
    const stream = gatewayRouter.stream({
      prompt: 'Reply with exactly STREAM_DIAGNOSTIC_OK',
      agentId: 'agent-jarvis',
      timeoutMs: 120000
    });
    
    let text = '';
    let chunks = 0;
    let selectedProvider = '';
    let selectedModel = '';

    for await (const chunk of stream) {
      if (chunk.type === 'token' && chunk.content) {
        text += chunk.content;
        chunks++;
        if (chunk.provider) selectedProvider = chunk.provider;
        if (chunk.model) selectedModel = chunk.model;
      } else if (chunk.type === 'done') {
        if (chunk.provider) selectedProvider = chunk.provider;
        if (chunk.model) selectedModel = chunk.model;
      }
    }
    
    console.log(`\n[PASSED] GATEWAY_ROUTER_STREAM`);
    console.log(`provider: ${selectedProvider}`);
    console.log(`model: ${selectedModel}`);
    console.log(`chunks: > ${chunks > 0 ? 0 : 'FAIL'}`);
    console.log(`text: ${text}`);

    recordCheck('GATEWAY_ROUTER_STREAM', 'passed', `GatewayRouter stream succeeded via ${selectedProvider}`, { chunks, text });
  } catch (err: any) {
    let parsed: any = null;
    try { parsed = JSON.parse(err.message); } catch {}
    
    if (parsed) {
      console.log('\n[FAILED] GATEWAY_ROUTER_STREAM\n');
      if (parsed.attemptErrors && Array.isArray(parsed.attemptErrors) && parsed.attemptErrors.length > 0) {
        console.log('attemptErrors:');
        parsed.attemptErrors.forEach((errObj: any) => {
          console.log(`- provider: ${errObj.provider}`);
          console.log(`  model: ${errObj.model}`);
          console.log(`  stage: ${errObj.stage}`);
          console.log(`  category: ${errObj.category}`);
          console.log(`  message: ${errObj.message}`);
        });
      }
      if (parsed.errors || parsed.reasons || parsed.cause) {
        if (parsed.errors) console.log('errors:', parsed.errors);
        if (parsed.reasons) console.log('reasons:', parsed.reasons);
        if (parsed.cause) console.log('cause:', parsed.cause);
      }
    }

    recordCheck('GATEWAY_ROUTER_STREAM', 'failed', `GatewayRouter stream request failed: ${parsed?.message || err.message}`, parsed || err.message);
    
    return saveReport({
      overallStatus: 'Broken',
      timestamp: new Date().toISOString(),
      checks,
      firstFailingBoundary: 'GatewayRouter.stream',
      originalError: parsed?.attemptErrors?.[0] || err.message
    });
  }

// 6. Test LLM Gateway Chat
try {
  const { llmChat } = await import('../services/llmGateway.js');
  const start = Date.now();
  const res = await llmChat({
    prompt: 'Reply with exactly LLM_GATEWAY_OK',
    agentId: 'agent-codex',
    timeoutMs: 120000
  });
  const durationMs = Date.now() - start;

  console.log(`\n[LLM_GATEWAY_CHAT] reply: ${res.reply}`);
  console.log(`  provider: ${res.provider}`);
  console.log(`  model: ${res.model}`);
  console.log(`  offline: ${res.offline}`);
  console.log(`  error: ${res.error}`);
  console.log(`  durationMs: ${durationMs}`);

  if (res.offline) {
    recordCheck('LLM_GATEWAY_CHAT', 'failed',
      `llmChat returned offline: true. Error: ${res.error}`, {
        reply: res.reply,
        provider: res.provider,
        model: res.model,
        offline: res.offline,
        error: res.error,
        durationMs
      });
  } else {
    recordCheck('LLM_GATEWAY_CHAT', 'passed',
      `llmChat succeeded via ${res.provider}`, {
        reply: res.reply,
        provider: res.provider,
        model: res.model,
        offline: res.offline,
        error: res.error,
        durationMs
      });
  }
} catch (err: any) {
  recordCheck('LLM_GATEWAY_CHAT', 'failed',
    `llmChat crashed: ${err.message}`, err.message);
}

  // 7. Test Codex Plan Request
  let testGoalId = '';
  try {
    const { codexService } = await import('../domains/codex/service.js');
    const { goalStore } = await import('../services/goalStore.js');
    
    testGoalId = await codexService.createGoal('Reply with exactly CODEX_DIAGNOSTIC_OK', '/tmp/diagnostic', 'manual');
    
    // Wait for the background plan to finish
    let retries = 20;
    let goal = goalStore.get(testGoalId);
    while (retries > 0 && goal?.status === 'queued') {
      await new Promise(r => setTimeout(r, 500));
      goal = goalStore.get(testGoalId);
      retries--;
    }
    
    if (goal?.status === 'queued') {
      recordCheck('CODEX_PLAN_REQUEST', 'failed', `Timeout waiting for CodexService to process plan`);
      return saveReport({
        overallStatus: 'Broken',
        timestamp: new Date().toISOString(),
        checks,
        firstFailingBoundary: 'llmGateway -> CodexService'
      });
    }
    
    // Check if the plan generated an event
    const events = goalStore.get(testGoalId)?.history ?? [];
    const lastEvent = events[events.length - 1];
    
    if (lastEvent?.state === 'failed') {
      console.log(`\n[CODEX_PLAN_REQUEST] Failed event payload:`, lastEvent.payload);
      console.log(`  message: ${lastEvent.message}`);
      console.log(`  errorCode: ${lastEvent.errorCode}`);
      
      recordCheck('CODEX_PLAN_REQUEST', 'failed', `CodexService failed: ${lastEvent.message}`, lastEvent);
      return saveReport({
        overallStatus: 'Broken',
        timestamp: new Date().toISOString(),
        checks,
        firstFailingBoundary: 'llmGateway -> CodexService',
        originalError: lastEvent.errorDetails || lastEvent.message
      });
    } else {
      recordCheck('CODEX_PLAN_REQUEST', 'passed', `CodexService generated plan successfully`, lastEvent);
      
      // 8. Test Codex Event Propagation
      if (lastEvent && lastEvent.state === 'waiting_for_approval' && lastEvent.message) {
        recordCheck('CODEX_EVENT_PROPAGATION', 'passed', `Plan written to goalStore successfully`);
      } else {
        recordCheck('CODEX_EVENT_PROPAGATION', 'failed', `Plan not written correctly to goalStore`, lastEvent);
      }
    }
  } catch (err: any) {
    recordCheck('CODEX_PLAN_REQUEST', 'failed', `CodexService crashed: ${err.message}`, err.message);
    return saveReport({
      overallStatus: 'Broken',
      timestamp: new Date().toISOString(),
      checks,
      firstFailingBoundary: 'llmGateway -> CodexService',
      originalError: err.message
    });
  }

  saveReport({ overallStatus, timestamp: new Date().toISOString(), checks });
}

function saveReport(report: DiagnosticReport) {
  const dir = path.join(process.cwd(), '.agentos', 'diagnostics');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  
  fs.writeFileSync(path.join(dir, 'latest.json'), JSON.stringify(report, null, 2));
  
  const md = `# AGENTICOS DOCTOR REPORT

**Overall:** ${report.overallStatus}
**Timestamp:** ${report.timestamp}

## Checks
${report.checks.map(c => `- **[${c.status.toUpperCase()}] ${c.id}:** ${c.summary}`).join('\n')}

${report.firstFailingBoundary ? `## First Failing Boundary\n${report.firstFailingBoundary}\n` : ''}
${report.originalError ? `## Original Error\n\`\`\`json\n${JSON.stringify(report.originalError, null, 2)}\n\`\`\`\n` : ''}
`;
  
  fs.writeFileSync(path.join(dir, 'latest.md'), md);
  console.log(`\nReport saved to ${path.join(dir, 'latest.md')}`);
  
  if (report.overallStatus === 'Broken') {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runDoctor().catch(err => {
  console.error('Unhandled Doctor exception:', err);
  process.exit(1);
});
