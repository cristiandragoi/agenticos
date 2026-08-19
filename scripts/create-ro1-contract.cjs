#!/usr/bin/env node
/**
 * M0 — Create the immutable Revenue Operator Phase 1 ARGUS Task Contract.
 * 1. Create a goal whose ORIGINAL prompt IS the full contract spec (the ARGUS
 *    contract snapshots goal.originalGoal → originalSpec, sha256 → immutable).
 *    approvalPolicy 'manual' → goal stays waiting_for_approval (NO execution).
 * 2. POST /api/argus/contracts with the master acceptance criteria (C1–C10):
 *    the canonical verifier command check at L4 + contract-doc file check.
 * 3. Print contract id, specHash, verificationState.
 */
const BASE = process.env.RO_BACKEND || 'http://127.0.0.1:4001';
const fs = require('fs');
const path = require('path');

const SPEC_PATH = path.resolve(__dirname, '../docs/argus-contracts/revenue-operator-phase1.md');
const spec = fs.readFileSync(SPEC_PATH, 'utf-8');

const criteria = [
  { type: 'file-exists', path: 'docs/argus-contracts/revenue-operator-phase1.md' },
  { type: 'command', command: 'node', args: ['scripts/revenue-operator-verify.cjs'], timeoutMs: 420000, expectExit: 0, evidenceLevel: 'L4' },
];

(async () => {
  // 1. Create the contract-bearing goal (manual → no execution loop).
  const created = await fetch(`${BASE}/api/chat/agents/goal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      goal: spec,
      workspacePath: 'B:\\AgenticOS',
      repositoryRoot: 'B:\\AgenticOS',
      approvalPolicy: 'manual',
      title: 'Revenue Operator Phase 1 — ARGUS Task Contract (master)',
    }),
  });
  const createdBody = await created.json();
  if (!created.ok || !createdBody.goalId) {
    console.log('GOAL CREATE FAILED', created.status, JSON.stringify(createdBody).slice(0, 500));
    process.exit(1);
  }
  const goalId = createdBody.goalId;
  console.log(`Contract goal ${goalId} created (status=${createdBody.status || 'waiting_for_approval'}, no execution)`);

  // 2. Create the ARGUS contract with master acceptance criteria.
  const contractRes = await fetch(`${BASE}/api/argus/contracts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      goalId,
      acceptanceCriteria: criteria,
      title: 'Revenue Operator Phase 1 — ARGUS Task Contract (master)',
    }),
  });
  const contractBody = await contractRes.json();
  if (!contractRes.ok || !contractBody.contract) {
    console.log('CONTRACT CREATE FAILED', contractRes.status, JSON.stringify(contractBody).slice(0, 500));
    process.exit(1);
  }
  const c = contractBody.contract;
  console.log(`CONTRACT ${c.id} created`);
  console.log(`  goalId: ${c.goalId}`);
  console.log(`  specHash: ${c.specHash}`);
  console.log(`  status: ${c.status}`);
  console.log(`  criteria: ${c.acceptanceCriteria.length} checks (file-exists + command L4)`);
  console.log(`  originalSpec chars: ${c.originalSpec.length}`);
  console.log(`  workspacePath: ${c.workspacePath}`);

  // 3. Confirm the goal's verificationState is implementation_ready (ARGUS-owned).
  const g = await (await fetch(`${BASE}/api/chat/agents/goal/${goalId}`)).json();
  console.log(`GOAL state: status=${g.status} verificationState=${g.verificationState || 'n/a'} contractId=${g.contractId || 'n/a'}`);
  console.log('TASK CONTRACT PERSISTED — immutable (sha256), Codex cannot rewrite criteria.');
})().catch((e) => { console.error('SCRIPT ERROR', e); process.exit(1); });
