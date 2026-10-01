const http = require('http');

function post(path, data) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(data);
    const req = http.request({
      hostname: '127.0.0.1',
      port: 4600,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function run() {
  console.log('--- Step 0: Create Conversation ---');
  const convRes = await post('/api/jarvis/conversations', { title: 'Live pipeline e2e test' });
  const convData = JSON.parse(convRes.body);
  const conversationId = convData.id || convData.conversationId;
  console.log('Created conversation:', conversationId);

  console.log('\n--- TEST 1: Discuss Free Cash ---');
  const r1 = await post(`/api/jarvis/conversations/${conversationId}/message/stream`, {
    prompt: 'Check the Free Cash project status',
    operationId: 'op-1',
    inputChannel: 'typed',
  });
  console.log('Turn 1 Status:', r1.status);
  console.log('Turn 1 Output (first 300 chars):', r1.body.slice(0, 300));

  console.log('\n--- TEST 2: Immediately ask "how much is 2 plus 2?" ---');
  const r2 = await post(`/api/jarvis/conversations/${conversationId}/message/stream`, {
    prompt: 'how much is 2 plus 2?',
    operationId: 'op-2',
    inputChannel: 'typed',
  });
  console.log('Turn 2 Status:', r2.status);
  console.log('Turn 2 Output:\n', r2.body);

  console.log('\n--- TEST 3: Ask unrelated question "what is the capital of France?" ---');
  const r3 = await post(`/api/jarvis/conversations/${conversationId}/message/stream`, {
    prompt: 'what is the capital of France?',
    operationId: 'op-3',
    inputChannel: 'typed',
  });
  console.log('Turn 3 Status:', r3.status);
  console.log('Turn 3 Output (first 300 chars):', r3.body.slice(0, 300));
}

run().catch(console.error);
