const { spawn } = require('child_process');
const path = 'C:\\Users\\Cris\\Desktop\\desktop\\Agentic_OS\\Agentic OS\\Agentic OS.exe';

console.log('[Launcher] Starting', path);
const proc = spawn(path, ['--remote-debugging-port=9222'], {
  stdio: 'inherit'
});

proc.on('spawn', () => {
  console.log('[Launcher] Process spawned successfully with PID:', proc.pid);
});

proc.on('exit', (code, signal) => {
  console.log('[Launcher] Process exited with code:', code, 'signal:', signal);
});
