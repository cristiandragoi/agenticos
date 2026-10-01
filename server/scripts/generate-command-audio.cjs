const http = require('http');
const fs = require('fs');

const payload = JSON.stringify({
  text: "Open the Notion and Agentic workflow template",
  voice: "en-GB-RyanNeural"
});

const req = http.request({
  hostname: '127.0.0.1',
  port: 4600,
  path: '/api/voice/tts',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload)
  }
}, (res) => {
  const chunks = [];
  res.on('data', c => chunks.push(c));
  res.on('end', () => {
    const buf = Buffer.concat(chunks);
    fs.writeFileSync('D:/AgenticOS/server/scripts/notion_command.mp3', buf);
    console.log('Saved audio:', buf.length, 'bytes. Content-Type:', res.headers['content-type']);
  });
});

req.on('error', console.error);
req.write(payload);
req.end();
