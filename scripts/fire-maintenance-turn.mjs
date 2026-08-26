// fire-maintenance-turn.mjs — send ONE maintenance prompt through the canonical
// /api/jarvis/conversations/:id/message route and wait for the synchronous
// result (the endpoint blocks until handleMaintenanceTurn → diagnoseAndRepair
// completes). Explicit deadline; no retries.
const CONV = 'conv-fcf6c9a8-';
const BASE = 'http://127.0.0.1:4000';
const OPID = 'op-phase4-real-accept';

const prompt = [
  'check why the controlled maintenance fixture test is failing —',
  'the test at server/src/__tests__/maintfixture.test.ts is failing against',
  'server/src/services/maintfixture/calc.ts.',
  'If it is safe to repair, have Hermes diagnose it and CodeX prepare the repair,',
  'run the tests and verification, and stop before committing anything.'
].join(' ');

const body = JSON.stringify({ prompt, operationId: OPID, repositoryPath: 'B:\\AgenticOS' });
const controller = new AbortController();
const deadline = setTimeout(() => controller.abort(), 9 * 60 * 1000); // 9 min hard cap

try {
  const res = await fetch(`${BASE}/api/jarvis/conversations/${CONV}/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    signal: controller.signal,
  });
  const text = await res.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  console.log('HTTP', res.status);
  console.log('RESULT', JSON.stringify(parsed, null, 2));
} catch (e) {
  console.error('FATAL', e?.name, e?.message);
  process.exit(2);
} finally {
  clearTimeout(deadline);
}
