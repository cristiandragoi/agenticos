/**
 * End-to-End Live Verifier for Conversational Authority and Context Isolation
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

function streamPost(path, body, headers = {}) {
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
        ...headers,
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

async function verifyAuthorityE2E() {
  console.log('================================================================');
  console.log('LIVE CONVERSATIONAL AUTHORITY & CONTEXT ISOLATION VERIFIER');
  console.log('================================================================\n');

  // Step 1: Create test conversation
  const convRes = await requestJson('POST', '/api/jarvis/conversations', {
    title: 'Conversational Authority E2E Test',
  });
  const convId = convRes.data?.id;
  if (!convId) throw new Error('Failed to create test conversation.');
  console.log(`Created conversation: ${convId}`);

  // Test Case 1: Video / YouTube stream transcript
  console.log('\n[Test 1] Video / Media Stream Transcript');
  const ytPrompt = "Welcome back to the channel, don't forget to like and subscribe and hit the bell for more gameplay walkthroughs!";
  const ytEvents = await streamPost(`/api/jarvis/conversations/${convId}/message/stream`, {
    prompt: ytPrompt,
    operationId: `op-auth-yt-${Date.now()}`,
    inputChannel: 'audio',
  });
  const ytDone = ytEvents.find(e => e.event === 'done');
  const ytChunk = ytEvents.filter(e => e.event === 'chunk').map(e => e.data?.delta || '').join('');
  console.log(`Response: "${ytChunk}"`);
  if (ytDone?.data?.taskId) throw new Error('FAIL: Task created for YouTube ambient speech!');
  if (!ytChunk.includes('Was that meant for me?')) throw new Error('FAIL: Jarvis did not ask "Was that meant for me?"');
  console.log('✓ Video stream speech correctly intercepted with "Was that meant for me?" (0 tasks created).');

  // Test Case 2: Third-party background chatter
  console.log('\n[Test 2] Third-Party Background Chatter');
  const chatterPrompt = 'Honey what do you want for dinner tonight? Pass the salt please.';
  const chatterEvents = await streamPost(`/api/jarvis/conversations/${convId}/message/stream`, {
    prompt: chatterPrompt,
    operationId: `op-auth-chatter-${Date.now()}`,
    inputChannel: 'audio',
  });
  const chatterDone = chatterEvents.find(e => e.event === 'done');
  const chatterChunk = chatterEvents.filter(e => e.event === 'chunk').map(e => e.data?.delta || '').join('');
  console.log(`Response: "${chatterChunk}"`);
  if (chatterDone?.data?.taskId) throw new Error('FAIL: Task created for background chatter!');
  if (!chatterChunk.includes('Was that meant for me?')) throw new Error('FAIL: Jarvis did not ask "Was that meant for me?"');
  console.log('✓ Background chatter correctly intercepted with "Was that meant for me?" (0 tasks created).');

  // Test Case 3: System / Supervisor Event
  console.log('\n[Test 3] System / Supervisor Event Message');
  const sysPrompt = '[supervisor] State changed to RUNNING_ACTIVE, migration notice (tables already exist)';
  const sysEvents = await streamPost(`/api/jarvis/conversations/${convId}/message/stream`, {
    prompt: sysPrompt,
    operationId: `op-auth-sys-${Date.now()}`,
  });
  const sysDone = sysEvents.find(e => e.event === 'done');
  const sysChunk = sysEvents.filter(e => e.event === 'chunk').map(e => e.data?.delta || '').join('');
  console.log(`Response: "${sysChunk}"`);
  if (sysDone?.data?.taskId) throw new Error('FAIL: Task created for system event!');
  console.log('✓ System/supervisor event acknowledged as status without task creation.');

  // Test Case 4: Low Confidence Voice Input (55%)
  console.log('\n[Test 4] Low Confidence Voice Input (55%)');
  const lowConfPrompt = 'maybe we should change something in the database';
  const lowConfEvents = await streamPost(`/api/jarvis/conversations/${convId}/message/stream`, {
    prompt: lowConfPrompt,
    confidence: 0.55,
    operationId: `op-auth-lowconf-${Date.now()}`,
    inputChannel: 'audio',
  });
  const lowConfDone = lowConfEvents.find(e => e.event === 'done');
  const lowConfChunk = lowConfEvents.filter(e => e.event === 'chunk').map(e => e.data?.delta || '').join('');
  console.log(`Response: "${lowConfChunk}"`);
  if (lowConfDone?.data?.taskId) throw new Error('FAIL: Task created for low-confidence voice input!');
  if (!lowConfChunk.toLowerCase().includes('clarify') && !lowConfChunk.toLowerCase().includes('certain')) {
    throw new Error('FAIL: Jarvis did not request clarification for 55% confidence voice input.');
  }
  console.log('✓ 55% confidence voice input prompted clarification without operational execution.');

  // Test Case 5: User Disavowal ("no, that wasn't for you")
  console.log('\n[Test 5] User Disavowal ("no, that wasn\'t for you")');
  const disavowPrompt = "no, that wasn't for you";
  const disavowEvents = await streamPost(`/api/jarvis/conversations/${convId}/message/stream`, {
    prompt: disavowPrompt,
    operationId: `op-auth-disavow-${Date.now()}`,
    inputChannel: 'audio',
  });
  const disavowDone = disavowEvents.find(e => e.event === 'done');
  const disavowChunk = disavowEvents.filter(e => e.event === 'chunk').map(e => e.data?.delta || '').join('');
  console.log(`Response: "${disavowChunk}"`);
  if (disavowDone?.data?.taskId) throw new Error('FAIL: Task created for disavowal statement!');
  if (!disavowChunk.toLowerCase().includes('discarded')) {
    throw new Error('FAIL: Jarvis did not acknowledge discarding previous context.');
  }
  console.log('✓ Disavowal received and previous input discarded from operational context.');

  console.log('\n================================================================');
  console.log('CONVERSATIONAL AUTHORITY & CONTEXT ISOLATION: PASS');
  console.log('================================================================\n');
}

verifyAuthorityE2E().catch(err => {
  console.error('\nCONVERSATIONAL AUTHORITY: FAIL');
  console.error('Reason:', err.message || err);
  process.exit(1);
});
