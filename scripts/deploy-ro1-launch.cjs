/* RO1 deploy: launch packaged app detached */
const { spawn } = require('child_process');
const exe = 'C:\\Users\\Cris\\Desktop\\desktop\\Agentic_OS\\Agentic OS\\Agentic OS.exe';
const child = spawn(exe, [], {
  cwd: 'C:\\Users\\Cris\\Desktop\\desktop\\Agentic_OS\\Agentic OS',
  detached: true,
  stdio: 'ignore',
  windowsHide: false,
});
child.unref();
console.log('spawned pid', child.pid);
