const http = require('http');

const payload = JSON.stringify({
  prompt: "Create a simple Python script to fetch the current weather for a city and save the output to a text file.",
  workspacePath: "B:\\AgenticOS"
});

const req = http.request({
  hostname: 'localhost',
  port: 4001,
  path: '/api/teams/preview',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': payload.length
  }
}, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    console.log(`Status: ${res.statusCode}`);
    console.log(JSON.stringify(JSON.parse(data), null, 2));
    process.exit(0);
  });
});

req.on('error', (e) => {
  console.error(e);
  process.exit(1);
});

req.write(payload);
req.end();
