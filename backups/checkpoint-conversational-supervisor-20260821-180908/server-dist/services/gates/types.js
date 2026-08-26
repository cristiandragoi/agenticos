/**
 * GateRunner v1 — gate contract (RunLedger + GateRunner milestone).
 *
 * A gate is executable and produces evidence. It is NOT a checklist string.
 * Gates run under policy: configured/approved commands, workspace-root cwd,
 * per-gate timeout, cancellation, no secret dumps.
 */
export const GATE_TIMEOUT_MS = 120_000;
/** Default policy allowlist — command gates may only run these shapes. */
export const DEFAULT_ALLOWED_COMMANDS = [
    'npm test',
    'npm run test',
    'npm run build',
    'npm run typecheck',
    'npx tsc',
    'npx vitest',
    'node --test',
    'npm run lint',
];
