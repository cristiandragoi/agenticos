import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TelegramAdapter, telegramAdapter } from '../adapters/telegramAdapter.js';
import { secretStore } from '../services/gateway/secretStore.js';

describe('Telegram Remote Jarvis Integration', () => {
  beforeEach(async () => {
    // Ensure clean state for testing
    await secretStore.delete('telegram.bot_token');
    await secretStore.delete('telegram.allowed_user_ids');
    await secretStore.delete('telegram.allowed_chat_ids');
    await telegramAdapter.loadConfig();
  });

  it('1. Reports TELEGRAM_NOT_CONFIGURED when no token is present', async () => {
    await telegramAdapter.start();
    const status = telegramAdapter.getStatus();

    expect(status.configured).toBe(false);
    expect(status.connected).toBe(false);
    expect(status.polling).toBe(false);
    expect(status.status).toBe('TELEGRAM_NOT_CONFIGURED');
    expect(status.botUsername).toBeNull();
    expect(status.lastError).toBe('TELEGRAM_NOT_CONFIGURED');
    // Token is NEVER exposed in status
    expect((status as any).botToken).toBeUndefined();
  });

  it('2. SecretStore supports telegram keys canonically', async () => {
    await secretStore.set('telegram.bot_token', 'test-token-12345');
    await secretStore.set('telegram.allowed_user_ids', '111111, 222222');
    await secretStore.set('telegram.allowed_chat_ids', '333333');

    const token = await secretStore.get('telegram.bot_token');
    const userIds = await secretStore.get('telegram.allowed_user_ids');
    const chatIds = await secretStore.get('telegram.allowed_chat_ids');

    expect(token).toBe('test-token-12345');
    expect(userIds).toContain('111111');
    expect(chatIds).toBe('333333');

    // Clean up
    await secretStore.delete('telegram.bot_token');
    await secretStore.delete('telegram.allowed_user_ids');
    await secretStore.delete('telegram.allowed_chat_ids');
  });

  it('3. Rejects unauthorized incoming messages with zero execution', async () => {
    await secretStore.set('telegram.allowed_user_ids', '999888777');
    await telegramAdapter.loadConfig();

    // Use reflectively to verify authorization
    const isAuth = (telegramAdapter as any).isAuthorized('123456789', '987654321');
    expect(isAuth).toBe(false);

    const isAuthorizedUser = (telegramAdapter as any).isAuthorized('999888777', '987654321');
    expect(isAuthorizedUser).toBe(true);

    await secretStore.delete('telegram.allowed_user_ids');
  });

  it('4. Rejects all messages if no allowlist is configured (fail-closed security)', async () => {
    await telegramAdapter.loadConfig();
    const isAuth = (telegramAdapter as any).isAuthorized('123456789', '987654321');
    expect(isAuth).toBe(false);
  });

  it('5. Allows messages matching allowed_chat_ids', async () => {
    await secretStore.set('telegram.allowed_chat_ids', '-100987654321');
    await telegramAdapter.loadConfig();

    const isAuth = (telegramAdapter as any).isAuthorized('123456789', '-100987654321');
    expect(isAuth).toBe(true);

    const isUnauthorized = (telegramAdapter as any).isAuthorized('123456789', 'other-chat');
    expect(isUnauthorized).toBe(false);

    await secretStore.delete('telegram.allowed_chat_ids');
  });

  it('6. Status payload matches required contract and contains no credentials', () => {
    const status = telegramAdapter.getStatus();
    expect(status).toHaveProperty('configured');
    expect(status).toHaveProperty('connected');
    expect(status).toHaveProperty('polling');
    expect(status).toHaveProperty('status');
    expect(status).toHaveProperty('botUsername');
    expect(status).toHaveProperty('authorizedUserCount');
    expect(status).toHaveProperty('authorizedChatCount');
    expect(status).toHaveProperty('lastInboundMessageAt');
    expect(status).toHaveProperty('lastInboundMessageId');
    expect(status).toHaveProperty('lastInboundChatId');
    expect(status).toHaveProperty('mappedConversationId');
    expect(status).toHaveProperty('lastExecutionStatus');

    const json = JSON.stringify(status);
    expect(json).not.toContain('botToken');
    expect(json).not.toContain('test-token');
  });

  it('7. CanonicalTurnExecutionService answers presence check "Jarvis, are you there?" with "I\'m here."', async () => {
    const { CanonicalTurnExecutionService } = await import('../domains/jarvis/canonicalTurnExecutionService.js');
    const service = CanonicalTurnExecutionService.getInstance();

    const result = await service.execute({
      conversationId: 'conv-telegram-test-1',
      prompt: 'Jarvis, are you there?',
      modality: 'telegram',
      telegramContext: { chatId: '12345', userId: '67890', messageId: 42 },
    });

    expect(result.assistantText).toBe("I'm here.");
    expect(result.status).toBe('completed');
    expect(result.verified).toBe(true);
    expect(result.route).toBe('direct');
  });

  it('8. CanonicalTurnExecutionService answers worker query "What is AntiGravity doing right now?" with real worker state', async () => {
    const { CanonicalTurnExecutionService } = await import('../domains/jarvis/canonicalTurnExecutionService.js');
    const service = CanonicalTurnExecutionService.getInstance();

    const result = await service.execute({
      conversationId: 'conv-telegram-test-2',
      prompt: 'What is AntiGravity doing right now?',
      modality: 'telegram',
    });

    expect(result.assistantText).toContain('AntiGravity is currently');
    expect(result.status).toBe('completed');
    expect(result.verified).toBe(true);
    expect(result.route).toBe('worker_status');
  });

  it('9. CanonicalTurnExecutionService answers desktop introspection "Did you receive my Telegram message?"', async () => {
    const { CanonicalTurnExecutionService } = await import('../domains/jarvis/canonicalTurnExecutionService.js');
    const service = CanonicalTurnExecutionService.getInstance();

    const result = await service.execute({
      conversationId: 'conv-desktop-1',
      prompt: 'Did you receive my Telegram message?',
      modality: 'desktop_chat',
    });

    expect(result.assistantText).toBeDefined();
    expect(result.route).toBe('telegram_introspection');
    expect(result.verified).toBe(true);
  });
});
