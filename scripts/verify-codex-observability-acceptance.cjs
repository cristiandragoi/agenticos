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

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function run() {
  console.log('================================================================');
  console.log('CODEX UI & RUNTIME OBSERVABILITY ACCEPTANCE VERIFICATION');
  console.log('================================================================\n');

  // Step 1: Health check
  console.log('[1/5] Checking backend health...');
  const health = await requestJson('GET', '/api/health');
  if (health.status !== 200) {
    throw new Error(`Backend not healthy: status ${health.status}`);
  }
  console.log('✓ Backend online.');

  // Step 2: Create conversation
  console.log('\n[2/5] Creating conversation for acceptance test...');
  const convRes = await requestJson('POST', '/api/jarvis/conversations', {
    title: 'CodeX Observability Test',
  });
  const conversationId = convRes.data?.id;
  if (!conversationId) throw new Error('Failed to create test conversation');
  console.log(`✓ Conversation created: ${conversationId}`);

  // Step 3: Send read-only task to Jarvis
  console.log('\n[3/5] Submitting task to Jarvis: "Have Codex inspect server/src/domains/jarvis/executionSupervisor.ts and return the exported supervisor class name. Do not modify files."');
  const prompt = 'Have Codex inspect server/src/domains/jarvis/executionSupervisor.ts and return the exported supervisor class name. Do not modify files.';
  const streamEvents = await streamPost(`/api/jarvis/conversations/${conversationId}/message/stream`, {
    prompt,
    operationId: `op-obs-${Date.now()}`,
    inputChannel: 'typed',
  });

  console.log(`✓ Stream events received: ${streamEvents.length}`);
  const doneEvent = streamEvents.find(e => e.event === 'done');
  const taskId = doneEvent?.data?.taskId;

  if (!taskId) {
    throw new Error('No background taskId received in Jarvis ack stream');
  }
  console.log(`✓ Background Task ID: ${taskId}`);

  // Step 4: Poll lifecycle until terminal
  console.log('\n[4/5] Polling CodeX task execution and live activity...');
  const maxWaitMs = 120000;
  const start = Date.now();
  let completedTask = null;

  while (Date.now() - start < maxWaitMs) {
    const bgRes = await requestJson('GET', `/api/background-tasks/${taskId}`);
    const task = bgRes.data?.task || bgRes.data;
    if (task) {
      process.stdout.write(`\r  Status: [${task.status}] Progress: ${task.progressMessage || 'running'} (elapsed: ${Math.round((Date.now() - start)/1000)}s)`);
      if (['completed', 'failed', 'cancelled', 'blocked'].includes(task.status)) {
        completedTask = task;
        console.log('\n');
        break;
      }
    }
    await sleep(2000);
  }

  if (!completedTask) {
    throw new Error(`Task ${taskId} did not complete within ${maxWaitMs/1000}s`);
  }

  console.log(`✓ Task finished with status: ${completedTask.status}`);
  console.log(`  Result text:\n${completedTask.resultText || '(none)'}`);

  // Assertions
  if (completedTask.status !== 'completed') {
    throw new Error(`Task expected status completed, got: ${completedTask.status} (Error: ${completedTask.lastError})`);
  }

  if (!completedTask.resultText || !completedTask.resultText.includes('JarvisExecutionSupervisor')) {
    throw new Error(`Result text did not contain expected class name 'JarvisExecutionSupervisor': ${completedTask.resultText}`);
  }
  console.log('✓ Class name JarvisExecutionSupervisor verified in result!');

  // Step 5: Query Jarvis "What did Codex do?"
  console.log('\n[5/5] Testing Jarvis query: "What did Codex do?"');
  const queryEvents = await streamPost(`/api/jarvis/conversations/${conversationId}/message/stream`, {
    prompt: 'What did Codex do?',
    operationId: `op-query-${Date.now()}`,
    inputChannel: 'typed',
  });

  const replyText = queryEvents
    .filter(e => e.event === 'chunk' || e.event === 'token' || e.event === 'message')
    .map(e => e.data?.delta || e.data?.content || '')
    .join('');

  console.log(`✓ Jarvis reply:\n"${replyText}"`);

  const normalized = replyText.toLowerCase();

  if (!replyText.trim()) {
    throw new Error('Jarvis returned an empty completed-task summary.');
  }

  if (/^The last completed task was ["']Final Result["'] by codex\.$/i.test(replyText.trim())) {
    throw new Error(
      `Jarvis returned useless placeholder instead of real task summary: "${replyText}"`
    );
  }

  if (!replyText.includes('JarvisExecutionSupervisor')) {
    throw new Error(
      `Jarvis reply did not contain JarvisExecutionSupervisor: "${replyText}"`
    );
  }

  if (
    !normalized.includes('executionsupervisor.ts') &&
    !normalized.includes('server/src/domains/jarvis/executionsupervisor.ts')
  ) {
    throw new Error(
      `Jarvis reply did not identify the inspected file: "${replyText}"`
    );
  }

  if (
    !normalized.includes('inspect') &&
    !normalized.includes('read')
  ) {
    throw new Error(
      `Jarvis reply did not contain actual file-inspection evidence: "${replyText}"`
    );
  }

  console.log('✓ Jarvis completed-summary response verified with real execution evidence and class name!');

  console.log('\n================================================================');
  console.log('✓ ALL OBSERVABILITY & SUPERVISOR ACCEPTANCE CHECKS PASSED');
  console.log('================================================================\n');
}

run().then(() => {
  process.exit(0);
}).catch(err => {
  console.error('\n❌ ACCEPTANCE VERIFICATION FAILED:');
  console.error('Reason:', err.message || err);
  process.exit(1);
});
