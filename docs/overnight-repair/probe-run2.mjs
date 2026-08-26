const BASE = process.env.BASE || 'http://127.0.0.1:4002';
const id = process.argv[2];
const res = await fetch(`${BASE}/api/hermes-api/runs/${id}`);
const d = await res.json();
console.log('status:', d.status);
console.log('provider:', JSON.stringify(d.provider), '| model:', JSON.stringify(d.model));
const evs = d.events || [];
console.log('eventCount:', evs.length);
// Dedupe tool events by tool name to see what the agent actually called.
const toolNames = new Set();
for (const e of evs) {
  if (e.kind === 'tool.started' || e.kind === 'tool.completed' || e.kind === 'terminal.command' || e.kind === 'file.changed' || e.kind === 'tool.failed') {
    toolNames.add((e.detail && e.detail.tool) || '?');
  }
}
console.log('toolNames:', [...toolNames].join(', '));
console.log('finalText tail:', (d.finalText || '').slice(-400));
