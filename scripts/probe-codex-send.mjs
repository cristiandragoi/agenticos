const ports = [4000, 4001];
const payload = {
  goal: 'CODEX_RUNTIME_OK probe — inspect repo root only',
  executionProvider: 'ollama',
  validationProvider: 'omniRoute',
  workspacePath: 'B:\\AgenticOS',
  approvalPolicy: 'manual',
};
async function main() {
  for (const port of ports) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/chat/agents/goal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const txt = await res.text();
      console.log(`port ${port}: status=${res.status} body=${txt.slice(0, 300)}`);
    } catch (e) {
      console.log(`port ${port}: ERROR ${e.message}`);
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
