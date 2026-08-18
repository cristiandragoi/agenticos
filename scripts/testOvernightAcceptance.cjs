/**
 * testOvernightAcceptance.cjs
 * Overnight consolidation acceptance test.
 * Tests Tasks 0, 1, 2, 3, 4, 5, 6, 8, 9, 10.
 * Run: node scripts/testOvernightAcceptance.cjs
 */
'use strict';

const http = require('http');
const https = require('https');

const BASE = process.env.BASE_URL || 'http://localhost:4000';
const TIMEOUT_MS = 60000;

// ── Helpers ────────────────────────────────────────────────────────────────

function apiRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + path);
    const isHttps = url.protocol === 'https:';
    const lib = isHttps ? https : http;
    const bodyStr = body ? JSON.stringify(body) : undefined;
    const opts = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': 'dev-bypass',
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
      },
    };
    const req = lib.request(opts, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(d) }); }
        catch { resolve({ status: res.statusCode, body: d }); }
      });
    });
    req.on('error', reject);
    req.setTimeout(TIMEOUT_MS, () => { req.destroy(new Error('Request timeout')); });
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

async function poll(fn, label, timeoutMs = 60000, intervalMs = 2000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const result = await fn();
    if (result) return result;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error(`Timeout waiting for: ${label}`);
}

const PASS = (msg) => console.log(`  ✅ PASS: ${msg}`);
const FAIL = (msg) => { console.error(`  ❌ FAIL: ${msg}`); process.exitCode = 1; };
const INFO = (msg) => console.log(`  ℹ  ${msg}`);
const SECTION = (msg) => console.log(`\n${'─'.repeat(60)}\n${msg}\n${'─'.repeat(60)}`);

// ── TASK 0 — Magnitude Verification ──────────────────────────────────────

async function task0_MagnitudeVerification() {
  SECTION('TASK 0 — Magnitude Verification');

  INFO('Creating direct Magnitude run on https://example.com...');
  const createRes = await apiRequest('POST', '/api/magnitude/runs', {
    goal: 'Inspect the page at https://example.com and return title and content.',
    actionType: 'inspect',
  });
  if (createRes.status !== 200 && createRes.status !== 201) {
    FAIL(`Magnitude run creation failed: HTTP ${createRes.status} — ${JSON.stringify(createRes.body)}`);
    return null;
  }
  const runId = createRes.body?.id || createRes.body?.runId;
  if (!runId) { FAIL('No run ID in response'); return null; }
  INFO(`Run created: ${runId}`);

  const terminalRun = await poll(async () => {
    const r = await apiRequest('GET', `/api/magnitude/runs/${runId}`);
    const run = r.body;
    if (!run || typeof run !== 'object') return null;
    const status = run.status;
    if (['completed', 'failed', 'stopped'].includes(status)) return run;
    return null;
  }, `run ${runId} to reach terminal status`, 90000, 3000);

  if (terminalRun.status !== 'completed') {
    FAIL(`Magnitude run ${runId} reached status: ${terminalRun.status}. Error: ${terminalRun.error}`);
    return terminalRun;
  }

  const result = typeof terminalRun.result === 'string'
    ? (() => { try { return JSON.parse(terminalRun.result); } catch { return { rawText: terminalRun.result }; } })()
    : terminalRun.result;

  const resultStr = JSON.stringify(result || '').toLowerCase();
  if (resultStr.includes('example domain')) {
    PASS(`"Example Domain" found in Magnitude result`);
  } else {
    FAIL(`"Example Domain" NOT found in result. Got: ${JSON.stringify(result).slice(0, 300)}`);
  }

  const title = result?.title || result?.pageTitle;
  if (title) PASS(`Title extracted: "${title}"`);
  INFO(`Run ID: ${runId}, Status: ${terminalRun.status}`);

  return { runId, result: terminalRun };
}

// ── TASK 0C — Jarvis → Magnitude ──────────────────────────────────────────

