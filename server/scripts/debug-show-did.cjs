const http = require('http');

function postJSON(path, payload) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(payload);
    const req = http.request({
      hostname: '127.0.0.1',
      port: 4600,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function main() {
  const conv = await postJSON('/api/jarvis/conversations', { title: 'Evidence Test' });
  const convId = JSON.parse(conv.body).id;

  // 1. First send open notion template
  await postJSON(`/api/jarvis/conversations/${convId}/message/stream`, {
    prompt: 'Open the Notion and Agentic workflow template',
    channel: 'typed',
    workspaceContext: {
      activeModule: 'revenue-operator',
      activeRoute: '/revenue-operator'
    }
  });

  // 2. Now send "Show me what you did"
  const streamRes = await postJSON(`/api/jarvis/conversations/${convId}/message/stream`, {
    prompt: 'Show me what you did',
    channel: 'typed',
    workspaceContext: {
      activeModule: 'revenue-operator',
      activeRoute: '/revenue-operator'
    }
  });

  console.log('Show me what you did response:\n', streamRes.body);
}

main().catch(console.error);
