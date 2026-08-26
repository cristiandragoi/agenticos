// sandbox-npx-test.cjs — verify npx vitest works via the sandbox (no --prefer-offline loop).
const { runSandboxedCommand } = require('B:/AgenticOS/server/dist/utils/sandbox.js');

(async () => {
  const t0 = Date.now();
  try {
    const r = await runSandboxedCommand('npx', ['vitest', '--version'], undefined, 'B:/AgenticOS', 60000);
    console.log(`OK ${Date.now() - t0}ms | ${r.stdout.slice(0, 80)}`);
  } catch (e) {
    console.log(`ERR ${Date.now() - t0}ms | ${e.message.slice(0, 300)}`);
  }
})();
