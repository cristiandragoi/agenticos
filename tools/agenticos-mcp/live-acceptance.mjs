/**
 * live-acceptance.mjs — drives the REAL agenticos MCP server over stdio for
 * live Acceptance A–D against the deployed backend.
 *
 * Usage: node tools/agenticos-mcp/live-acceptance.mjs
 * Requires the deployed backend (restarted with /api/mcp-bridge mounted).
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(__dirname, 'dist', 'server.js');

const BASE = process.env.AGENTICOS_MCP_BASE_URL || 'http://127.0.0.1:4000';

const child = spawn(process.execPath, [SERVER], {
  env: { ...process.env, AGENTICOS_MCP_BASE_URL: BASE },
  stdio: ['pipe', 'pipe', 'pipe'],
});

let buf = '';
let nextId = 1;
const pending = new Map();
const stderrLines = [];

child.stdout.on('data', (chunk) => {
  buf += chunk.toString('utf8');
  let idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    if (msg.id !== undefined && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    }
  }
});

child.stderr.on('data', (c) => stderrLines.push(c.toString('utf8').slice(0, 500)));

function rpc(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
}

function toolCall(name, args = {}) {
  return rpc('tools/call', { name, arguments: args });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const scenario = process.argv[2] || 'all';
  await rpc('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'acceptance-client', version: '1.0.0' },
  });
  // Notifications get no response by spec — fire and forget.
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);

  const results = {};

  if (scenario === 'all' || scenario === 'A') {
    console.log('=== ACCEPTANCE A — READ-ONLY BRIDGE ===');
    results.health = await toolCall('agenticos_health');
    results.active = await toolCall('agenticos_get_active_project');
    results.projects = await toolCall('agenticos_list_projects');
    const proj = JSON.parse(results.projects.content[0].text).projects[0];
    if (proj) {
      results.context = await toolCall('agenticos_get_project_context', { projectId: proj.projectId, maxKnowledge: 5, maxRuns: 5 });
      results.runs = await toolCall('agenticos_list_runs', { projectId: proj.projectId, limit: 10 });
      const run = JSON.parse(results.runs.content[0].text).runs[0];
      if (run) {
        results.runDetail = await toolCall('agenticos_get_run', { runId: run.runId, projectId: proj.projectId });
        results.runResult = await toolCall('agenticos_get_run_result', { runId: run.runId, projectId: proj.projectId });
      }
    }
    for (const [k, v] of Object.entries(results)) {
      const parsed = JSON.parse(v.content[0].text);
      console.log(`[A] ${k}: ${JSON.stringify(parsed).slice(0, 400)}`);
    }
  }

  if (scenario === 'all' || scenario === 'B' || scenario === 'C' || scenario === 'D') {
    const projList = await toolCall('agenticos_list_projects');
    const projects = JSON.parse(projList.content[0].text).projects;
    // Prefer the disposable acceptance project if present
    const target = projects.find((p) => p.name.includes('MCP Accept')) ?? projects[0];
    console.log(`\n=== ACCEPTANCE TARGET PROJECT: ${target?.name} (${target?.projectId}) ===`);
    if (!target) { console.log('[FATAL] no project available'); process.exit(2); }

    if (scenario === 'all' || scenario === 'B' || scenario === 'C') {
      console.log('\n=== ACCEPTANCE B — PREPARE WITHOUT EXECUTION ===');
      const prepare = await toolCall('agenticos_prepare_task', {
        projectId: target.projectId,
        targetWorker: 'hermes',
        taskType: 'research',
        title: 'MCP Acceptance — summary of facts file',
        prompt: 'Inspect the supplied text file and return a five-item factual summary. Do not modify anything.',
        sourceConversationId: 'acceptance-conv-1',
        operationId: 'acceptance-op-1',
        constraints: { allowSourceChanges: false, allowBuild: false, allowRestart: false, allowDeploy: false, allowCommit: false, allowPush: false, allowNetwork: false },
      });
      const prepParsed = JSON.parse(prepare.content[0].text);
      console.log(`[B] prepare: ${JSON.stringify(prepParsed).slice(0, 500)}`);
      const preparedTaskId = prepParsed.preparedTaskId;
      if (!preparedTaskId) { console.log('[FATAL] prepare failed'); process.exit(2); }

      // Prove no run exists yet
      const runsBefore = await toolCall('agenticos_list_runs', { projectId: target.projectId, limit: 50 });
      const beforeCount = JSON.parse(runsBefore.content[0].text).runs.filter((r) => r.taskId === prepParsed.taskId).length;
      console.log(`[B] runs for prepared task BEFORE approval: ${beforeCount} (must be 0)`);

      if (scenario === 'all' || scenario === 'C') {
        console.log('\n=== ACCEPTANCE C — APPROVAL + SUBMISSION ===');
        // Authoritative approval: record it through the backend (the endpoint the UI calls)
        const http = await import('node:http');
        const post = (p, body) => new Promise((resolve, reject) => {
          const req = http.request(BASE + p, { method: 'POST', headers: { 'content-type': 'application/json' } }, (res) => {
            let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => resolve(JSON.parse(d || '{}')));
          });
          req.on('error', reject);
          req.write(JSON.stringify(body)); req.end();
        });
        const approval = await post(`/api/mcp-bridge/tasks/${prepParsed.taskId}/approve`, { responder: 'acceptance-client', reason: 'Acceptance C: human-approved' });
        console.log(`[C] approval recorded: ${JSON.stringify(approval).slice(0, 300)}`);

        const submit1 = await toolCall('agenticos_submit_prepared_task', { preparedTaskId, requestId: 'acceptance-request-1' });
        const s1 = JSON.parse(submit1.content[0].text);
        console.log(`[C] submit #1: ${JSON.stringify(s1).slice(0, 500)}`);
        const runId = s1.runId;

        const submit2 = await toolCall('agenticos_submit_prepared_task', { preparedTaskId, requestId: 'acceptance-request-2' });
        const s2 = JSON.parse(submit2.content[0].text);
        console.log(`[C] submit #2 (idempotent): sameRun=${s2.runId === runId} alreadySubmitted=${s2.alreadySubmitted}`);

        // Follow events to terminal state (bounded)
        let after = 0;
        let terminal = false;
        for (let i = 0; i < 30 && !terminal; i++) {
          await sleep(2000);
          const follow = await toolCall('agenticos_follow_run', { runId, afterSequence: after });
          const f = JSON.parse(follow.content[0].text);
          after = f.nextSequence ?? after;
          if (f.events?.length) console.log(`[C] follow events (after=${after}): ${f.events.map((e) => `${e.sequence}:${e.eventType}`).join(', ')}`);
          const st = f.run?.status;
          if (['completed', 'failed', 'cancelled'].includes(st)) terminal = true;
        }
        const detail = await toolCall('agenticos_get_run', { runId, projectId: target.projectId });
        const d = JSON.parse(detail.content[0].text);
        console.log(`[C] final run detail: status=${d.status} worker=${d.worker} verification=${d.verification?.verdict ?? 'n/a'} result=${d.result?.status ?? 'n/a'}`);
        const result = await toolCall('agenticos_get_run_result', { runId, projectId: target.projectId });
        console.log(`[C] final result: ${result.content[0].text.slice(0, 600)}`);
        results.runId = runId;
      }
    }

    if (scenario === 'all' || scenario === 'D') {
      console.log('\n=== ACCEPTANCE D — CANCELLATION ===');
      const prepare = await toolCall('agenticos_prepare_task', {
        projectId: target.projectId,
        targetWorker: 'hermes',
        taskType: 'research',
        title: 'MCP Acceptance — cancellable long task',
        prompt: 'Perform a deliberately long research task that will be cancelled: enumerate many facts and continue for several minutes.',
        sourceConversationId: 'acceptance-conv-2',
        constraints: { allowSourceChanges: false },
      });
      const prep = JSON.parse(prepare.content[0].text);
      console.log(`[D] prepare: ${JSON.stringify(prep).slice(0, 300)}`);

      const http = await import('node:http');
      const post = (p, body) => new Promise((resolve, reject) => {
        const req = http.request(BASE + p, { method: 'POST', headers: { 'content-type': 'application/json' } }, (res) => {
          let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => resolve(JSON.parse(d || '{}')));
        });
        req.on('error', reject);
        req.write(JSON.stringify(body)); req.end();
      });
      await post(`/api/mcp-bridge/tasks/${prep.taskId}/approve`, { responder: 'acceptance-client', reason: 'Acceptance D: human-approved' });

      const submit = await toolCall('agenticos_submit_prepared_task', { preparedTaskId: prep.preparedTaskId });
      const s = JSON.parse(submit.content[0].text);
      const runId = s.runId;
      console.log(`[D] submitted runId=${runId} status=${s.status}`);
      await sleep(3000);
      const cancel = await toolCall('agenticos_cancel_run', { runId, reason: 'Acceptance D: user cancellation' });
      const c = JSON.parse(cancel.content[0].text);
      console.log(`[D] cancel: ${JSON.stringify(c).slice(0, 300)}`);
      const detail = await toolCall('agenticos_get_run', { runId, projectId: target.projectId });
      console.log(`[D] final: ${JSON.stringify(JSON.parse(detail.content[0].text)).slice(0, 500)}`);
    }
  }

  console.log('\n=== STDERR (sanitized diagnostics) ===');
  console.log(stderrLines.slice(0, 10).join('') || '(none)');
  child.kill('SIGTERM');
  process.exit(0);
}

main().catch((e) => {
  console.error('ACCEPTANCE FAILED:', e.message);
  console.error(stderrLines.slice(0, 20).join(''));
  child.kill('SIGTERM');
  process.exit(1);
});
