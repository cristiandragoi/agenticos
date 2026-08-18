// Run vitest programmatically so the worker's real stderr is visible.
import { startVitest } from 'vitest/node';
const v = await startVitest('test', ['src/__tests__/_probe-copy.test.tsx'], {
  run: true,
  reporters: ['verbose'],
  watch: false,
});
const files = v?.state?.getFiles?.() || [];
for (const f of files) {
  console.log('FILE', f.filepath, f.result?.state, 'errors:', (f.result?.errors || []).map((e) => String(e.message).slice(0, 300)));
}
await v?.close();
console.log('DONE');
