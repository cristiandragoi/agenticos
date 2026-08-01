import { logger } from '../../utils/logger.js';
import { eventBus, SystemEventPayload } from '../../core/eventBus.js';
import { db } from '../../db/index.js';
import { treasuryLedger, attribution } from '../../db/schema.js';
import crypto from 'crypto';
import { eq } from 'drizzle-orm';

/**
 * Cost Tracker
 * Subscribes to internal AI `cost_incurred` events and logs them to the Treasury Ledger.
 */
class CostTracker {
  constructor() {
    eventBus.on('cost_incurred', this.handleCost.bind(this));
  }

  private async handleCost(event: SystemEventPayload) {
    const cost = event.payload.cost || 0;
    const runId = event.payload.runId;
    const campaignId = event.payload.campaignId; // Optional: May be present if executing within a campaign context
    
    if (cost <= 0) return;

    try {
      // 1. Insert into Treasury Ledger as a negative transaction (cost)
      await db.insert(treasuryLedger).values({
        id: `tx_${crypto.randomUUID()}`,
        transactionType: 'cost',
        amount: -cost, // costs are negative
        currency: 'USD',
        source: event.source, // e.g., 'openai', 'anthropic'
        campaignId: campaignId || null,
        runId: runId || null,
        timestamp: event.timestamp || new Date().toISOString(),
        createdAt: new Date().toISOString()
      });

      // 2. If campaign is known, update attribution cost directly
      if (campaignId) {
        const records = await db.select().from(attribution).where(eq(attribution.campaignId, campaignId));
        if (records.length > 0) {
          const record = records[0];
          const newCost = (record.cost || 0) + cost;
          await db.update(attribution)
            .set({
              cost: newCost,
              profit: (record.revenue || 0) - newCost,
              roi: newCost > 0 ? (record.revenue || 0) / newCost : 0
            })
            .where(eq(attribution.id, record.id));
        }
      }

      logger.info(`[CostTracker] Incurred cost $${cost.toFixed(4)} from ${event.source} (Run: ${runId})`);
    } catch (err) {
      logger.error('[CostTracker] Error handling cost event', err);
    }
  }
}

export const costTracker = new CostTracker();
