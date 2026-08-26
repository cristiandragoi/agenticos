// sandbox-search-new.cjs — verify the NEW searchFiles args complete fast.
const { runSandboxedCommand } = require('B:/AgenticOS/server/dist/utils/sandbox.js');

(async () => {
  const exclude = [
    '-g', '!node_modules', '-g', '!**/node_modules/**',
    '-g', '!.git', '-g', '!dist', '-g', '!dist-electron',
    '-g', '!release', '-g', '!build', '-g', '!exports',
    '-g', '!ollama-models', '-g', '!test-results',
    '-g', '!docs/backups', '-g', '!.tmp', '-g', '!scratch',
  ];
  const args = ['-n', '--no-heading', '--no-follow', '--max-columns', '200', '-m', '30', ...exclude, '-e', 'resumeCodexGoalLoop', '.'];
  const t0 = Date.now();
  try {
    const r = await runSandboxedCommand('rg', args, undefined, 'B:/AgenticOS', 120000);
    console.log(`OK ${Date.now() - t0}ms | ${r.stdout.split('\n').length} lines`);
    console.log(r.stdout.split('\n').slice(0, 6).join('\n'));
  } catch (e) {
    console.log(`ERR ${Date.now() - t0}ms | ${e.message.slice(0, 200)}`);
  }
})();
