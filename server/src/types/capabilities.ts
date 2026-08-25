/**
 * Canonical Runtime Capability Vocabulary & Types
 * Constrained capability set for capability-aware routing.
 */

export const RuntimeCapabilities = [
  'filesystem.read',
  'filesystem.write',
  'process.execute',
  'network.localhost',
  'network.external',
  'database.sqlite.read',
  'database.sqlite.write',
  'tool.node',
  'tool.npm',
  'workflow.build',
  'workflow.test',
  'browser.inspect',
  'browser.interact',
  'electron.runtime',
  // Repository execution capabilities (Phase 2D real-workspace bridge)
  'terminal',
  'git',
  'repository_workspace',
  // Underscore aliases for legacy/broad compatibility
  'filesystem_read',
  'filesystem_write',
  'process_exec',
  'localhost_http',
  'sqlite_read',
  'sqlite_write',
  'node',
  'npm',
  'build',
  'test',
  'browser',
  'external_web',
  'electron_runtime',
] as const;

export type RuntimeCapability = (typeof RuntimeCapabilities)[number];

/**
 * Normalizes a capability name to canonical alias for cross-format comparison.
 */
export function normalizeCapability(cap: string): string {
  const c = cap.trim().toLowerCase();
  const aliasMap: Record<string, string> = {
    'filesystem.read': 'filesystem_read',
    'filesystem.write': 'filesystem_write',
    'process.execute': 'process_exec',
    'process.exec': 'process_exec',
    'network.localhost': 'localhost_http',
    'network.external': 'external_web',
    'database.sqlite.read': 'sqlite_read',
    'database.sqlite.write': 'sqlite_write',
    'tool.node': 'node',
    'tool.npm': 'npm',
    'workflow.build': 'build',
    'workflow.test': 'test',
    'browser.inspect': 'browser',
    'browser.interact': 'browser',
    'electron.runtime': 'electron_runtime',
  };
  return aliasMap[c] || c;
}

/**
 * Standard capability error taxonomy
 */
export type DispatchErrorCode =
  | 'NO_CAPABLE_RUNTIME'
  | 'CAPABILITY_MISMATCH'
  | 'RUNTIME_UNAVAILABLE'
  | 'PROVIDER_FAILURE'
  | 'POLICY_DENIED'
  | 'APPROVAL_REQUIRED'
  | 'TRANSIENT_EXECUTION_FAILURE'
  | 'PERMANENT_EXECUTION_FAILURE'
  | 'TIMEOUT';

export class DispatchError extends Error {
  constructor(
    public readonly code: DispatchErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(`[${code}] ${message}`);
    this.name = 'DispatchError';
  }
}
