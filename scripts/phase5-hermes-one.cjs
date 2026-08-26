#!/usr/bin/env node
/**
 * Phase 5 — Hermes One planning/delegation verification (bounded, real).
 * Exercises the canonical production path: POST /api/hermes-api/runs → poll.
 * Does NOT activate the Revenue Supervisor. Does NOT mutate the repo.
 */
const BASE = process.env.PHASE5_BASE || 'http://127.0.0.1:4001';

const PROMPT = [
  'PHASE5_PLAN_BEGIN_MARKER',
  'Plan a harmless repository inspection of B:/AgenticOS.',
  'Decompose it into concrete steps: (1) inspect the diagnostics status component,',
  '(2) inspect the CodeX tool runtime, (3) identify a small safe test improvement.',
  'Do not modify any files. Report the plan and the steps as a list.',
  'PHASE5_PLAN_END_MARKER',
].join('\n');

async function main() {
  const created = await fetch(`${BASE}/api/hermes-api/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: PROMPT }),
  });
  const rec = await created.json();
  if (!created.ok) {
    console.error('CREATE FAILED', JSON.stringify(rec));
    process.exit(2);
  }
  const id = rec.id;
  console.log(`RUN_CREATED id=${id} hermesRunId=${rec.hermesRunId} status=${rec.status}`);

  const deadline = Date.now() + 120000;
  let final = null;
  while (Date.now() < deadline) {
    const res = await fetch(`${BASE}/api/hermes-api/runs/${id}`);
    final = await res.json();
    if (['completed', 'failed', 'cancelled'].includes(final.status)) break;
    await new Promise((r) => setTimeout(r, 2500));
  }

  console.log(`FINAL_STATUS=${final?.status}`);
  console.log(`PROVIDER=${final?.provider || '(empty)'}`);
  console.log(`MODEL=${final?.model || '(empty)'}`);
  console.log(`PROMPT_PRESERVED_BEGIN=${final?.prompt?.includes('PHASE5_PLAN_BEGIN_MARKER')}`);
  console.log(`PROMPT_PRESERVED_END=${final?.prompt?.includes('PHASE5_PLAN_END_MARKER')}`);
  const events = final?.events || [];
  const toolEvents = events.filter((e) => e.kind.startsWith('tool') || e.kind === 'terminal.command' || e.kind === 'file.changed');
  console.log(`EVENT_COUNT=${events.length} TOOL_EVENTS=${toolEvents.length}`);
  console.log('--- FINAL TEXT (first 1200 chars) ---');
  console.log((final?.finalText || final?.errorMessage || '(no text)').slice(0, 1200));
}

main().catch((e) => { console.error('ERROR', e); process.exit(2); });
