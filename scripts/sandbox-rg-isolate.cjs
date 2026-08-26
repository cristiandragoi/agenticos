// sandbox-rg-isolate.cjs — isolate which rg search scope hangs.
const { runSandboxedCommand } = require('B:/AgenticOS/server/dist/utils/sandbox.js');

async function t(label, args, ws) {
  const t0 = Date.now();
  try {
    const r = await runSandboxedCommand('rg', args, undefined, ws);
    console.log(`OK   ${label}: ${Date.now() - t0}ms | ${r.stdout.split('\n').length} lines | ${r.stdout.slice(0,60).replace(/\n/g,' ')}`);
  } catch (e) {
    console.log(`ERR  ${label}: ${Date.now() - t0}ms | ${e.message.slice(0, 80)}`);
  }
}

(async () => {
  await t('scoped server/src', ['-n', '-m', '5', '-e', 'resumeCodexGoalLoop', 'server/src'], 'B:/AgenticOS');
  await t('scoped server/src/loops', ['-n', '-m', '5', '-e', 'resumeCodexGoalLoop', 'server/src/loops'], 'B:/AgenticOS');
  await t('minimal no-excludes (whole repo)', ['-l', '-e', 'resumeCodexGoalLoop'], 'B:/AgenticOS');
  await t('whole repo with excludes', ['-n', '--no-heading', '-m', '5', '-g', '!node_modules', '-g', '!.git', '-e', 'resumeCodexGoalLoop'], 'B:/AgenticOS');
  await t('scoped server (excludes)', ['-n', '--no-heading', '-m', '5', '-g', '!node_modules', '-g', '!.git', '-e', 'resumeCodexGoalLoop', 'server'], 'B:/AgenticOS');
  console.log('DONE');
})().catch(e => console.error('FATAL', e));
