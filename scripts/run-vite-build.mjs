import { spawnSync } from 'node:child_process';
const r = spawnSync('npx', ['vite', 'build'], { cwd: 'B:/AgenticOS', encoding: 'utf8', shell: true, timeout: 300000 });
console.log(r.stdout ? r.stdout.slice(-800) : '');
if (r.stderr) console.error(r.stderr.slice(-400));
console.log('BUILD-EXIT', r.status);
process.exit(r.status ?? 1);
