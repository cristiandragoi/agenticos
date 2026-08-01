import { db } from '../../db/index.js';
import { providerCredentials } from '../../db/schema.js';
import { eq } from 'drizzle-orm';
import * as keytar from 'keytar';
import { logger } from '../../utils/logger.js';

export interface ProviderCredentialStatus {
  providerId: string;
  configured: boolean;
  maskedPreview: string | null;
  validationStatus: string | null;
  lastValidatedAt: string | null;
}

const SERVICE_NAME = 'AgenticOS.ProviderCredentials';

export class ProviderCredentialService {
  /**
   * Retrieves the secure API key for a given provider.
   * Checks keytar first, then falls back to environment variables.
   */
  static async getCredential(providerId: string): Promise<string | null> {
    try {
      const stored = await keytar.getPassword(SERVICE_NAME, `provider:${providerId}`);
      if (stored) return stored;
    } catch (err) {
      logger.error(`[ProviderCredentialService] Failed to read from keytar for ${providerId}`, err);
    }

    // Fallbacks to environment variables based on standard provider IDs
    if (providerId === 'omniroot' || providerId === 'openrouter') return process.env.OPENROUTER_API_KEY || null;
    if (providerId === 'openai') return process.env.OPENAI_API_KEY || null;
    if (providerId === 'ninerouter' || providerId === 'anthropic') return process.env.ANTHROPIC_API_KEY || null;
    if (providerId === 'groq') return process.env.GROQ_API_KEY || null;
    if (providerId === 'google') return process.env.GOOGLE_API_KEY || null;
    
    return null;
  }

  static async saveCredential(providerId: string, credential: string): Promise<void> {
    try {
      await keytar.setPassword(SERVICE_NAME, `provider:${providerId}`, credential);
    } catch (err) {
      logger.error(`[ProviderCredentialService] Failed to set password in keytar for ${providerId}`, err);
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
      await keytar.deletePassword(SERVICE_NAME, `provider:${providerId}`);
    } catch (err) {
      logger.warn(`[ProviderCredentialService] Failed to delete password in keytar for ${providerId}`, { error: String(err) });
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

    return {
      providerId,
      configured: false,
      maskedPreview: null,
      validationStatus: null,
      lastValidatedAt: null
    };
  }
}
