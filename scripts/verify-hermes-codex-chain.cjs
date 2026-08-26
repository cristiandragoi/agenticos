/**
 * Strict Fail-Closed Jarvis -> Hermes -> CodeX Delegation Chain Verifier
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

async function verifyHermesCodexChain() {
  console.log('================================================================');
  console.log('STRICT FAIL-CLOSED JARVIS -> HERMES -> CODEX CHAIN VERIFIER');
  console.log('================================================================\n');

  // Step 0: Clean active background tasks
  try {
    const tasksRes = await requestJson('GET', '/api/background-tasks?activeOnly=true');
    const tasks = Array.isArray(tasksRes.data) ? tasksRes.data : tasksRes.data?.tasks || [];
    for (const t of tasks) {
      await requestJson('POST', `/api/background-tasks/${t.taskId}/cancel`, {});
    }
  } catch {}

  // Step 1: Create test conversation
  const convRes = await requestJson('POST', '/api/jarvis/conversations', {
    title: 'Hermes to CodeX Delegation Chain Strict Verifier',
  });
  const convId = convRes.data?.id;
  if (!convId) throw new Error('Failed to create test conversation.');
  console.log(`Created conversation: ${convId}`);

  // Step 2: Submit multi-agent chain prompt
  const targetFile = 'server/src/domains/jarvis/executionSupervisor.ts';
  const prompt = `Have Hermes plan a verification of Jarvis heartbeat behavior, then have CodeX inspect ${targetFile} and return the exported supervisor class name. Do not modify files.`;
  console.log(`Submitting prompt: "${prompt}"`);

  const t0 = Date.now();
  const streamEvents = await streamPost(`/api/jarvis/conversations/${convId}/message/stream`, {
    prompt,
    operationId: `op-chain-strict-${Date.now()}`,
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
  console.log(`Polling task ${taskId} for multi-step execution...`);
  const maxWaitMs = 300000; // 5 minutes max budget for multi-step chain
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

  // Read task events from SQLite database
  try {
    const path = require('path');
    const fs = require('fs');
    const Database = require(path.resolve('server/node_modules/better-sqlite3'));
    const paths = [
      'C:/Users/Cris/AppData/Roaming/agenticos/data/agentic-os.db',
      path.resolve('server/data/agentic-os.db'),
    ];
    for (const p of paths) {
      if (fs.existsSync(p)) {
        try {
          const db = new Database(p, { readonly: true });
          const rows = db.prepare('SELECT * FROM background_task_events WHERE task_id = ?').all(taskId);
          if (rows && rows.length > 0) {
            observedEvents = rows;
            db.close();
            break;
          }
          db.close();
        } catch {}
      }
    }
  } catch {}

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
    throw new Error(`Chain task failed/cancelled (${liveTask.status}): ${liveTask.lastError || liveTask.blocker}`);
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
    throw new Error(`Chain task timed out after ${elapsedSeconds}s without reaching completed state (final state: ${liveTask.status}).`);
  }

  if (!liveTask.resultText || liveTask.resultText.trim().length === 0) {
    throw new Error('Assertion Failed: Chain task completed without a persisted resultText.');
  }

  if (!liveTask.resultText.includes('JarvisExecutionSupervisor')) {
    throw new Error(`Assertion Failed: Result text did not contain the expected class name (got: "${liveTask.resultText}").`);
  }

  // Verify Hermes plan evidence
  const hermesEvidence = observedEvents.some(e =>
    (e.summary && e.summary.toLowerCase().includes('hermes plan')) ||
    (e.detail && JSON.stringify(e.detail).toLowerCase().includes('planrunid'))
  );
  if (!hermesEvidence && !(liveTask.metadata?.hermesPlanRunId)) {
    throw new Error('Assertion Failed: No evidence of Hermes planning in task history.');
  }

  // Verify CodeX tool execution evidence
  const codexEvidence = observedEvents.some(e =>
    (e.summary && (e.summary.includes('readFile') || e.summary.includes('executionSupervisor.ts') || e.summary.includes('read_file'))) ||
    (e.detail && JSON.stringify(e.detail).includes('executionSupervisor.ts'))
  ) || (liveTask.metadata?.filesInspected && JSON.stringify(liveTask.metadata.filesInspected).includes('executionSupervisor.ts'))
    || (liveTask.resultText && liveTask.resultText.includes('executionSupervisor.ts'));
  if (!codexEvidence) {
    throw new Error('Assertion Failed: No evidence of CodeX tool file inspection in task history.');
  }

  console.log(`Task ID: ${taskId}`);
  console.log(`Assigned worker: ${liveTask.worker}`);
  console.log(`Final task state: ${liveTask.status.toUpperCase()}`);
  console.log(`Hermes planning evidence: VERIFIED`);
  console.log(`CodeX tool activity: readFile ${targetFile} (VERIFIED)`);
  console.log(`Persisted result:\n"${liveTask.resultText.trim()}"`);

  console.log('\n================================================================');
  console.log('JARVIS -> HERMES -> CODEX: PASS');
  console.log('================================================================\n');
}

verifyHermesCodexChain().catch(err => {
  console.error('\nJARVIS -> HERMES -> CODEX: FAIL');
  console.error('Reason:', err.message || err);
  process.exit(1);
});
