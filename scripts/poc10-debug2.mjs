// Debug P10b: print the stored run error.
import { getCodingRun } from '../server/dist/domains/codingRuntime/store.js';
const stored = getCodingRun('cr-msy9c7et-9c6ef3');
if (!stored) { console.log('NO_RUN'); process.exit(0); }
console.log('ERRORS', JSON.stringify(stored.errors, null, 2));
