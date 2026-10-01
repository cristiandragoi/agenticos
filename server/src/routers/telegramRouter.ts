/**
 * telegramRouter.ts — Telegram Remote Jarvis API Endpoints
 *
 * Exposes:
 *   GET    /api/integrations/telegram/status    Safe status inspection (TELEGRAM_NOT_CONFIGURED if unconfigured)
 *   POST   /api/integrations/telegram/configure Secure token and allowlist storage via CanonicalSecretStore
 *   POST   /api/integrations/telegram/test      Validate connectivity and token
 *   DELETE /api/integrations/telegram/credentials Remove stored credentials
 *
 * Invariant: NEVER exposes plain bot token in responses or logs.
 */

import { Router, Request, Response } from 'express';
import { telegramAdapter } from '../adapters/telegramAdapter.js';
import { secretStore } from '../services/gateway/secretStore.js';
import { logger } from '../utils/logger.js';

export const telegramRouter = Router();

/**
 * GET /api/integrations/telegram/status
 * Returns authoritative adapter status without exposing secrets.
 */
telegramRouter.get('/status', (_req: Request, res: Response) => {
  try {
    const status = telegramAdapter.getStatus();
    return res.json(status);
  } catch (err: any) {
    logger.error('[telegramRouter] Failed to retrieve status:', err);
    return res.status(500).json({
      configured: false,
      connected: false,
      polling: false,
      status: 'ERROR',
      lastError: err?.message || 'Failed to retrieve status',
    });
  }
});

/**
 * POST /api/integrations/telegram/configure
 * Securely saves token and allowlists to SecretStore and reloads adapter.
 */
telegramRouter.post('/configure', async (req: Request, res: Response) => {
  try {
    const { botToken, allowedUserIds, allowedChatIds } = req.body || {};

    if (botToken !== undefined) {
      const cleanToken = typeof botToken === 'string' ? botToken.trim() : '';
      if (cleanToken.length > 0) {
        await secretStore.set('telegram.bot_token', cleanToken);
        logger.info('[telegramRouter] Stored telegram.bot_token securely in SecretStore');
      } else {
        await secretStore.delete('telegram.bot_token');
        logger.info('[telegramRouter] Cleared telegram.bot_token from SecretStore');
      }
    }

    if (allowedUserIds !== undefined) {
      const serialized = Array.isArray(allowedUserIds)
        ? allowedUserIds.join(', ')
        : String(allowedUserIds || '');
      await secretStore.set('telegram.allowed_user_ids', serialized.trim());
    }

    if (allowedChatIds !== undefined) {
      const serialized = Array.isArray(allowedChatIds)
        ? allowedChatIds.join(', ')
        : String(allowedChatIds || '');
      await secretStore.set('telegram.allowed_chat_ids', serialized.trim());
    }

    // Reload the adapter with fresh secrets
    await telegramAdapter.reload();

    const status = telegramAdapter.getStatus();
    return res.json({
      success: true,
      message: status.connected ? 'Telegram bot connected successfully' : 'Configuration saved',
      status,
    });
  } catch (err: any) {
    logger.error('[telegramRouter] Failed to configure Telegram integration:', err);
    return res.status(500).json({ error: err?.message || 'Failed to save Telegram configuration' });
  }
});

/**
 * POST /api/integrations/telegram/test
 * Reloads and validates the current credentials.
 */
telegramRouter.post('/test', async (_req: Request, res: Response) => {
  try {
    await telegramAdapter.reload();
    const status = telegramAdapter.getStatus();
    return res.json({
      success: status.connected,
      status,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Test failed' });
  }
});

/**
 * DELETE /api/integrations/telegram/credentials
 * Deletes all stored Telegram secrets.
 */
telegramRouter.delete('/credentials', async (_req: Request, res: Response) => {
  try {
    await secretStore.delete('telegram.bot_token');
    await secretStore.delete('telegram.allowed_user_ids');
    await secretStore.delete('telegram.allowed_chat_ids');

    await telegramAdapter.reload();
    return res.json({
      success: true,
      status: telegramAdapter.getStatus(),
    });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Failed to delete credentials' });
  }
});

export default telegramRouter;
