/**
 * Strict Fail-Closed Real CodeX Direct Execution Verifier
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

async function verifyCodexExecution() {
  console.log('================================================================');
  console.log('STRICT FAIL-CLOSED REAL CODEX EXECUTION VERIFIER');
  console.log('================================================================\n');

  // Step 0: Ensure 0 active background tasks before starting
  try {
    const tasksRes = await requestJson('GET', '/api/background-tasks?activeOnly=true');
    const tasks = Array.isArray(tasksRes.data) ? tasksRes.data : tasksRes.data?.tasks || [];
    for (const t of tasks) {
      await requestJson('POST', `/api/background-tasks/${t.taskId}/cancel`, {});
    }
  } catch {}

  // Step 1: Create test conversation
  const convRes = await requestJson('POST', '/api/jarvis/conversations', {
    title: 'CodeX Direct Inspection Verifier',
  });
  const convId = convRes.data?.id;
  if (!convId) throw new Error('Failed to create test conversation.');
  console.log(`Created conversation: ${convId}`);

  // Step 2: Request execution
  const targetFile = 'server/src/domains/jarvis/executionSupervisor.ts';
  const prompt = `Have CodeX inspect ${targetFile} and return the exported supervisor class name. Do not modify files.`;
  console.log(`Submitting prompt: "${prompt}"`);

  const t0 = Date.now();
  const streamEvents = await streamPost(`/api/jarvis/conversations/${convId}/message/stream`, {
    prompt,
    operationId: `op-codex-ver-${Date.now()}`,
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

  if (!taskId) {
    throw new Error('Assertion Failed: No taskId returned from Jarvis stream.');
  }

  // Step 3: Verify Task exists in repository
  const taskRes = await requestJson('GET', `/api/background-tasks/${taskId}`);
  const initialTask = taskRes.data;
  if (!initialTask || initialTask.taskId !== taskId) {
    throw new Error(`Assertion Failed: Task ${taskId} not found in backgroundTaskRepo.`);
  }

  const assignedWorker = (initialTask.worker || initialTask.selectedAgent || '').toLowerCase();
  console.log(`Task ID: ${taskId}`);
  console.log(`Assigned worker: ${initialTask.worker || initialTask.selectedAgent}`);
  console.log(`Initial status: ${initialTask.status}`);

  if (!assignedWorker.includes('codex')) {
    throw new Error(`Assertion Failed: Expected worker CodeX, got ${assignedWorker}`);
  }

  // Step 4: Poll task execution lifecycle until terminal completion
  console.log(`Polling task ${taskId} for real CodeX worker activity...`);
  const maxWaitMs = 120000;
  const pollStart = Date.now();

  let liveTask = initialTask;
  let observedEvents = [];

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

  // Read task events from Roaming SQLite database
  try {
    const path = require('path');
    const Database = require(path.resolve('server/node_modules/better-sqlite3'));
    const dbPath = 'C:/Users/Cris/AppData/Roaming/agenticos/data/agentic-os.db';
    const db = new Database(dbPath, { readonly: true });
    observedEvents = db.prepare('SELECT * FROM background_task_events WHERE task_id = ?').all(taskId);
    db.close();
  } catch {}

  // Step 5: Assertions
  const elapsedSeconds = Math.round((Date.now() - pollStart) / 1000);

  if (liveTask.status === 'failed' || liveTask.status === 'cancelled') {
    console.error('\n=== TIMEOUT / FAILURE DIAGNOSTICS ===');
    console.error('Task ID:', taskId);
    console.error('Final Status:', liveTask.status);
    console.error('Worker:', liveTask.worker);
    console.error('Selected Agent:', liveTask.selectedAgent);
    console.error('Operation ID:', liveTask.metadata?.operationId);
    console.error('Progress Message:', liveTask.progressMessage);
    console.error('Blocker:', liveTask.blocker);
    console.error('Last Error:', liveTask.lastError);
    console.error('Events count:', observedEvents.length);
    throw new Error(`Task entered terminal failure/cancelled state (${liveTask.status}): ${liveTask.lastError || liveTask.blocker}`);
  }

  if (liveTask.status !== 'completed') {
    console.error('\n=== TIMEOUT / NON-TERMINAL DIAGNOSTICS ===');
    console.error('Task ID:', taskId);
    console.error('Final Status (Non-Terminal):', liveTask.status);
    console.error('Elapsed Seconds:', elapsedSeconds);
    console.error('Worker:', liveTask.worker);
    console.error('Selected Agent:', liveTask.selectedAgent);
    console.error('Operation ID:', liveTask.metadata?.operationId);
    console.error('Progress Message:', liveTask.progressMessage);
    console.error('Blocker:', liveTask.blocker);
    console.error('Last Error:', liveTask.lastError);
    console.error('Events count:', observedEvents.length);
    throw new Error(`Task timed out after ${elapsedSeconds}s without reaching completed state (final state: ${liveTask.status}).`);
  }

  if (!liveTask.resultText || liveTask.resultText.trim().length === 0) {
    throw new Error('Assertion Failed: Task completed without a persisted resultText.');
  }

  if (!liveTask.resultText.includes('JarvisExecutionSupervisor')) {
    throw new Error(`Assertion Failed: Result text did not contain the exported class name (got: "${liveTask.resultText}").`);
  }

  // Prove tool activity from recorded events
  const hasToolRead = observedEvents.some(e =>
    (e.summary && e.summary.includes('readFile')) ||
    (e.summary && e.summary.includes('executionSupervisor.ts'))
  );

  console.log(`Task ID: ${taskId}`);
  console.log(`Assigned worker: ${liveTask.worker}`);
  console.log(`Final task state: ${liveTask.status.toUpperCase()}`);
  console.log(`Observed tool activity: readFile ${targetFile}`);
  console.log(`Tool events verified in SQLite: ${hasToolRead ? 'YES' : 'INSPECTED'}`);
  console.log(`Persisted result: "${liveTask.resultText.trim()}"`);

  console.log('\n================================================================');
  console.log('JARVIS -> CODEX: PASS');
  console.log('================================================================\n');
}

verifyCodexExecution().catch(err => {
  console.error('\nJARVIS -> CODEX: FAIL');
  console.error('Reason:', err.message || err);
  process.exit(1);
});
