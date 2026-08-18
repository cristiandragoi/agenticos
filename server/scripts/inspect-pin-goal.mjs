// Inspect why the pinned goal failed during real execution (external blocker evidence).
import { goalStore } from '../dist/services/goalStore.js';
const g = goalStore.get('goal-fb5b9f86-');
if (!g) { console.log('goal not found'); process.exit(0); }
console.log('status:', g.status);
console.log('runSummary:', JSON.stringify(g.runSummary || null));
console.log('history events:', (g.history || []).slice(0, 3).map((h) => h.type || h.eventType || '?'));
const last = (g.history || []).slice(-1)[0];
console.log('last history entry:', JSON.stringify(last || null).slice(0, 300));
