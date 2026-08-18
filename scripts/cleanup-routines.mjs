// Disable ALL enabled routines (cleanup noisy per-minute test routines) so the
// hermes worker slot is free for Test J.
const API = 'http://127.0.0.1:4000/api';
const r = await fetch(API + '/routines');
const routines = await r.json();
let disabled = 0;
for (const rt of routines) {
  if (rt.enabled) {
    await fetch(API + `/routines/${rt.routineId}/disable`, { method: 'POST' });
    disabled++;
    console.log('disabled ' + rt.routineId + ' (' + rt.worker + ')');
  }
}
console.log('DISABLED_COUNT=' + disabled);
