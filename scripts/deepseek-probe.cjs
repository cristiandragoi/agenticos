// Probe DeepSeek directly via the gateway path (llmChat) on 4001 and capture the raw error.
const { execSync } = require('child_process');
const out = execSync(
  `curl -s -m 25 -X POST "http://127.0.0.1:4001/api/settings/agent-provider-assignments/agent-codex/test"`,
  { encoding: 'utf8', shell: 'bash' }
);
console.log('TEST RESULT:', out);
// Now grab the tail of the backend log for the underlying DeepSeek error
const log = execSync(`tail -40 "$LOCALAPPDATA/Temp/agenticos-source-backend.log"`, { encoding: 'utf8', shell: 'bash' });
const lines = log.split('\n').filter(l => /DeepSeek|offline|fetch failed|ECONN|unreachable|ENOTFOUND|ETIMEDOUT|HTTP|401|402|429|ERROR|error/i.test(l));
console.log('=== LOG TAIL (filtered) ===');
console.log(lines.slice(-14).join('\n'));
