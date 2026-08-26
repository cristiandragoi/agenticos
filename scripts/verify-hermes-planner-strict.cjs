/**
 * Strict Real Hermes Planner Verifier
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
  console.log('STRICT REAL HERMES PLANNER VERIFIER');
  console.log('================================================================\n');

  // Step 0: Free active background tasks
  try {
    const tasksRes = await requestJson('GET', '/api/background-tasks?activeOnly=true');
    const tasks = Array.isArray(tasksRes.data) ? tasksRes.data : tasksRes.data?.tasks || [];
    for (const t of tasks) {
      await requestJson('POST', `/api/background-tasks/${t.taskId}/cancel`, {});
    }
  } catch {}

  // Step 1: Create conversation
  const convRes = await requestJson('POST', '/api/jarvis/conversations', {
    title: 'Hermes Planner Strict Verification',
  });
  const convId = convRes.data?.id;
  if (!convId) throw new Error('Failed to create test conversation.');
  console.log(`Created conversation: ${convId}`);

  // Step 2: Submit Hermes planning prompt
  const prompt = 'Have Hermes plan the architectural migration for the websocket telemetry stream.';
  console.log(`Submitting prompt: "${prompt}"`);

  const t0 = Date.now();
  const streamEvents = await streamPost(`/api/jarvis/conversations/${convId}/message/stream`, {
    prompt,
    operationId: `op-hermes-strict-${Date.now()}`,
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

  if (!taskId) throw new Error('Assertion Failed: No taskId returned from stream.');

  const taskRes = await requestJson('GET', `/api/background-tasks/${taskId}`);
  const initialTask = taskRes.data;
  if (!initialTask || initialTask.taskId !== taskId) throw new Error(`Task ${taskId} not found in backgroundTaskRepo.`);

  console.log(`Task ID: ${taskId}`);
  console.log(`Assigned worker: ${initialTask.worker || initialTask.selectedAgent}`);
  console.log(`Initial status: ${initialTask.status}`);

  // Step 3: Poll task execution lifecycle until terminal completion
  console.log(`Polling task ${taskId} for Hermes plan execution...`);
  const maxWaitMs = 120000;
  const pollStart = Date.now();

  let liveTask = initialTask;
  while (Date.now() - pollStart < maxWaitMs) {
    await new Promise(r => setTimeout(r, 2000));
    const poll = await requestJson('GET', `/api/background-tasks/${taskId}`);
    liveTask = poll.data || liveTask;

    if (liveTask.status === 'completed' || liveTask.status === 'failed' || liveTask.status === 'cancelled') {
      if (liveTask.resultText) {
        break;
      }
    }
  }

  const elapsedSeconds = Math.round((Date.now() - pollStart) / 1000);

  if (liveTask.status !== 'completed') {
    throw new Error(`Hermes task timed out or ended in non-terminal state (${liveTask.status}) after ${elapsedSeconds}s.`);
  }

  if (!liveTask.resultText?.trim()) {
    throw new Error('Assertion Failed: Hermes task completed without a persisted resultText.');
  }

  console.log(`Task ID: ${taskId}`);
  console.log(`Assigned worker: ${liveTask.worker}`);
  console.log(`Final task state: ${liveTask.status.toUpperCase()}`);
  console.log(`Progress message: "${liveTask.progressMessage}"`);
  console.log(`Persisted plan result:\n"${liveTask.resultText.trim()}"`);

  console.log('\n================================================================');
  console.log('HERMES PLANNER: PASS');
  console.log('================================================================\n');
}

verifyHermesPlanner().catch(err => {
  console.error('\nHERMES PLANNER: FAIL');
  console.error('Reason:', err.message || err);
  process.exit(1);
});
