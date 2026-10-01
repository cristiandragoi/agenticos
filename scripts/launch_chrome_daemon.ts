import { spawn } from 'child_process';
import path from 'path';

const profileDir = path.join(process.env.TEMP || 'C:\\Temp', 'agenticos-visible-browser');
const exe = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const port = 9223;

console.log('Spawning Chrome detached...');
const p = spawn(
  exe,
  [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--start-maximized',
    'https://www.google.com',
  ],
  {
    detached: true,
    stdio: 'ignore',
  }
);
p.unref();
console.log('Spawned PID:', p.pid);
setTimeout(() => {
  console.log('Daemon launcher exiting, Chrome continues.');
  process.exit(0);
}, 3000);
