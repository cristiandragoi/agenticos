const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const exe = 'C:\\Users\\cd-pr\\AppData\\Local\\Programs\\AgenticOS\\AgenticOS.exe';
console.log('Testing launch of:', exe);
console.log('Exists:', fs.existsSync(exe));

const child = spawn(exe, ['--enable-logging'], {
  env: {
    ...process.env,
    ELECTRON_ENABLE_LOGGING: '1',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

console.log('Spawned PID:', child.pid);

child.stdout.on('data', (d) => {
  console.log('[STDOUT]', d.toString());
});

child.stderr.on('data', (d) => {
  console.log('[STDERR]', d.toString());
});

child.on('error', (err) => {
  console.error('[ERROR]', err);
});

child.on('exit', (code, signal) => {
  console.log('[EXIT] code:', code, 'signal:', signal);
  process.exit(0);
});

setTimeout(() => {
  console.log('Process still running after 5s.');
  process.exit(0);
}, 6000);
