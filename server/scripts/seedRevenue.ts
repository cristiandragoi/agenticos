import { db } from '../dist/db/index.js';
import { revenueOpportunities, revenueOpportunityEvents } from '../dist/db/schema.js';
import crypto from 'crypto';

async function seed() {
  console.log('Seeding Revenue Opportunities...');

  const opp1Id = crypto.randomUUID();
  const opp2Id = crypto.randomUUID();
  const opp3Id = crypto.randomUUID();

  // 1. TikTok Affiliate
  await db.insert(revenueOpportunities).values({
    id: opp1Id,
    title: 'TikTok Affiliate - LED Lights',
    description: 'Promote viral LED room lights via TikTok shop affiliate link.',
    opportunityType: 'affiliate',
    sourcePlatform: 'tiktok',
    stage: 'discovered',
    overallScore: 85,
    estimatedRevenue: 500,
    approvalStatus: 'not_required',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  await db.insert(revenueOpportunityEvents).values({
    id: crypto.randomUUID(),
    opportunityId: opp1Id,
    eventType: 'creation',
    nextStage: 'discovered',
    createdAt: new Date().toISOString(),
  });

  // 2. Digital Product (Needs Approval)
  await db.insert(revenueOpportunities).values({
    id: opp2Id,
    title: 'Agentic Workflow E-Book',
    description: 'A comprehensive guide on building autonomous agents.',
    opportunityType: 'digital_product',
    sourcePlatform: 'gumroad',
    stage: 'awaiting_approval',
    overallScore: 92,
    estimatedRevenue: 2500,
    approvalStatus: 'pending',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  await db.insert(revenueOpportunityEvents).values({
    id: crypto.randomUUID(),
    opportunityId: opp2Id,
    eventType: 'creation',
    nextStage: 'awaiting_approval',
    createdAt: new Date().toISOString(),
  });

  // 3. Software Prototype (In Production)
  await db.insert(revenueOpportunities).values({
    id: opp3Id,
    title: 'SaaS Micro-Tool - Image Optimizer',
    description: 'Simple web app to compress images for SEO.',
    opportunityType: 'saas',
    sourcePlatform: 'stripe',
    stage: 'in_production',
    overallScore: 78,
    estimatedRevenue: 1200,
    approvalStatus: 'approved',
    approvedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  await db.insert(revenueOpportunityEvents).values({
    id: crypto.randomUUID(),
    opportunityId: opp3Id,
    eventType: 'creation',
    nextStage: 'in_production',
    createdAt: new Date().toISOString(),
  });

  console.log('Seeded 3 Revenue Opportunities.');
}

seed().catch(err => {
  console.error('Seed failed', err);
  process.exit(1);
});
