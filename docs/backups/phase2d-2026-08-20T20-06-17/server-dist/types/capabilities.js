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
];
/**
 * Normalizes a capability name to canonical alias for cross-format comparison.
 */
export function normalizeCapability(cap) {
    const c = cap.trim().toLowerCase();
    const aliasMap = {
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
export class DispatchError extends Error {
    code;
    details;
    constructor(code, message, details) {
        super(`[${code}] ${message}`);
        this.code = code;
        this.details = details;
        this.name = 'DispatchError';
    }
}
