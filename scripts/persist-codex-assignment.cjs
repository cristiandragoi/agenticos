// Persist the agent-codex assignment via the existing routing API on both backends.
const { execSync } = require('child_process');

const payload = JSON.stringify({
  providerId: 'prov-deepseek',
  modelId: 'deepseek-v4-flash',
  routingMode: 'preferred',
  enabled: true,
});

for (const port of [4000, 4001]) {
  try {
    const out = execSync(
      `curl -s -m 10 -X PUT "http://127.0.0.1:${port}/api/settings/agent-provider-assignments/agent-codex" -H 'Content-Type: application/json' -d '${payload}'`,
      { encoding: 'utf8', shell: 'bash' }
    );
    console.log(`PUT ${port}:`, out.slice(0, 300));
  } catch (e) {
    console.log(`PUT ${port} FAILED:`, e.message);
  }
}
