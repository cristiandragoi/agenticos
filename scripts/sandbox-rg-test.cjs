// sandbox-rg-test.cjs — reproduce the searchFiles rg timeout inside the sandbox.
const { runSandboxedCommand } = require('B:/AgenticOS/server/dist/utils/sandbox.js');
const fs = require('fs');

(async () => {
  console.log('=== test 1: rg --version in sandbox ===');
  const t0 = Date.now();
  try {
    const r = await runSandboxedCommand('rg', ['--version'], undefined, 'B:/AgenticOS');
    console.log('OK', Date.now() - t0, 'ms |', r.stdout.slice(0, 40));
  } catch (e) { console.log('ERR', Date.now() - t0, 'ms |', e.message.slice(0, 120)); }

  console.log('\n=== test 2: searchFiles rg args in sandbox (timed) ===');
  const t1 = Date.now();
  try {
    const args = ['-n', '--no-heading', '--max-columns', '200', '-m', '30', '-g', '!node_modules', '-g', '!.git', '-e', 'resumeCodexGoalLoop'];
    const r = await runSandboxedCommand('rg', args, undefined, 'B:/AgenticOS');
    console.log('OK', Date.now() - t1, 'ms | lines:', r.stdout.split('\n').length, '|', r.stdout.slice(0, 120));
  } catch (e) { console.log('ERR', Date.now() - t1, 'ms |', e.message.slice(0, 300)); }

  console.log('\n=== test 3: npm --version in sandbox ===');
  const t2 = Date.now();
  try {
    const r = await runSandboxedCommand('npm', ['--version'], undefined, 'B:/AgenticOS');
    console.log('OK', Date.now() - t2, 'ms |', r.stdout.slice(0, 40));
  } catch (e) { console.log('ERR', Date.now() - t2, 'ms |', e.message.slice(0, 200)); }

  console.log('\n=== temp file state ===');
  const tmp = 'B:/AgenticOS/server/src/__tests__/phase2AcceptanceTmp.test.ts';
  console.log('exists:', fs.existsSync(tmp));
  if (fs.existsSync(tmp)) console.log(fs.readFileSync(tmp, 'utf-8').slice(0, 300));
})().catch(e => console.error('FATAL', e));
