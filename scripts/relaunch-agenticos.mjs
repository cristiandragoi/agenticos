// Relaunch the deployed packaged Agentic OS with a CDP debugging port.
// Spawns detached (the app owns its lifecycle); prints the PID.
import { spawn } from 'child_process';

const path = 'C:\\Users\\Cris\\Desktop\\desktop\\Agentic_OS\\Agentic OS\\Agentic OS.exe';
const proc = spawn(path, ['--remote-debugging-port=9223'], {
  detached: true,
  stdio: 'ignore',
  windowsHide: false,
});
proc.unref();
console.log('LAUNCHED_PID=' + proc.pid);
setTimeout(() => process.exit(0), 2000);
