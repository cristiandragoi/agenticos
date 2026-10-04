/**
 * ComputerUseRegistry.ts — Computer Use Engine Registry
 *
 * PHASE 6B ARCHITECTURAL COMPONENT
 *
 * Manages registered IComputerUseProvider implementations behind an abstract boundary.
 * Prevents Agent-S or any specific GUI engine from leaking directly across AgenticOS.
 */

import { logger } from '../../../utils/logger.js';
import type { IComputerUseProvider } from './IComputerUseProvider.js';
import { agentSComputerUseProvider } from './AgentSComputerUseProvider.js';

export class ComputerUseRegistry {
  private static instance: ComputerUseRegistry;
  private readonly providers: Map<string, IComputerUseProvider> = new Map();
  private activeProviderId = 'agent-s3';

  private constructor() {
    // Pre-register default Agent-S3 provider
    this.registerProvider(agentSComputerUseProvider);
  }

  public static getInstance(): ComputerUseRegistry {
    if (!ComputerUseRegistry.instance) {
      ComputerUseRegistry.instance = new ComputerUseRegistry();
    }
    return ComputerUseRegistry.instance;
  }

  public registerProvider(provider: IComputerUseProvider): void {
    this.providers.set(provider.id, provider);
    logger.info(`[ComputerUseRegistry] Registered computer-use provider: ${provider.name} (${provider.id} v${provider.version})`);
  }

  public getProvider(id: string): IComputerUseProvider | undefined {
    return this.providers.get(id);
  }

  public getActiveProvider(): IComputerUseProvider | undefined {
    return this.providers.get(this.activeProviderId);
  }

  public setActiveProvider(id: string): boolean {
    if (this.providers.has(id)) {
      this.activeProviderId = id;
      logger.info(`[ComputerUseRegistry] Set active computer-use provider to: ${id}`);
      return true;
    }
    logger.warn(`[ComputerUseRegistry] Cannot set active provider, unknown id: ${id}`);
    return false;
  }

  public listProviders(): readonly { id: string; name: string; version: string }[] {
    return Array.from(this.providers.values()).map(p => ({
      id: p.id,
      name: p.name,
      version: p.version,
    }));
  }
}

export const computerUseRegistry = ComputerUseRegistry.getInstance();
