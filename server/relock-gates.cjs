// Phase 2C relock: restore safety hold after the user-confirmed UI test that
// resolved 5 Human Gates. Preserves the resolved gates + their audit history;
// creates REPLACEMENT open gates; reverts the supervisor's IN_PROGRESS
// side-effect back to the canonical pre-resolution status; records an immutable
// `test_resolution_relocked` event.
process.env.AGENTICOS_DATA_DIR = 'C:/Users/Cris/AppData/Roaming/agenticos/data';

const crypto = require('crypto');
const uid = (p) => `${p}-${crypto.randomUUID().slice(0, 9)}`;

// original resolved gate -> experiment -> (gateType, pre-resolution status)
const MAPPING = [
  { resolvedGateId: 'gate-360f2dae-', experimentId: 'expt-a2598507-', gateType: 'SHOPIFY_AUTH_REQUIRED', restoreStatus: 'READY_TO_PUBLISH', engine: 'digital_products' },
  { resolvedGateId: 'gate-62a69b77-', experimentId: 'expt-70839c88-', gateType: 'SHOPIFY_AUTH_REQUIRED', restoreStatus: 'READY_TO_PUBLISH', engine: 'digital_products' },
  { resolvedGateId: 'gate-f976909e-', experimentId: 'expt-fe395ce1-', gateType: 'OUTBOUND_APPROVAL', restoreStatus: 'QA', engine: 'german_sme' },
  { resolvedGateId: 'gate-7823fde0-', experimentId: 'expt-15990784-', gateType: 'OUTBOUND_APPROVAL', restoreStatus: 'QA', engine: 'german_sme' },
  { resolvedGateId: 'gate-d6863fd6-', experimentId: 'expt-196b4b22-', gateType: 'OUTBOUND_APPROVAL', restoreStatus: 'QA', engine: 'german_sme' },
];

(async () => {
  const { createHumanGate } = await import('../server/dist/services/revenueOperator/operatorService.js');
  const { rawDb } = await import('../server/dist/db/index.js');

  const now = new Date().toISOString();
  const results = [];

  for (const m of MAPPING) {
    // 1. Verify the resolved gate is preserved (do NOT modify it)
    const resolved = rawDb.prepare('SELECT id, status, resolved_by, resolved_at FROM revenue_human_gates WHERE id = ?').get(m.resolvedGateId);
    if (!resolved || resolved.status !== 'resolved') {
      throw new Error(`Expected resolved gate ${m.resolvedGateId} not found/resolved. Aborting before any write.`);
    }

    // 2. Guard: only create a replacement if no OPEN gate already exists for this experiment
    const existingOpen = rawDb.prepare("SELECT id FROM revenue_human_gates WHERE experiment_id = ? AND status = 'open'").get(m.experimentId);
    if (existingOpen) {
      results.push({ ...m, replacementGateId: existingOpen.id, alreadyOpen: true });
      continue;
    }

    // 3. Create the replacement OPEN gate (canonical service)
    const gate = createHumanGate({
      experimentId: m.experimentId,
      gateType: m.gateType,
      description: `Replacement safety gate after test_resolution_relocked (actor: user-confirmed-ui-test). Re-locks branch pending human approval.`,
      branchPaused: true,
    });

    // 4. Revert the supervisor's IN_PROGRESS side-effect to the pre-resolution status.
    //    transitionExperiment cannot express this (IN_PROGRESS is not a canonical
    //    lifecycle status), so this is a direct, documented restoration write.
    rawDb.prepare('UPDATE revenue_experiments SET status = ?, updated_at = ? WHERE id = ?')
      .run(m.restoreStatus, now, m.experimentId);

    // 5. Record the immutable relock event
    rawDb.prepare(`
      INSERT INTO revenue_experiment_events (id, experiment_id, event_type, previous_status, next_status, actor_type, actor_id, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      uid('reve'), m.experimentId, 'test_resolution_relocked', 'IN_PROGRESS', m.restoreStatus,
      'human', 'user-confirmed-ui-test',
      JSON.stringify({ originalGateId: m.resolvedGateId, replacementGateId: gate.id, reason: 'UI-test resolution re-locked; no external action authorized' }),
      now
    );

    results.push({ ...m, replacementGateId: gate.id, alreadyOpen: false, restoredFrom: 'IN_PROGRESS', restoredTo: m.restoreStatus });
  }

  console.log('=== RELOCK RESULTS ===');
  for (const r of results) console.log(JSON.stringify(r));

  // Verify
  const openCount = rawDb.prepare("SELECT COUNT(*) c FROM revenue_human_gates WHERE status = 'open'").get().c;
  const resolvedCount = rawDb.prepare("SELECT COUNT(*) c FROM revenue_human_gates WHERE status = 'resolved'").get().c;
  const inProgressCount = rawDb.prepare("SELECT COUNT(*) c FROM revenue_experiments WHERE status = 'IN_PROGRESS'").get().c;
  const relockEvents = rawDb.prepare("SELECT COUNT(*) c FROM revenue_experiment_events WHERE event_type = 'test_resolution_relocked'").get().c;
  console.log(`\n=== VERIFY ===`);
  console.log(`open gates: ${openCount} (expect 5)`);
  console.log(`resolved gates: ${resolvedCount} (expect 5, preserved)`);
  console.log(`IN_PROGRESS experiments: ${inProgressCount} (expect 0)`);
  console.log(`test_resolution_relocked events: ${relockEvents} (expect 5)`);
})().catch((e) => { console.error('RELOCK ERROR:', e.message); process.exit(1); });
