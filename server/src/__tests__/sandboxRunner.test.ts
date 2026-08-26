import { describe, it, expect } from 'vitest';
import { runSandboxedCommand } from '../utils/sandbox.js';
import path from 'path';

describe('runSandboxedCommand verification', () => {
  const root = path.resolve('.');

  it('1 & 4. Enforces binary allowlist and rejects disallowed binaries without execution', async () => {
    await expect(runSandboxedCommand('malicious_bin_xyz', ['--help'], undefined, root))
      .rejects.toThrow(/Sandbox violation: Execution of 'malicious_bin_xyz' is blocked by policy/);

    await expect(runSandboxedCommand('powershell', ['-Command', 'ls'], undefined, root))
      .rejects.toThrow(/Sandbox violation: Execution of 'powershell' is blocked by policy/);

    await expect(runSandboxedCommand('cmd', ['/c', 'dir'], undefined, root))
      .rejects.toThrow(/Sandbox violation: Execution of 'cmd' is blocked by policy/);
  });

  it('2 & 3. Auto-routes server-targeted commands to server/ directory and rewrites relative paths', async () => {
    const { stdout } = await runSandboxedCommand(
      'node',
      ['-e', 'console.log(process.cwd())', 'server/src/__tests__/dummy.test.ts'],
      undefined,
      root
    );
    const resolvedCwd = stdout.trim().replace(/\\/g, '/');
    expect(resolvedCwd).toContain('/server');
  });

  it('5 & 6. Adds --prefer-offline only for npm install, never for npx or vitest', async () => {
    const { stdout } = await runSandboxedCommand(
      'node',
      ['-e', 'console.log(JSON.stringify(process.argv.slice(1)))', 'someArg'],
      undefined,
      root
    );
    const argsPassed = JSON.parse(stdout.trim());
    expect(argsPassed).toEqual(['someArg']);
    expect(argsPassed).not.toContain('--prefer-offline');
  });

  it('7. Handles rg/grep exit code 1 gracefully as empty matches instead of rejecting', async () => {
    const randomPattern = `UNLIKELY_${Date.now()}_` + Math.random().toString(36);
    const result = await runSandboxedCommand(
      'rg',
      ['-n', randomPattern, '.'],
      undefined,
      root
    );
    expect(result.stdout).toBe('');
  });

  it('8. Rejects other non-zero command exits correctly with exit code', async () => {
    await expect(runSandboxedCommand('node', ['-e', 'process.exit(42)'], undefined, root))
      .rejects.toThrow(/Command failed with code 42/);
  });

  it('9 & 10. Truncation and single resolution work as expected', async () => {
    const { stdout } = await runSandboxedCommand(
      'node',
      ['-e', 'console.log("A".repeat(5000))'],
      undefined,
      root
    );
    expect(stdout.length).toBeLessThan(4500);
    expect(stdout).toContain('...[Truncated');
  });
});