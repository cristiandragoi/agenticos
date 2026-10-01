const { spawn } = require('child_process');

const exe = 'C:\\Users\\cd-pr\\AppData\\Local\\Programs\\AgenticOS\\AgenticOS.exe';
const child = spawn(exe, [], {
  stdio: ['ignore', 'pipe', 'pipe'],
});

child.stdout.on('data', d => process.stdout.write('[STDOUT] ' + d));
child.stderr.on('data', d => process.stderr.write('[STDERR] ' + d));
child.on('exit', (c, s) => {
  console.log('[EXIT] code:', c, 'signal:', s);
  process.exit(0);
});

setTimeout(() => {
  console.log('Still alive at 10s!');
}, 10000);
