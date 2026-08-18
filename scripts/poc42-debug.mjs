// Debug P42 run2 failure reason.
import { getCodingRun } from '../server/dist/domains/codingRuntime/store.js';
const run = getCodingRun('cr-msy9zbmk-38c7f1');
if (!run) { console.log('NO_RUN'); process.exit(0); }
console.log('STATUS', run.status);
console.log('ERRORS', JSON.stringify(run.errors, null, 2));
console.log('ATTEMPTS', JSON.stringify(run.providerAttempts, null, 2));
console.log('CHECKPOINTS', JSON.stringify(run.checkpoints.map((c) => c.phase)));
