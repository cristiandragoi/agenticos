import { logger } from '../../utils/logger.js';
import { eventBus, SystemEventPayload } from '../../core/eventBus.js';
import { db } from '../../db/index.js';
import { attribution, treasuryLedger } from '../../db/schema.js';
import { eq } from 'drizzle-orm';
import crypto from 'crypto';

/**
 * Attribution Engine
 * Subscribes to the Event Bus to map external conversions/views back to 
 * their underlying Campaign, Asset, Execution, and Agent.
 */
class AttributionEngine {
  constructor() {
    this.initListeners();
  }

  private initListeners() {
    // Listen for high-level engagement events
    eventBus.on('video_view', this.handleEngagement.bind(this));
    eventBus.on('click', this.handleEngagement.bind(this));
    eventBus.on('purchase', this.handleConversion.bind(this));
  }

  private async handleEngagement(event: SystemEventPayload) {
    const campaignId = event.payload.campaign_id;
    if (!campaignId) return;

    try {
      const records = await db.select().from(attribution).where(eq(attribution.campaignId, campaignId));
      if (records.length === 0) return; // No matching attribution record
      
      const record = records[0];
      
      if (event.eventType === 'video_view') {
        await db.update(attribution)
          .set({ views: (record.views || 0) + 1 })
          .where(eq(attribution.id, record.id));
      } else if (event.eventType === 'click') {
        await db.update(attribution)
          .set({ clicks: (record.clicks || 0) + 1 })
          .where(eq(attribution.id, record.id));
      }
    } catch (err) {
      logger.error('[AttributionEngine] Error handling engagement event', err);
    }
  }

  private async handleConversion(event: SystemEventPayload) {
    const campaignId = event.payload.campaign_id;
    const revenueAmount = event.payload.revenue || 0;
    
    if (!campaignId) return;

    try {
      // 1. Update attribution record
      const records = await db.select().from(attribution).where(eq(attribution.campaignId, campaignId));
      if (records.length > 0) {
        const record = records[0];
        
        await db.update(attribution)
          .set({
            conversions: (record.conversions || 0) + 1,
            revenue: (record.revenue || 0) + revenueAmount,
            profit: (record.revenue || 0) + revenueAmount - (record.cost || 0),
            roi: (record.cost || 0) > 0 ? ((record.revenue || 0) + revenueAmount) / (record.cost || 1) : 0
          })
          .where(eq(attribution.id, record.id));
      }

      // 2. Insert into Treasury Ledger
      if (revenueAmount > 0) {
        await db.insert(treasuryLedger).values({
          id: `tx_${crypto.randomUUID()}`,
          transactionType: 'revenue',
          amount: revenueAmount,
          currency: event.payload.currency || 'USD',
          source: event.source,
          campaignId: campaignId,
          timestamp: event.timestamp || new Date().toISOString(),
          createdAt: new Date().toISOString()
        });
      }

      logger.info(`[AttributionEngine] Traced conversion for campaign ${campaignId}. Added $${revenueAmount} to treasury.`);
    } catch (err) {
      logger.error('[AttributionEngine] Error handling conversion event', err);
    }
  }
}

export const attributionEngine = new AttributionEngine();
