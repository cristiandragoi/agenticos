import { db } from '../../db/index.js';
import { providerCredentials } from '../../db/schema.js';
import { eq } from 'drizzle-orm';
import { secretStore } from './secretStore.js';
import { logger } from '../../utils/logger.js';

export interface ProviderCredentialStatus {
  providerId: string;
  configured: boolean;
  maskedPreview: string | null;
  validationStatus: string | null;
  lastValidatedAt: string | null;
}

export class ProviderCredentialService {
  /**
   * Retrieves the secure API key for a given provider via Canonical SecretStore.
   */
  static async getCredential(providerId: string): Promise<string | null> {
    try {
      return await secretStore.get(providerId);
    } catch (err) {
      logger.error(`[ProviderCredentialService] Failed to read secret for ${providerId}`, err);
      return null;
    }
  }

  static async saveCredential(providerId: string, credential: string): Promise<void> {
    try {
      await secretStore.set(providerId, credential);
    } catch (err: any) {
      logger.error(`[ProviderCredentialService] Failed to save secret for ${providerId}`, err);
      const error: any = new Error('SECURE_STORAGE_UNAVAILABLE');
      error.status = 503;
      error.details = 'Secure credential storage is currently unavailable.';
      throw error;
    }

    const maskedPreview = credential.length > 8 
      ? `${credential.substring(0, 3)}...${credential.substring(credential.length - 3)}`
      : '***';

    const now = new Date().toISOString();
    
    db.insert(providerCredentials)
      .values({
        providerId,
        configured: true,
        maskedPreview,
        createdAt: now,
        updatedAt: now
      })
      .onConflictDoUpdate({
        target: providerCredentials.providerId,
        set: {
          configured: true,
          maskedPreview,
          updatedAt: now
        }
      })
      .run();
  }

  static async deleteCredential(providerId: string): Promise<void> {
    try {
      await secretStore.delete(providerId);
    } catch (err) {
      logger.warn(`[ProviderCredentialService] Failed to delete secret for ${providerId}`, { error: String(err) });
    }

    const now = new Date().toISOString();
    db.update(providerCredentials)
      .set({
        configured: false,
        maskedPreview: null,
        updatedAt: now
      })
      .where(eq(providerCredentials.providerId, providerId))
      .run();
  }

  static async getCredentialStatus(providerId: string): Promise<ProviderCredentialStatus> {
    const record = db.select().from(providerCredentials).where(eq(providerCredentials.providerId, providerId)).get();
    
    if (record) {
      return {
        providerId: record.providerId,
        configured: record.configured,
        maskedPreview: record.maskedPreview,
        validationStatus: record.validationStatus,
        lastValidatedAt: record.lastValidatedAt
      };
    }

    // Check if secret store has it even if DB row is missing (e.g. from env fallback or OS vault)
    const hasSecret = await secretStore.has(providerId);
    return {
      providerId,
      configured: hasSecret,
      maskedPreview: hasSecret ? '***' : null,
      validationStatus: null,
      lastValidatedAt: null
    };
  }
}
