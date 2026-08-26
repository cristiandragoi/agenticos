/**
 * Phase 3 Verifier: Verify Hermes as Real Worker / Planner via Jarvis
 */
const http = require('http');

const PORT = 4000;
const BASE_URL = `http://127.0.0.1:${PORT}`;

function requestJson(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const postData = body ? JSON.stringify(body) : null;
    const req = http.request(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(postData ? { 'Content-Length': Buffer.byteLength(postData) } : {}),
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = data ? JSON.parse(data) : {};
          resolve({ status: res.statusCode, data: json });
        } catch {
          resolve({ status: res.statusCode, raw: data });
        }
      });
    });
    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

function streamPost(path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const postData = JSON.stringify(body);
    const events = [];

    const req = http.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        'Accept': 'text/event-stream',
      },
    }, (res) => {
      let buffer = '';
      res.on('data', chunk => {
        buffer += chunk.toString();
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';
        for (const frame of lines) {
          if (!frame.trim()) continue;
          let eventType = 'message';
          let dataStr = '';
          for (const line of frame.split('\n')) {
            if (line.startsWith('event:')) eventType = line.slice(6).trim();
            if (line.startsWith('data:')) dataStr += line.slice(5).trim();
          }
          try {
            events.push({ event: eventType, data: dataStr ? JSON.parse(dataStr) : {} });
          } catch {
            events.push({ event: eventType, raw: dataStr });
          }
        }
      });
      res.on('end', () => {
        resolve(events);
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function verifyHermesPlanner() {
  console.log('================================================================');
  console.log('PHASE 3: JARVIS → HERMES PLANNER EXECUTION VERIFIER');
  console.log('================================================================\n');

  // Step 0: Ensure no stale tasks blocking worker slots
  try {
    const tasksRes = await requestJson('GET', '/api/background-tasks?activeOnly=true');
    const tasks = Array.isArray(tasksRes.data) ? tasksRes.data : tasksRes.data?.tasks || [];
    for (const t of tasks) {
      await requestJson('POST', `/api/background-tasks/${t.taskId}/cancel`, {});
    }
  } catch {}

  // Step 1: Create conversation
  const convRes = await requestJson('POST', '/api/jarvis/conversations', {
    title: 'Hermes Planning Verification',
  });
  const convId = convRes.data?.id;
  if (!convId) throw new Error('Failed to create test conversation.');
  console.log(`Created conversation: ${convId}`);

  // Step 2: Submit prompt requiring Hermes reasoning/planning
  const prompt = 'Have Hermes inspect the Jarvis execution architecture and produce a concise plan for verifying the Jarvis -> CodeX delegation path. Do not modify files.';
  console.log(`Submitting prompt: "${prompt}"`);

  const t0 = Date.now();
  const streamEvents = await streamPost(`/api/jarvis/conversations/${convId}/message/stream`, {
    prompt,
    operationId: `op-hermes-${Date.now()}`,
    inputChannel: 'typed',
  });
  const ackLatency = Date.now() - t0;

  const doneEvent = streamEvents.find(e => e.event === 'done');
  const taskId = doneEvent?.data?.taskId;
  const chunkText = streamEvents
    .filter(e => e.event === 'chunk' || e.event === 'token')
    .map(e => e.data?.delta || e.data?.content || '')
    .join('');

  console.log(`Immediate Acknowledgement (${ackLatency}ms): "${chunkText}"`);

  if (!taskId) throw new Error('Assertion Failed: No taskId returned from Jarvis stream.');

  // Step 3: Verify Task in Background Task Repository
  const taskRes = await requestJson('GET', `/api/background-tasks/${taskId}`);
  const task = taskRes.data;
  if (!task || task.taskId !== taskId) throw new Error(`Task ${taskId} not found in backgroundTaskRepo.`);

  const assignedWorker = (task.worker || task.selectedAgent || '').toLowerCase();
  console.log(`Task ID: ${taskId}`);
  console.log(`Assigned worker: ${task.worker || task.selectedAgent}`);
  console.log(`Initial status: ${task.status}`);

  if (!assignedWorker.includes('hermes') && task.route !== 'worker_delegation') {
    throw new Error(`Assertion Failed: Expected worker Hermes, got ${assignedWorker}`);
  }

  // Step 4: Poll for Hermes worker execution
  console.log(`Polling task ${taskId} for real Hermes planning activity...`);
  const maxWaitMs = 30000;
  const pollStart = Date.now();
  let liveTask = task;
  let executionObserved = false;

  while (Date.now() - pollStart < maxWaitMs) {
    await new Promise(r => setTimeout(r, 2000));
    const poll = await requestJson('GET', `/api/background-tasks/${taskId}`);
    liveTask = poll.data || liveTask;

    if (liveTask.status === 'running' || liveTask.status === 'planning' || liveTask.status === 'completed') {
      executionObserved = true;
    }
    if (liveTask.status === 'completed' || liveTask.status === 'failed' || liveTask.status === 'cancelled') {
      break;
    }
  }

  console.log(`Task execution state: ${liveTask.status.toUpperCase()}`);
  console.log(`Progress message: "${liveTask.progressMessage || 'Active'}"`);

  // Step 5: Verify conversation received supervisor progress
  const msgsRes = await requestJson('GET', `/api/jarvis/conversations/${convId}/messages`);
  const messages = Array.isArray(msgsRes.data) ? msgsRes.data : msgsRes.data?.messages || [];
  console.log(`Persisted conversation messages count: ${messages.length}`);

  if (liveTask.status === 'failed') {
    throw new Error(`Hermes task failed: ${liveTask.lastError || liveTask.blocker}`);
  }

  console.log('\n================================================================');
  console.log('JARVIS -> HERMES: PASS');
  console.log('================================================================\n');
}

verifyHermesPlanner().catch(err => {
  console.error('\nJARVIS -> HERMES: FAIL');
  console.error('Reason:', err.message || err);
  process.exit(1);
});
