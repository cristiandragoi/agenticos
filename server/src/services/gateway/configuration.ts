import { db } from '../../db/index.js';
import { gatewayConfiguration } from '../../db/schema.js';
import { eq } from 'drizzle-orm';

export interface GatewayConfiguration {
  maxProviderRetries: number;
  maxFallbackProviders: number;
  providerTimeoutMs: number;
  degradedLatencyMs: number;
  circuitFailureThreshold: number;
  circuitResetTimeoutMs: number;
  healthCheckIntervalMs: number;
  updatedAt: string;
  version: number;
}

export class GatewayConfigurationService {
  /**
   * Retrieves the singleton gateway configuration.
   * If it doesn't exist, initializes it with defaults.
   */
  static async getConfiguration(): Promise<GatewayConfiguration> {
    let config = db.select().from(gatewayConfiguration).where(eq(gatewayConfiguration.id, 1)).get();
    
    if (!config) {
      const now = new Date().toISOString();
      db.insert(gatewayConfiguration).values({
        id: 1,
        maxProviderRetries: 3,
        maxFallbackProviders: 3,
        providerTimeoutMs: 30000,
        degradedLatencyMs: 2000,
        circuitFailureThreshold: 5,
        circuitResetTimeoutMs: 60000,
        healthCheckIntervalMs: 300000,
        updatedAt: now,
        version: 1
      }).run();
      
      config = db.select().from(gatewayConfiguration).where(eq(gatewayConfiguration.id, 1)).get()!;
    }
    
    return {
      maxProviderRetries: config.maxProviderRetries,
      maxFallbackProviders: config.maxFallbackProviders,
      providerTimeoutMs: config.providerTimeoutMs,
      degradedLatencyMs: config.degradedLatencyMs,
      circuitFailureThreshold: config.circuitFailureThreshold,
      circuitResetTimeoutMs: config.circuitResetTimeoutMs,
      healthCheckIntervalMs: config.healthCheckIntervalMs,
      updatedAt: config.updatedAt,
      version: config.version
    };
  }

  static async updateConfiguration(updates: Partial<GatewayConfiguration>): Promise<GatewayConfiguration> {
    const config = await this.getConfiguration();
    const now = new Date().toISOString();
    
    db.update(gatewayConfiguration)
      .set({
        maxProviderRetries: updates.maxProviderRetries ?? config.maxProviderRetries,
        maxFallbackProviders: updates.maxFallbackProviders ?? config.maxFallbackProviders,
        providerTimeoutMs: updates.providerTimeoutMs ?? config.providerTimeoutMs,
        degradedLatencyMs: updates.degradedLatencyMs ?? config.degradedLatencyMs,
        circuitFailureThreshold: updates.circuitFailureThreshold ?? config.circuitFailureThreshold,
        circuitResetTimeoutMs: updates.circuitResetTimeoutMs ?? config.circuitResetTimeoutMs,
        healthCheckIntervalMs: updates.healthCheckIntervalMs ?? config.healthCheckIntervalMs,
        version: config.version + 1,
        updatedAt: now
      })
      .where(eq(gatewayConfiguration.id, 1))
      .run();
      
    return this.getConfiguration();
  }
}