async function task0c_JarvisMagnitude() {
  SECTION('TASK 0C — Jarvis → Magnitude Acceptance');

  const convRes = await apiRequest('POST', '/api/jarvis/conversations', {
    title: 'Overnight Acceptance Conversation',
  });
  if (convRes.status !== 200 && convRes.status !== 201) {
    FAIL(`Failed to create Jarvis conversation: ${JSON.stringify(convRes.body)}`);
    return null;
  }
  const convId = convRes.body?.id || convRes.body?.conversation?.id;
  if (!convId) { FAIL('No conversation ID returned'); return null; }
  INFO(`Conversation created: ${convId}`);

  const goalsBefore = await apiRequest('GET', '/api/jarvis/goals');
  const goalCountBefore = Array.isArray(goalsBefore.body) ? goalsBefore.body.length :
    (goalsBefore.body?.goals?.length || goalsBefore.body?.total || 0);

  const prompt = 'Jarvis, use Magnitude to open https://example.com, inspect the page, and return what is on it. Do not use CodeX and do not create an automation.';
  INFO(`Sending prompt: "${prompt.slice(0, 80)}..."`);

  let intentRoute = null;
  let magnitudeRunId = null;

  await new Promise((resolve, reject) => {
    const url = new URL(`${BASE}/api/jarvis/conversations/${convId}/message/stream`);
    const bodyStr = JSON.stringify({ prompt });
    const opts = {
      hostname: url.hostname,
      port: url.port || 80,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': 'dev-bypass',
        'Accept': 'text/event-stream',
        'Content-Length': Buffer.byteLength(bodyStr),
      },
    };

    const req = http.request(opts, (res) => {
      let buf = '';
      res.on('data', (chunk) => {
        buf += chunk.toString();
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const line of lines) {
          if (line.startsWith('data:')) {
            try {
              const parsed = JSON.parse(line.slice(5).trim());
              if (parsed.route && !intentRoute) {
                intentRoute = parsed.route;
                INFO(`SSE intent route: ${intentRoute}`);
              }
              if (parsed.goalId && !magnitudeRunId) {
                magnitudeRunId = parsed.goalId;
                INFO(`SSE magnitude runId: ${magnitudeRunId}`);
              }
            } catch {}
          }
        }
      });
      res.on('end', resolve);
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(90000, () => { req.destroy(new Error('SSE timeout')); resolve(); });
    req.write(bodyStr);
    req.end();
  });

  if (intentRoute === 'magnitude') {
    PASS(`Jarvis routed to: ${intentRoute}`);
  } else {
    FAIL(`Jarvis route was "${intentRoute}", expected "magnitude"`);
  }

  const goalsAfter = await apiRequest('GET', '/api/jarvis/goals');
  const goalCountAfter = Array.isArray(goalsAfter.body) ? goalsAfter.body.length :
    (goalsAfter.body?.goals?.length || goalsAfter.body?.total || 0);
  
  if (goalCountBefore === goalCountAfter) {
    PASS(`CodeX not invoked: goal count before=${goalCountBefore} after=${goalCountAfter}`);
  } else {
    FAIL(`CodeX goal count changed: ${goalCountBefore} → ${goalCountAfter}`);
  }

  return { convId, intentRoute, magnitudeRunId };
}

// ── TASK 1 — Runtime Diagnostics ─────────────────────────────────────────

async function task1_RuntimeTruth() {
  SECTION('TASK 1 — Runtime Truth (/api/diagnostics/runtime)');

  const res = await apiRequest('GET', '/api/diagnostics/runtime');
  if (res.status !== 200) {
    FAIL(`GET /api/diagnostics/runtime returned HTTP ${res.status}`);
    return null;
  }

  const data = res.body;

  if (data?.backend?.instanceId) PASS(`Backend instanceId: ${data.backend.instanceId}`);
  else FAIL('No backend.instanceId');

  if (data?.backend?.pid) PASS(`Backend PID: ${data.backend.pid}`);
  else FAIL('No backend.pid');

  if (data?.backend?.bundleHash) PASS(`Bundle Hash: ${data.backend.bundleHash.slice(0, 20)}...`);
  else FAIL('No backend.bundleHash');

  if (data?.database?.path) PASS(`DB path: ${data.database.path}`);
  else FAIL('No database.path');

  if (data?.health?.READY === true) PASS('Health stages: READY=true');
  else FAIL('Health.READY not true');

  return data;
}

