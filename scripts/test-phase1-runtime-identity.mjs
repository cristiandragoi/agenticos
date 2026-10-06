// Compatibility entrypoint. The 87 canonical assertions now live in the Vitest suite.
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
execFileSync(process.execPath,['node_modules/vitest/vitest.mjs','run','--config','vitest.server.config.ts','server/src/__tests__/phase1RuntimeIdentity.test.ts'],{cwd:root,stdio:'inherit'});