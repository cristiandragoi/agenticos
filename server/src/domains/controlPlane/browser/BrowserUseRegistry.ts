/**
 * BrowserUseRegistry.ts — Browser Intelligence Provider Registry
 *
 * PHASE 7 ARCHITECTURAL COMPONENT
 *
 * Manages registered IBrowserComputerUseProvider implementations behind an abstract boundary.
 * Prevents BrowserCode or CDP details from leaking directly across AgenticOS.
 */

import { logger } from '../../../utils/logger.js';
import type { IBrowserComputerUseProvider } from './IBrowserComputerUseProvider.js';
import { browserCodeProvider } from './BrowserCodeProvider.js';

export class BrowserUseRegistry {
  private static instance: BrowserUseRegistry;
  private readonly providers: Map<string, IBrowserComputerUseProvider> = new Map();
  private activeProviderId = 'browsercode-cdp';

  private constructor() {
    this.registerProvider(browserCodeProvider);
  }

  public static getInstance(): BrowserUseRegistry {
    if (!BrowserUseRegistry.instance) {
      BrowserUseRegistry.instance = new BrowserUseRegistry();
    }
    return BrowserUseRegistry.instance;
  }

  public registerProvider(provider: IBrowserComputerUseProvider): void {
    this.providers.set(provider.id, provider);
    logger.info(`[BrowserUseRegistry] Registered browser provider: ${provider.name} (${provider.id} v${provider.version})`);
  }

  public getProvider(id: string): IBrowserComputerUseProvider | undefined {
    return this.providers.get(id);
  }

  public getActiveProvider(): IBrowserComputerUseProvider {
    const provider = this.providers.get(this.activeProviderId);
    if (!provider) {
      return browserCodeProvider;
    }
    return provider;
  }

  public setActiveProvider(id: string): boolean {
    if (this.providers.has(id)) {
      this.activeProviderId = id;
      logger.info(`[BrowserUseRegistry] Set active browser provider to: ${id}`);
      return true;
    }
    logger.warn(`[BrowserUseRegistry] Cannot set active browser provider, unknown id: ${id}`);
    return false;
  }
}

export const browserUseRegistry = BrowserUseRegistry.getInstance();
