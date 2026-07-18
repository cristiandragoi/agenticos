const { spawn } = require('child_process');

const server = spawn('npx.cmd', ['tsx', 'src/index.ts'], { cwd: 'server', shell: true });
server.stdout.on('data', d => console.log('[Server]', d.toString()));
server.stderr.on('data', d => console.error('[Server Err]', d.toString()));

const client = spawn('npm.cmd', ['run', 'dev', '--', '--host', '127.0.0.1', '--port', '4175', '--strictPort'], { cwd: process.cwd(), shell: true });
client.stdout.on('data', d => console.log('[Client]', d.toString()));
client.stderr.on('data', d => console.error('[Client Err]', d.toString()));

setTimeout(() => {
  console.log('--- Running Puppeteer ---');
  const capture = spawn('node', ['capture-proofs.js'], { cwd: process.cwd(), shell: true });
  capture.stdout.on('data', d => console.log('[Capture]', d.toString()));
  capture.stderr.on('data', d => console.error('[Capture Err]', d.toString()));
  capture.on('exit', () => {
    console.log('Capture finished, stopping servers...');
    server.kill();
    client.kill();
    process.exit(0);
  });
}, 15000);
