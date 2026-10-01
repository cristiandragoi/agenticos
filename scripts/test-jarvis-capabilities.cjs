const http = require('http');

function postJson(path, data) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(data);
    const req = http.request({
      hostname: '127.0.0.1',
      port: 4600,
      path: path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(body) });
        } catch {
          resolve({ status: res.statusCode, headers: res.headers, raw: body });
        }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function streamPost(path, data, onEvent) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(data);
    const req = http.request({
      hostname: '127.0.0.1',
      port: 4600,
      path: path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    }, (res) => {
      console.log('Stream status:', res.statusCode, 'headers:', res.headers['content-type']);
      let buffer = '';
      res.on('data', chunk => {
        buffer += chunk.toString();
        const blocks = buffer.split('\n\n');
        buffer = blocks.pop();
        for (const block of blocks) {
          const lines = block.split('\n');
          let eventType = 'message';
          let dataStr = '';
          for (const line of lines) {
            if (line.startsWith('event: ')) eventType = line.slice(7).trim();
            else if (line.startsWith('data: ')) dataStr = line.slice(6).trim();
          }
          if (dataStr) {
            try {
              const parsed = JSON.parse(dataStr);
              onEvent({ event: eventType, data: parsed });
            } catch (e) {
              onEvent({ event: eventType, raw: dataStr });
            }
          }
        }
      });
      res.on('end', resolve);
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function run() {
  console.log('--- 1. Create Conversation ---');
  const conv = await postJson('/api/jarvis/conversations', {});
  const convId = conv.body.id;
  console.log('Created conversation:', convId);

  console.log('\n--- 2. Test "Open Revenue Operator" ---');
  const eventsOpen = [];
  await streamPost(`/api/jarvis/conversations/${convId}/message/stream`, {
    prompt: 'Open Revenue Operator',
    workspaceContext: { activeModule: 'jarvis-command-center', activeRoute: '/jarvis' },
  }, (evt) => {
    eventsOpen.push(evt);
    if (evt.event === 'navigation') {
      console.log('>> RECEIVED NAVIGATION EVENT:', evt.data);
    }
    if (evt.event === 'chunk') {
      process.stdout.write(evt.data.delta || '');
    }
  });
  console.log('\nNavigation events:', eventsOpen.filter(e => e.event === 'navigation').map(e => e.data));

  console.log('\n--- 3. Test "Start Revenue Operator" ---');
  const eventsStart = [];
  await streamPost(`/api/jarvis/conversations/${convId}/message/stream`, {
    prompt: 'Start Revenue Operator',
    workspaceContext: { activeModule: 'revenue-operator', activeRoute: '/revenue-operator' },
  }, (evt) => {
    eventsStart.push(evt);
    if (evt.event === 'action_status') {
      console.log('>> RECEIVED ACTION_STATUS EVENT:', JSON.stringify(evt.data, null, 2));
    }
    if (evt.event === 'chunk') {
      process.stdout.write(evt.data.delta || '');
    }
  });
  console.log('\nAction status events count:', eventsStart.filter(e => e.event === 'action_status').length);

  console.log('\n\n--- 4. Test Workspace Contextual Question "What is happening here?" on /revenue-operator ---');
  await streamPost(`/api/jarvis/conversations/${convId}/message/stream`, {
    prompt: 'What is happening here?',
    workspaceContext: { activeModule: 'revenue-operator', activeRoute: '/revenue-operator' },
  }, (evt) => {
    if (evt.event === 'chunk' || evt.event === 'token') {
      process.stdout.write(evt.data?.delta || evt.data?.token || '');
    }
  });
  console.log('\n\nALL TESTS FINISHED');
}

run().catch(console.error);
