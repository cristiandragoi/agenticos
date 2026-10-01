const http = require('http');

async function testTurn(prompt, conversationId = 'conv-main') {
  console.log(`\n======================================================`);
  console.log(`TESTING LIVE TURN: "${prompt}"`);
  console.log(`======================================================`);

  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: 'localhost',
      port: 4600,
      path: `/api/jarvis/conversations/${conversationId}/message/stream`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      }
    }, (res) => {
      console.log('STATUS:', res.statusCode);
      let buffer = '';
      res.on('data', (chunk) => {
        const text = chunk.toString();
        buffer += text;
        console.log('CHUNK:', text);
      });
      res.on('end', () => {
        console.log('STREAM COMPLETED.');
        resolve(buffer);
      });
    });

    req.on('error', (e) => {
      console.error('Request error:', e);
      reject(e);
    });

    req.write(JSON.stringify({ prompt }));
    req.end();
  });
}

async function run() {
  const convRes = await fetch('http://localhost:4600/api/jarvis/conversations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });
  const conv = await convRes.json();
  const convId = conv.id;
  console.log('CREATED TEST CONVERSATION:', convId);

  await testTurn("Find the Free Cash project.", convId);
  await testTurn("Open the Free Cash project so I can see it.", convId);
  await testTurn("No, it didn't open. Open it again.", convId);
  await testTurn("Where in the code is Revenue Operator implemented?", convId);
}

run().catch(console.error);
