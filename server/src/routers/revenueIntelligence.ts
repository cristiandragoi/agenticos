import { Router } from 'express';
import { db } from '../db/index.js';
import { campaigns, attribution, agentExecutions, agentPromptVersions, revenueOpportunities, generatedAssets } from '../db/schema.js';
import { eq, desc, and, sum, sql } from 'drizzle-orm';
import crypto from 'crypto';

const router = Router();

// ==========================================
// CAMPAIGNS CRUD
// ==========================================

// GET /api/revenue/campaigns
router.get('/campaigns', async (req, res) => {
  try {
    const results = await db.select().from(campaigns)
      .orderBy(desc(campaigns.createdAt));
    res.json(results);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch campaigns', details: error.message });
  }
});

// GET /api/revenue/campaigns/:id
router.get('/campaigns/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.select().from(campaigns).where(eq(campaigns.id, id)).limit(1);
    if (!result.length) return res.status(404).json({ error: 'Campaign not found' });
    res.json(result[0]);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch campaign', details: error.message });
  }
});

// POST /api/revenue/campaigns
router.post('/campaigns', async (req, res) => {
  try {
    const { opportunityId, briefId, name, platform, productReference, budget, notes } = req.body;
    
    if (!opportunityId || !briefId || !name || !platform) {
      return res.status(400).json({ error: 'opportunityId, briefId, name, and platform are required' });
    }

    const newId = crypto.randomUUID();
    const now = new Date().toISOString();

    const insertData = {
      id: newId,
      opportunityId,
      briefId,
      name,
      platform,
      productReference,
      status: 'draft',
      budget,
      notes,
      createdAt: now,
      updatedAt: now,
    };

    await db.insert(campaigns).values(insertData);
    res.status(201).json(insertData);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to create campaign', details: error.message });
  }
});

// PATCH /api/revenue/campaigns/:id
router.patch('/campaigns/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updates = { ...req.body, updatedAt: new Date().toISOString() };
    
    const result = await db.update(campaigns)
      .set(updates)
      .where(eq(campaigns.id, id))
      .returning();
      
    if (!result.length) return res.status(404).json({ error: 'Campaign not found' });
    res.json(result[0]);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to update campaign', details: error.message });
  }
});

// ==========================================
// ATTRIBUTION
// ==========================================

// GET /api/revenue/attribution
router.get('/attribution', async (req, res) => {
  try {
    const { campaignId, assetId } = req.query;
    let conditions = [];
    if (campaignId) conditions.push(eq(attribution.campaignId, String(campaignId)));
    if (assetId) conditions.push(eq(attribution.assetId, String(assetId)));

    const results = await db.select().from(attribution)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(attribution.createdAt));
      
    res.json(results);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch attribution records', details: error.message });
  }
});

// POST /api/revenue/attribution
router.post('/attribution', async (req, res) => {
  try {
    const data = req.body;
    if (!data.campaignId) {
      return res.status(400).json({ error: 'campaignId is required' });
    }

    const newId = crypto.randomUUID();
    const now = new Date().toISOString();

    const insertData = {
      id: newId,
      ...data,
      createdAt: now,
      updatedAt: now,
    };

    await db.insert(attribution).values(insertData);
    res.status(201).json(insertData);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to create attribution record', details: error.message });
  }
});

// ==========================================
// AGGREGATIONS / INTELLIGENCE
// ==========================================

// GET /api/revenue/intelligence/summary
router.get('/intelligence/summary', async (req, res) => {
  try {
    const attrResult = await db.select({
      totalRevenue: sql`SUM(${attribution.revenue})`,
      totalCommission: sql`SUM(${attribution.commission})`,
      totalCost: sql`SUM(${attribution.cost})`,
      totalProfit: sql`SUM(${attribution.profit})`,
      avgRoi: sql`AVG(${attribution.roi})`,
    }).from(attribution);

    const activeCampaignsCount = await db.select({ count: sql`COUNT(*)` })
      .from(campaigns)
      .where(eq(campaigns.status, 'active'));
      
    const completedCampaignsCount = await db.select({ count: sql`COUNT(*)` })
      .from(campaigns)
      .where(eq(campaigns.status, 'completed'));

    const lowConfidenceCount = await db.select({ count: sql`COUNT(*)` })
      .from(attribution)
      .where(eq(attribution.confidence, 'low'));

    res.json({
      revenue: attrResult[0].totalRevenue || 0,
      commission: attrResult[0].totalCommission || 0,
      cost: attrResult[0].totalCost || 0,
      profit: attrResult[0].totalProfit || 0,
      roi: attrResult[0].avgRoi || 0,
      activeCampaigns: activeCampaignsCount[0].count || 0,
      completedCampaigns: completedCampaignsCount[0].count || 0,
      lowConfidenceAttributions: lowConfidenceCount[0].count || 0,
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch summary', details: error.message });
  }
});

// GET /api/revenue/intelligence/agents
router.get('/intelligence/agents', async (req, res) => {
  try {
    const results = await db.select({
      agentId: attribution.agentId,
      totalRevenue: sql`SUM(${attribution.revenue})`,
      totalProfit: sql`SUM(${attribution.profit})`,
      avgRoi: sql`AVG(${attribution.roi})`,
      attributionsCount: sql`COUNT(*)`,
    }).from(attribution)
      .where(sql`${attribution.agentId} IS NOT NULL`)
      .groupBy(attribution.agentId)
      .orderBy(desc(sql`SUM(${attribution.revenue})`));
      
    res.json(results);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch agents intelligence', details: error.message });
  }
});

// GET /api/revenue/intelligence/prompts
router.get('/intelligence/prompts', async (req, res) => {
  try {
    const results = await db.select({
      promptVersionId: attribution.promptVersionId,
      agentId: attribution.agentId,
      totalRevenue: sql`SUM(${attribution.revenue})`,
      totalProfit: sql`SUM(${attribution.profit})`,
      avgRoi: sql`AVG(${attribution.roi})`,
      attributionsCount: sql`COUNT(*)`,
    }).from(attribution)
      .where(sql`${attribution.promptVersionId} IS NOT NULL`)
      .groupBy(attribution.promptVersionId, attribution.agentId)
      .orderBy(desc(sql`SUM(${attribution.revenue})`));
      
    res.json(results);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch prompts intelligence', details: error.message });
  }
});

// GET /api/revenue/intelligence/campaigns
router.get('/intelligence/campaigns', async (req, res) => {
  try {
    const results = await db.select({
      id: campaigns.id,
      name: campaigns.name,
      platform: campaigns.platform,
      status: campaigns.status,
      revenue: campaigns.revenue,
      spend: campaigns.spend,
      roi: campaigns.roi,
      opportunityId: campaigns.opportunityId,
    }).from(campaigns)
      .orderBy(desc(campaigns.createdAt));
      
    res.json(results);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch campaigns intelligence', details: error.message });
  }
});

export default router;
