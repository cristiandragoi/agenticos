import { logger } from '../../utils/logger.js';
import { BaseConnector } from '../BaseConnector.js';
import { SystemEventPayload, SystemEventType } from '../../core/eventBus.js';

/**
 * MockTikTokConnector
 * Simulates receiving standard TikTok Shop / Analytics webhook payloads
 * and maps them into Agentic OS canonical events.
 */
export class MockTikTokConnector extends BaseConnector {
  constructor() {
    super('tiktok_shop');
  }

  normalizeEvent(rawPayload: any): SystemEventPayload | null {
    // Basic structural validation
    if (!rawPayload || !rawPayload.type) {
      return null;
    }

    let eventType: SystemEventType;
    
    // Map TikTok's mock webhook types to our canonical events
    switch (rawPayload.type) {
      case 'tiktok.video.view':
        eventType = 'video_view';
        break;
      case 'tiktok.video.complete':
        eventType = 'video_complete';
        break;
      case 'tiktok.shop.click':
        eventType = 'click';
        break;
      case 'tiktok.shop.cart':
        eventType = 'cart';
        break;
      case 'tiktok.shop.purchase':
        eventType = 'purchase';
        break;
      case 'tiktok.shop.affiliate_commission':
        eventType = 'affiliate_commission';
        break;
      default:
        logger.info(`[MockTikTokConnector] Unrecognized event type: ${rawPayload.type}`);
        return null; // Ignore unknown events
    }

    return {
      eventType,
      source: this.sourceName,
      payload: rawPayload.data || {},
      timestamp: rawPayload.timestamp || new Date().toISOString()
    };
  }
}

export const mockTikTokConnector = new MockTikTokConnector();
