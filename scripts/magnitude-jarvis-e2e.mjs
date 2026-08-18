// Verify the Jarvis→Magnitude orchestrator path ran a REAL browser inspection
// and persisted a canonical execution result (A7 end-to-end).
const BASE = 'http://127.0.0.1:4000';

// The M9 probe already sent the stream request; check the latest conversation
// for the Magnitude result message.
const convRes = await fetch(`${BASE}/api/jarvis/conversations`);
const convs = await convRes.json();
const list = Array.isArray(convs) ? convs : [];
const sorted = [...list].sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
const latest = sorted[0];
console.log('LATEST_CONV', latest?.id, latest?.updatedAt);

const msgsRes = await fetch(`${BASE}/api/jarvis/conversations/${latest.id}/messages`);
const msgs = await msgsRes.json();
const rows = Array.isArray(msgs) ? msgs : [];
const magMsgs = rows.filter((m) => m?.metadata?.magnitudeRunId || /Magnitude Browser Inspection Result/i.test(String(m?.content || '')));
console.log('MAG_MSGS', magMsgs.length);
for (const m of magMsgs.slice(-2)) {
  console.log('CONTENT', String(m.content || '').slice(0, 400).replace(/\n/g, ' | '));
  console.log('META', JSON.stringify({ projectId: m.metadata?.projectId, goalId: m.metadata?.goalId, taskId: m.metadata?.taskId, runId: m.metadata?.runId, resultId: m.metadata?.resultId, verdict: m.metadata?.verdict, magnitudeRunId: m.metadata?.magnitudeRunId }));
}
