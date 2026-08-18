// Debug P10: print full stored run errors + attempt details.
import { getCodingRun } from '../server/dist/domains/codingRuntime/store.js';
const stored = getCodingRun('cr-msy9ahb6-0e3f87');
if (!stored) { console.log('NO_RUN'); process.exit(0); }
console.log('ERRORS', JSON.stringify(stored.errors, null, 2));
console.log('ATTEMPT_DETAIL', JSON.stringify(stored.providerAttempts, null, 2));
console.log('META_KEYS', Object.keys(stored.metadata || {}));
