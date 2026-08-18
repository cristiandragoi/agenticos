// Inspect the SECOND pinned goal run (post-fix) — did the pin reach the LLM call?
import { goalStore } from '../dist/services/goalStore.js';
const goalId = process.argv[2] || 'goal-0537cdb9-';
const g = goalStore.get(goalId);
if (!g) { console.log('goal not found'); process.exit(0); }
const last = (g.history || []).slice(-1)[0];
console.log('status:', g.status);
console.log('last event:', JSON.stringify(last || null).slice(0, 320));
