const http = require('http');
const fs = require('fs');
const path = require('path');

const text = 'Hello, this is Jarvis. System is fully operational.';
const postData = JSON.stringify({ text });

const req = http.request(
  {
    hostname: '127.0.0.1',
    port: 4600,
    path: '/api/voice/speak',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData),
    },
  },
  (res) => {
    console.log('STATUS:', res.statusCode);
    console.log('HEADERS:', res.headers);
    const chunks = [];
    res.on('data', (d) => chunks.push(d));
    res.on('end', () => {
      const buf = Buffer.concat(chunks);
      console.log('RECEIVED_BYTES:', buf.length);
      const outPath = path.join(__dirname, '..', '.agentic', 'runtime', 'direct-speak.mp3');
      fs.writeFileSync(outPath, buf);
      console.log('SAVED_TO:', outPath);
    });
  }
);

req.on('error', (e) => console.error('ERROR:', e.message));
req.write(postData);
req.end();
