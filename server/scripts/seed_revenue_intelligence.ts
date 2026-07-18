import { db } from '../src/db/index.js';
import { campaigns, attribution, revenueOpportunities, productionBriefs, agentPromptVersions } from '../src/db/schema.js';
import crypto from 'crypto';

async function seed() {
  console.log('Seeding Revenue Intelligence metrics...');

  // Create a mock opportunity and brief to link if none exist, or fetch one
  let opps = await db.select().from(revenueOpportunities).limit(1);
  if (!opps.length) {
    console.log('No revenue opportunities found. Skipping intelligence seed.');
    return;
  }
  const oppId = opps[0].id;

  let briefs = await db.select().from(productionBriefs).limit(1);
  const briefId = briefs.length ? briefs[0].id : `brief-${crypto.randomUUID()}`;

  let prompts = await db.select().from(agentPromptVersions).limit(2);
  const prompt1 = prompts.length > 0 ? prompts[0].id : `prompt-${crypto.randomUUID()}`;
  const prompt2 = prompts.length > 1 ? prompts[1].id : `prompt-${crypto.randomUUID()}`;

  // Create 2 Campaigns
  const campaign1Id = `camp-${crypto.randomUUID()}`;
  const campaign2Id = `camp-${crypto.randomUUID()}`;
  const now = new Date().toISOString();

  await db.insert(campaigns).values([
    {
      id: campaign1Id,
      opportunityId: oppId,
      briefId: briefId,
      name: 'Summer TikTok Challenge',
      platform: 'TikTok',
      productReference: 'Product A',
      status: 'active',
      budget: 1000,
      spend: 450,
      revenue: 3200,
      commission: 640,
      roi: 3.2,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: campaign2Id,
      opportunityId: oppId,
      briefId: briefId,
      name: 'SEO Blog Conversion Test',
      platform: 'Web',
      productReference: 'Product B',
      status: 'completed',
      budget: 500,
      spend: 500,
      revenue: 1200,
      commission: 240,
      roi: 2.4,
      createdAt: now,
      updatedAt: now,
    }
  ]);

  console.log('Created 2 campaigns.');

  // Create 5 Attribution records
  await db.insert(attribution).values([
    {
      id: `attr-${crypto.randomUUID()}`,
      campaignId: campaign1Id,
      agentId: 'tiktok-agent',
      promptVersionId: prompt1,
      model: 'claude-3-5-sonnet',
      views: 15000,
      clicks: 450,
      conversions: 35,
      revenue: 1800,
      commission: 360,
      cost: 200,
      profit: 160,
      roi: 9.0,
      confidence: 'high',
      source: 'tiktok_ads',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: `attr-${crypto.randomUUID()}`,
      campaignId: campaign1Id,
      agentId: 'tiktok-agent',
      promptVersionId: prompt2,
      model: 'gpt-4o',
      views: 12000,
      clicks: 300,
      conversions: 20,
      revenue: 1400,
      commission: 280,
      cost: 250,
      profit: 30,
      roi: 5.6,
      confidence: 'medium',
      source: 'tiktok_ads',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: `attr-${crypto.randomUUID()}`,
      campaignId: campaign2Id,
      agentId: 'seo-agent',
      promptVersionId: prompt1,
      model: 'claude-3-5-sonnet',
      views: 5000,
      clicks: 120,
      conversions: 10,
      revenue: 600,
      commission: 120,
      cost: 100,
      profit: 20,
      roi: 6.0,
      confidence: 'high',
      source: 'google_analytics',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: `attr-${crypto.randomUUID()}`,
      campaignId: campaign2Id,
      agentId: 'seo-agent',
      promptVersionId: prompt2,
      model: 'claude-3-5-sonnet',
      views: 3000,
      clicks: 80,
      conversions: 8,
      revenue: 500,
      commission: 100,
      cost: 100,
      profit: 0,
      roi: 5.0,
      confidence: 'medium',
      source: 'google_analytics',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: `attr-${crypto.randomUUID()}`,
      campaignId: campaign2Id,
      agentId: 'unknown-agent',
      promptVersionId: 'unknown',
      model: 'unknown',
      views: 2000,
      clicks: 30,
      conversions: 2,
      revenue: 100,
      commission: 20,
      cost: 50,
      profit: -30,
      roi: 2.0,
      confidence: 'low',
      source: 'direct',
      createdAt: now,
      updatedAt: now,
    }
  ]);

  console.log('Created 5 attribution records.');
  console.log('Done.');
}

seed().catch(console.error);
