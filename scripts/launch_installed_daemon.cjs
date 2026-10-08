const { spawn } = require('child_process');
const path = 'C:\\Users\\cd-pr\\AppData\\Local\\Programs\\AgenticOS\\AgenticOS.exe';

console.log('[Launcher] Starting installed AgenticOS from:', path);
const proc = spawn(path, ['--remote-debugging-port=9222'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    ...(process.env.AGENTOS_API_TOKEN ? { AGENTOS_API_TOKEN: process.env.AGENTOS_API_TOKEN } : {}),
    NODE_ENV: 'production'
  }
});

proc.on('spawn', () => {
  console.log('[Launcher] AgenticOS running with PID:', proc.pid);
});

proc.on('exit', (code, signal) => {
  console.log('[Launcher] AgenticOS exited with code:', code, 'signal:', signal);
});
