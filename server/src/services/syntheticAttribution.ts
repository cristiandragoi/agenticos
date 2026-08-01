import { logger } from '../utils/logger.js';
import { db } from '../db/index.js';
import { campaigns, attribution } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import crypto from 'crypto';

export async function runSyntheticAttribution() {
  try {
    // Find all active staging campaigns
    const activeStagingCampaigns = await db.select().from(campaigns)
      .where(and(
        eq(campaigns.status, 'active'),
        eq(campaigns.platform, 'staging')
      ));

    if (activeStagingCampaigns.length === 0) {
      return; // Nothing to do
    }

    logger.info(`[Synthetic Attribution] Processing ${activeStagingCampaigns.length} staging campaigns...`);

    for (const campaign of activeStagingCampaigns) {
      // Generate synthetic metrics for this tick
      const newViews = Math.floor(Math.random() * 500) + 10;
      const newClicks = Math.floor(newViews * (Math.random() * 0.05 + 0.01)); // 1-6% CTR
      const newConversions = Math.floor(newClicks * (Math.random() * 0.1 + 0.01)); // 1-11% CVR
      
      const revenuePerConversion = 49.99;
      const costPerClick = 0.45;
      
      const generatedRevenue = newConversions * revenuePerConversion;
      const generatedCost = newClicks * costPerClick;
      const profit = generatedRevenue - generatedCost;
      const roi = generatedCost > 0 ? (profit / generatedCost) * 100 : 0;
      
      // Determine agent/model randomly for synthetic data
      const agents = ['agent-hermes', 'agent-codex', 'agent-architect'];
      const models = ['qwen2.5-coder:14b', 'deepseek-coder-v2:16b', 'fugu-ultra', 'kimi-k2'];
      const randomAgent = agents[Math.floor(Math.random() * agents.length)];
      const randomModel = models[Math.floor(Math.random() * models.length)];

      const now = new Date().toISOString();

      // Insert attribution record
      await db.insert(attribution).values({
        id: crypto.randomUUID(),
        campaignId: campaign.id,
        assetId: null, // We could pull this if we linked it, but keep it simple
        agentId: randomAgent,
        model: randomModel,
        provider: 'synthetic',
        views: newViews,
        clicks: newClicks,
        conversions: newConversions,
        cost: generatedCost,
        revenue: generatedRevenue,
        commission: 0,
        profit: profit,
        roi: roi,
        confidence: 'high',
        createdAt: now,
        updatedAt: now,
      });

      // Update the campaign aggregations
      const currentSpend = campaign.spend || 0;
      const currentRevenue = campaign.revenue || 0;
      const newTotalSpend = currentSpend + generatedCost;
      const newTotalRevenue = currentRevenue + generatedRevenue;
      const newTotalProfit = newTotalRevenue - newTotalSpend;
      const newTotalRoi = newTotalSpend > 0 ? (newTotalProfit / newTotalSpend) * 100 : 0;

      await db.update(campaigns)
        .set({
          spend: newTotalSpend,
          revenue: newTotalRevenue,
          roi: newTotalRoi,
          updatedAt: now
        })
        .where(eq(campaigns.id, campaign.id));
    }
    
    logger.info(`[Synthetic Attribution] Successfully injected telemetry for ${activeStagingCampaigns.length} campaigns.`);
  } catch (err: any) {
    logger.error('[Synthetic Attribution] Error:', err.message);
  }
}
