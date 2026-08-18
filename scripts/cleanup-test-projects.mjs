// Cleanup leaked acceptance-test projects (legacy entry point).
// Canonical logic lives in cleanup-acceptance-artifacts.mjs (port 4000,
// id-prefix + name-pattern + tag heuristics mirroring src/lib/universeProjects.ts).
// This wrapper exists so old invocations keep working.
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

const here = path.dirname(fileURLToPath(import.meta.url));
try {
  execFileSync(process.execPath, [path.join(here, 'cleanup-acceptance-artifacts.mjs')], { stdio: 'inherit' });
} catch (e) {
  console.error('CLEANUP FAILED:', e.message);
  process.exit(1);
}
