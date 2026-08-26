// Phase 5b — drive the CANONICAL in-repo Jarvis→Hermes→CodeX delegation path
// (orchestrator.handleMessage → intentRouter → handleHermes → executeHermesTask
//  → in-repo hermes/service.ts (DeepSeek) → struct.proposedTasks[capability=codex]
//  → delegateProposedCodexTask → codexService.createGoal → in-repo CodeX loop).
// This is NOT the external hermesApiService / codex CLI path.
const BASE = process.env.BASE || 'http://127.0.0.1:4002';

async function j(method, path, body, timeoutMs = 20000) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

const planningPrompt = [
  'Ask Hermes to plan a small, bounded engineering initiative.',
  'Decompose the work into a roadmap with concrete steps.',
  'The first concrete task must be a codex-capable read-only repository inspection:',
  'read server/src/services/goalStore.ts and report its exported functions and signatures.',
  'Set that task capability to "codex". Do NOT modify any files and do NOT run tests.',
  'Report truthfully: your plan, the delegated CodeX goal identifier, CodeX findings, and the provider/model used.',
].join('\n');

console.log('=== PHASE 5b — canonical in-repo Hermes→CodeX delegation ===');
const conv = await j('POST', '/api/jarvis/conversations', { title: 'Phase 5b delegation' });
if (conv.status !== 200) { console.log('create conv failed', JSON.stringify(conv.data).slice(0, 500)); process.exit(1); }
const convId = conv.data.id;
console.log('conversationId:', convId);

const t0 = Date.now();
const msg = await j('POST', `/api/jarvis/conversations/${convId}/message`, {
  prompt: planningPrompt,
  workspacePath: 'B:\\AgenticOS',
  approvalPolicy: 'auto',
}, 320000); // handleMessage blocks through CodeX delegation (bounded ~180s)
console.log('message status', msg.status, 'elapsed', ((Date.now() - t0) / 1000).toFixed(1) + 's');
if (msg.status !== 200) { console.log('MSG ERR', JSON.stringify(msg.data).slice(0, 1200)); }

console.log('\n=== ORCHESTRATOR RESULT ===');
console.log(JSON.stringify(msg.data, null, 2));

// Pull the conversation messages to capture the folded CodeX summary + metadata
console.log('\n=== CONVERSATION MESSAGES (agent/summary) ===');
const msgs = await j('GET', `/api/jarvis/conversations/${convId}/messages`);
for (const m of (Array.isArray(msgs.data) ? msgs.data : [])) {
  const meta = m.metadata || {};
  const want = m.role === 'agent' || m.role === 'system';
  if (!want) continue;
  console.log(JSON.stringify({
    role: m.role, messageType: m.messageType,
    codexDelegation: meta.codexDelegation || null,
    worker: meta.worker, goalId: meta.goalId, taskId: meta.taskId, runId: meta.runId,
    verdict: meta.verdict,
    content: (m.content || '').slice(0, 1500),
  }, null, 2));
}

import { writeFileSync } from 'node:fs';
writeFileSync('B:/AgenticOS/docs/overnight-repair/phase5b-delegation-raw.json', JSON.stringify({ convId, result: msg.data, messages: msgs.data }, null, 2));
console.log('\nSaved -> docs/overnight-repair/phase5b-delegation-raw.json');