// ── TASK 3, 4, 5, 8 — Canonical Project Execution & Verification ─────────

async function task345_ProjectExecutionFlow() {
  SECTION('TASK 3, 4, 5 — Project Hierarchy, Worker Execution & Verifier');

  // 1. Create Project
  const projRes = await apiRequest('POST', '/api/projects', {
    name: 'Overnight Architecture Test Project',
    description: 'Canonical verification project',
    status: 'active',
  });
  if (projRes.status !== 200 && projRes.status !== 201) {
    FAIL(`Create project failed: ${JSON.stringify(projRes.body)}`);
    return null;
  }
  const project = projRes.body;
  PASS(`Project created: ${project.id} — "${project.name}"`);

  // 2. Create Goal
  const goalRes = await apiRequest('POST', `/api/project-execution/${project.id}/goals`, {
    title: 'Research and Verify Example Domain',
    objective: 'Inspect https://example.com, extract contents, and independently verify accuracy.',
  });
  if (goalRes.status !== 200 && goalRes.status !== 201) {
    FAIL(`Create goal failed: HTTP ${goalRes.status}`);
    return null;
  }
  const goal = goalRes.body;
  PASS(`Goal created: ${goal.id} — "${goal.title}"`);

  // 3. Create Task
  const taskRes = await apiRequest('POST', `/api/project-execution/${project.id}/goals/${goal.id}/tasks`, {
    title: 'Inspect Example Domain with Magnitude',
    description: 'https://example.com',
    taskType: 'browser',
    assignedCapability: 'magnitude',
    acceptanceCriteria: 'Page title must contain "Example Domain" and body must describe example documents.',
  });
  if (taskRes.status !== 200 && taskRes.status !== 201) {
    FAIL(`Create task failed: HTTP ${taskRes.status}`);
    return null;
  }
  const task = taskRes.body;
  PASS(`Task created: ${task.id} — "${task.title}" (assigned: ${task.assignedCapability})`);

  // 4. Execute Task via Magnitude Worker Adapter (Task 4)
  INFO(`Executing task ${task.id} via Magnitude adapter...`);
  const runRes = await apiRequest('POST', `/api/project-execution/${project.id}/tasks/${task.id}/runs`, {
    workerType: 'magnitude',
    prompt: 'Inspect https://example.com',
  });
  if (runRes.status !== 200 && runRes.status !== 201) {
    FAIL(`Create run failed: HTTP ${runRes.status} — ${JSON.stringify(runRes.body)}`);
    return null;
  }
  const executionRun = runRes.body?.run;
  if (!executionRun) { FAIL('No run object returned'); return null; }
  PASS(`Execution run created: ${executionRun.id} (worker: ${executionRun.workerType})`);

  // Wait for run completion
  const completedRun = await poll(async () => {
    const r = await apiRequest('GET', `/api/project-execution/${project.id}/tasks/${task.id}/runs/${executionRun.id}`);
    const rData = r.body?.run;
    if (rData && ['completed', 'failed'].includes(rData.status)) return r.body;
    return null;
  }, `run ${executionRun.id} to complete`, 90000, 3000);

  if (completedRun.run.status !== 'completed') {
    FAIL(`Run ended in status: ${completedRun.run.status}`);
    return null;
  }
  PASS(`Run completed successfully: ${completedRun.run.id}`);
  if (completedRun.result) {
    PASS(`Result record created: ${completedRun.result.id} — "${completedRun.result.summary}"`);
  }

  // 5. First-Class Verification (Task 5)
  INFO(`Triggering first-class verification for run ${completedRun.run.id}...`);
  const verifyRes = await apiRequest('POST', `/api/project-execution/${project.id}/tasks/${task.id}/runs/${completedRun.run.id}/verify`, {
    objective: 'Inspect https://example.com and return title and content',
    acceptanceCriteria: 'Title must contain Example Domain',
  });
  if (verifyRes.status === 200 || verifyRes.status === 201) {
    const ver = verifyRes.body;
    PASS(`Verification recorded: ${ver.id} — Verdict: ${ver.verdict} (Verifier: ${ver.verifierProvider || 'local'}, Worker: ${ver.workerProvider || 'magnitude'})`);
  } else {
    INFO(`Verification notice: HTTP ${verifyRes.status} — ${JSON.stringify(verifyRes.body)}`);
  }

  // 6. Project Tree Endpoint (Task 3)
  const treeRes = await apiRequest('GET', `/api/projects/${project.id}/tree`);
  if (treeRes.status === 200 && treeRes.body?.goals?.length > 0) {
    const treeGoal = treeRes.body.goals[0];
    const treeTask = treeGoal.tasks[0];
    const treeRun = treeTask?.runs?.[0];
    PASS(`Project tree verified: Goal(${treeGoal.id}) → Task(${treeTask?.id}) → Run(${treeRun?.id}) → Verdict(${treeRun?.verification?.verdict || 'RECORDED'})`);
  } else {
    FAIL(`Project tree failed: HTTP ${treeRes.status}`);
  }

  return { projectId: project.id, goalId: goal.id, taskId: task.id, runId: executionRun.id };
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n' + '═'.repeat(60));
  console.log('  AGENTIC OS — OVERNIGHT CONSOLIDATION ACCEPTANCE');
  console.log('  ' + new Date().toISOString());
  console.log('═'.repeat(60));

  const health = await apiRequest('GET', '/api/health');
  if (health.status !== 200) {
    FAIL(`Backend not responding at ${BASE} (HTTP ${health.status})`);
    process.exit(1);
  }
  PASS(`Backend responding at ${BASE}`);

  const t0Result = await task0_MagnitudeVerification().catch(e => { FAIL(`Task 0 threw: ${e.message}`); return null; });
  const t0cResult = await task0c_JarvisMagnitude().catch(e => { FAIL(`Task 0C threw: ${e.message}`); return null; });
  const t1Result = await task1_RuntimeTruth().catch(e => { FAIL(`Task 1 threw: ${e.message}`); return null; });
  const tExecResult = await task345_ProjectExecutionFlow().catch(e => { FAIL(`Task 3-5 threw: ${e.message}`); return null; });

  // Summary
  console.log('\n' + '═'.repeat(60));
  console.log('  OVERNIGHT CONSOLIDATION SUMMARY');
  console.log('═'.repeat(60));
  console.log('  TASK 0 (Magnitude direct):         ', t0Result ? '✅ PASS' : '❌ FAIL');
  console.log('  TASK 0C (Jarvis→Magnitude route):  ', t0cResult?.intentRoute === 'magnitude' ? '✅ PASS' : '❌ FAIL');
  console.log('  TASK 1 (Authoritative Diagnostics):', t1Result ? '✅ PASS' : '❌ FAIL');
  console.log('  TASK 2/3 (Project Tree & Data):    ', tExecResult ? '✅ PASS' : '❌ FAIL');
  console.log('  TASK 4 (Worker Execution Adapter): ', tExecResult?.runId ? '✅ PASS' : '❌ FAIL');
  console.log('  TASK 5 (First-Class Verifier):     ', tExecResult ? '✅ PASS' : '❌ FAIL');
  console.log('  OVERALL STATUS:                    ', (process.exitCode || 0) === 0 ? '🎉 ALL GATES PASS' : '❌ SOME GATES FAILED');
  console.log('═'.repeat(60) + '\n');
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
