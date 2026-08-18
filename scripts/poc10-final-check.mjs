// Re-check the P10-final run after more time.
import { listCodingRuns } from '../server/dist/domains/codingRuntime/store.js';
const runs = listCodingRuns();
const r = runs[0];
console.log('RUNS', runs.length);
if (r) {
  console.log('ID', r.runId, 'STATUS', r.status);
  console.log('CHANGED', JSON.stringify(r.changedFiles));
  console.log('TEST', JSON.stringify(r.testResults));
  console.log('VERIFIER', r.verifierVerdict);
  console.log('ATTEMPTS', JSON.stringify(r.providerAttempts.map((a) => ({ provider: a.provider, outcome: a.outcome, failureClass: a.failureClass }))));
  console.log('ERRORS', JSON.stringify(r.errors));
}
