const { spawn } = require('child_process');

const exe = 'C:\\Users\\cd-pr\\AppData\\Local\\Programs\\AgenticOS\\AgenticOS.exe';
const child = spawn(exe, [], {
  detached: true,
  stdio: 'ignore',
  windowsHide: false,
});
child.unref();
console.log('Launched AgenticOS PID:', child.pid);
