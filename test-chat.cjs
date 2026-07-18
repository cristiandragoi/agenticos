const http = require('http');

const postData = JSON.stringify({ agentId: 'agent-hermes', message: 'Hello from verification script' });

const req = http.request({
  hostname: 'localhost',
  port: 4000,
  path: '/api/chat/message',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(postData)
  }
}, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    const runId = JSON.parse(data).runId;
    console.log('[POST /api/chat/message] Response:', data);
    console.log('[SSE] Subscribing to /api/stream/' + runId);

    http.get(`http://localhost:4000/api/stream/${runId}`, (sseRes) => {
      sseRes.on('data', chunk => {
        const text = chunk.toString();
        if (text.trim()) {
           console.log(text.trim());
        }
      });
      sseRes.on('end', () => console.log('[SSE] Connection closed'));
    });
  });
});

req.write(postData);
req.end();
