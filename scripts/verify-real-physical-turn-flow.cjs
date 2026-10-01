/**
 * scripts/verify-real-physical-turn-flow.cjs
 *
 * NOTE: As established in ACCEPTANCE_HARNESS_AUDIT.md, this harness was audited and determined
 * to be Category D (Direct Transcript / SSE Stream Injection), NOT physical microphone audio.
 *
 * It has been renamed to `verify-semantic-stream-turn-flow.cjs`.
 * For real physical microphone verification, use `verify-physical-microphone-live.cjs`.
 */
'use strict';

console.log('NOTICE: verify-real-physical-turn-flow.cjs has been audited (Category D: Direct SSE Stream).');
console.log('Running the truthful semantic suite: verify-semantic-stream-turn-flow.cjs\n');

require('./verify-semantic-stream-turn-flow.cjs');
