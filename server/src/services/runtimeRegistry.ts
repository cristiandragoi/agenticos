import { logger } from '../utils/logger.js';
import type { RuntimeAdapter } from '../types.js';

class RuntimeRegistry {
  private adapters: Map<string, RuntimeAdapter> = new Map();

  register(adapter: RuntimeAdapter): void {
    this.adapters.set(adapter.id, adapter);
    logger.info(`[Registry] Registered runtime adapter: ${adapter.id}`);
  }

  getAdapter(runtimeId: string): RuntimeAdapter | undefined {
    return this.adapters.get(runtimeId);
  }

  listRuntimes(): { id: string; label: string }[] {
    return Array.from(this.adapters.values()).map(a => ({ id: a.id, label: a.label }));
  }
}

export const runtimeRegistry = new RuntimeRegistry();
