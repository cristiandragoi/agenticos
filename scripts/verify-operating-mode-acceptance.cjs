const http = require('http');

const PORT = 4000;
const BASE_URL = `http://127.0.0.1:${PORT}`;

function requestJson(method, path, body = null, retries = 3) {
  return new Promise((resolve, reject) => {
    const attempt = (remaining) => {
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
      req.on('error', (err) => {
        if (remaining > 0) {
          setTimeout(() => attempt(remaining - 1), 1000);
        } else {
          reject(err);
        }
      });
      if (postData) req.write(postData);
      req.end();
    };
    attempt(retries);
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
  console.log('OPERATING-MODE REVENUE ORCHESTRATION ACCEPTANCE VERIFICATION');
  console.log('================================================================\n');

  // Step 1: Health check
  console.log('[1/4] Checking backend health...');
  const health = await requestJson('GET', '/api/health');
  if (health.status !== 200) {
    throw new Error(`Backend not healthy: status ${health.status}`);
  }
  console.log('✓ Backend online.');

  // Clean up any stale active background tasks to free concurrency slots
  try {
    const listRes = await requestJson('GET', '/api/background-tasks');
    const tasks = listRes.data?.tasks || [];
    for (const t of tasks) {
      if (['running', 'queued', 'planning', 'waiting_approval'].includes(t.status)) {
        await requestJson('POST', `/api/background-tasks/${t.taskId}/stop`, { reason: 'Test cleanup' });
      }
    }
  } catch {}

  // Step 2: Create conversation
  console.log('\n[2/4] Creating conversation for operating-mode test...');
  const convRes = await requestJson('POST', '/api/jarvis/conversations', {
    title: 'Operating Mode Revenue Test',
  });
  const conversationId = convRes.data?.id;
  if (!conversationId) throw new Error('Failed to create test conversation');
  console.log(`✓ Conversation created: ${conversationId}`);

  // Step 3: Send user prompt
  const prompt = `Jarvis, switch from stabilization mode to operating mode. Have Hermes identify the three highest-leverage revenue opportunities we can execute with Agentic OS as it exists today. For each opportunity, validate feasibility using Codex with read-only repository inspection only. Do not modify files. Return a concise ranked recommendation with expected effort, time-to-revenue, dependencies, and the first concrete action for each option.`;
  console.log(`\n[3/4] Submitting prompt to Jarvis:\n"${prompt}"\n`);

  const streamEvents = await streamPost(`/api/jarvis/conversations/${conversationId}/message/stream`, {
    prompt,
    operationId: `op-opmode-${Date.now()}`,
    inputChannel: 'typed',
  });

  const ackEvent = streamEvents.find(e => e.event === 'chunk' || e.event === 'message');
  const doneEvent = streamEvents.find(e => e.event === 'done');
  const taskId = doneEvent?.data?.taskId;

  console.log(`✓ Stream events received: ${streamEvents.length}`);
  console.log(`✓ Immediate Ack: "${ackEvent?.data?.delta || ackEvent?.data?.content || '(none)'}"`);
  if (!taskId) throw new Error('No background taskId received in Jarvis response');
  console.log(`✓ Background Task ID: ${taskId}`);

  // Step 4: Poll task lifecycle until completed
  console.log('\n[4/4] Polling background task execution...');
  const maxWaitMs = 600000;
  const start = Date.now();
  let completedTask = null;

  while (Date.now() - start < maxWaitMs) {
    const bgRes = await requestJson('GET', `/api/background-tasks/${taskId}`);
    const task = bgRes.data?.task || bgRes.data;
    if (task) {
      process.stdout.write(`\r  Status: [${task.status}] Stage: [${task.currentStage || 'active'}] (elapsed: ${Math.round((Date.now() - start)/1000)}s)`);
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
  console.log('\n----------------------------------------------------------------');
  console.log('FINAL RESULT TEXT:');
  console.log('----------------------------------------------------------------');
  console.log(completedTask.resultText || '(none)');
  console.log('----------------------------------------------------------------\n');

  if (completedTask.status !== 'completed') {
    throw new Error(`Task expected status completed, got: ${completedTask.status} (Error: ${completedTask.lastError})`);
  }

  const resultText = completedTask.resultText || '';
  const normalized = resultText.toLowerCase();

  // Acceptance Assertions
  if (!resultText.trim()) {
    throw new Error('Result text was empty.');
  }

  // 1. Must NOT be low-level worker file error
  if (/^No matching files found/i.test(resultText.trim()) || /^Error: /i.test(resultText.trim())) {
    throw new Error(`Result contains raw low-level worker error: "${resultText}"`);
  }

  // 2. Read-only verification: no files changed
  if (completedTask.filesChanged && completedTask.filesChanged.length > 0) {
    throw new Error(`Task modified files during read-only inspection: ${completedTask.filesChanged.join(', ')}`);
  }
  console.log('✓ Read-only constraint verified: 0 files modified.');

  // 3. Must contain opportunities / ranked items
  const hasMultipleOpportunities =
    (normalized.includes('opportunity 1') && normalized.includes('opportunity 2')) ||
    (normalized.includes('1.') && normalized.includes('2.') && normalized.includes('3.')) ||
    (normalized.includes('ranked') && (normalized.includes('1') || normalized.includes('first')));

  if (!hasMultipleOpportunities) {
    throw new Error(`Result did not contain multiple ranked opportunities:\n${resultText}`);
  }
  console.log('✓ Ranked revenue opportunities identified.');

  // 4. Must contain strategic criteria: effort, time-to-revenue, dependencies, first action
  const hasEffort = normalized.includes('effort') || normalized.includes('hours') || normalized.includes('days') || normalized.includes('scope');
  const hasTime = normalized.includes('time') || normalized.includes('revenue') || normalized.includes('timeline') || normalized.includes('hour') || normalized.includes('day') || normalized.includes('week');
  const hasDeps = normalized.includes('dependenc') || normalized.includes('require') || normalized.includes('keys') || normalized.includes('prereq');
  const hasAction = normalized.includes('action') || normalized.includes('step') || normalized.includes('execute') || normalized.includes('first');

  if (!hasEffort) throw new Error(`Missing expected effort details in result:\n${resultText}`);
  if (!hasTime) throw new Error(`Missing expected time-to-revenue in result:\n${resultText}`);
  if (!hasDeps) throw new Error(`Missing expected dependencies in result:\n${resultText}`);
  if (!hasAction) throw new Error(`Missing expected first concrete action in result:\n${resultText}`);

  console.log('✓ All strategic deliverable criteria verified (Effort, Time-to-Revenue, Dependencies, First Action).');

  console.log('\n================================================================');
  console.log('✓ ALL OPERATING-MODE REVENUE ACCEPTANCE CHECKS PASSED');
  console.log('================================================================\n');
}

run().then(() => {
  process.exit(0);
}).catch(err => {
  console.error('\n❌ ACCEPTANCE VERIFICATION FAILED:');
  console.error('Reason:', err.message || err);
  process.exit(1);
});
