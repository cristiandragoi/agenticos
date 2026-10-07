/** Generic process execution is disabled. No userspace cleanup is an OS sandbox. */
export class ProcessConfinementError extends Error {
  readonly code = 'PROCESS_CONFINEMENT_VIOLATION';
  constructor(message: string) { super(`PROCESS_CONFINEMENT_VIOLATION: ${message}`); }
}
export interface ConfinedProcessOptions {
  executable: string; args?: string[]; cwd?: string; timeoutMs?: number;
  maxOutputBytes?: number; env?: Record<string,string>; signal?: AbortSignal;
}
export async function executeConfinedProcess(_options: ConfinedProcessOptions): Promise<never> {
  throw new ProcessConfinementError('GENERIC_PROCESS_EXECUTION_DISABLED');
}
