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
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: data });
        } catch (e) {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function main() {
  const conv = await postJSON('/api/jarvis/conversations', { title: 'Voice Stream Test' });
  console.log('Created conv:', conv);
  const convId = JSON.parse(conv.body).id;

  const streamRes = await postJSON(`/api/jarvis/conversations/${convId}/message/stream`, {
    prompt: 'Open the Notion and Agentic workflow template',
    channel: 'voice',
    workspaceContext: {
      activeModule: 'revenue-operator',
      activeRoute: '/revenue-operator'
    }
  });

  console.log('Stream response (first 600 chars):\n', streamRes.body.substring(0, 600));
}

main().catch(console.error);
