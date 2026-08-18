import { Router } from 'express';
import { db } from '../db/index.js';
import { revenueOpportunities, revenueOpportunityEvents, productionBriefs, productionBriefEvents, generatedAssets, tasks, runs, campaigns } from '../db/schema.js';
import { eq, desc, and } from 'drizzle-orm';
import crypto from 'crypto';

const router = Router();

// Helper to log events
async function logEvent(opportunityId: string, eventType: string, previousStage: string | null, nextStage: string | null, actorType: string = 'system', metadata: any = {}) {
  await db.insert(revenueOpportunityEvents).values({
    id: crypto.randomUUID(),
    opportunityId,
    eventType,
    previousStage,
    nextStage,
    actorType,
    actorId: 'system',
    metadata: JSON.stringify(metadata),
    createdAt: new Date().toISOString(),
  });
}

// 1. GET /api/revenue/opportunities
router.get('/opportunities', async (req, res) => {
  try {
    const { stage, approvalStatus, opportunityType } = req.query;
    let conditions = [];
    
    if (stage) conditions.push(eq(revenueOpportunities.stage, String(stage)));
    if (approvalStatus) conditions.push(eq(revenueOpportunities.approvalStatus, String(approvalStatus)));
    if (opportunityType) conditions.push(eq(revenueOpportunities.opportunityType, String(opportunityType)));

    const results = await db.select().from(revenueOpportunities)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(revenueOpportunities.createdAt));
      
    res.json(results);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch opportunities', details: error.message });
  }
});

// 2. GET /api/revenue/opportunities/:id
router.get('/opportunities/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.select().from(revenueOpportunities).where(eq(revenueOpportunities.id, id)).limit(1);
    
    if (result.length === 0) {
      return res.status(404).json({ error: 'Opportunity not found' });
    }
    res.json(result[0]);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch opportunity', details: error.message });
  }
});

// 2b. GET /api/revenue/opportunities/:id/events
router.get('/opportunities/:id/events', async (req, res) => {
  try {
    const { id } = req.params;
    const events = await db.select().from(revenueOpportunityEvents)
      .where(eq(revenueOpportunityEvents.opportunityId, id))
      .orderBy(desc(revenueOpportunityEvents.createdAt));
      
    res.json(events);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch opportunity events', details: error.message });
  }
});

// 3. POST /api/revenue/opportunities
router.post('/opportunities', async (req, res) => {
  try {
    const { title, description, opportunityType, sourcePlatform, sourceUrl } = req.body;
    
    if (!title || !opportunityType) {
      return res.status(400).json({ error: 'title and opportunityType are required' });
    }

    const newId = crypto.randomUUID();
    const now = new Date().toISOString();

    const insertData = {
      id: newId,
      title,
      description,
      opportunityType,
      sourcePlatform,
      sourceUrl,
      stage: 'discovered',
      approvalStatus: 'not_required',
      createdAt: now,
      updatedAt: now,
    };

    await db.insert(revenueOpportunities).values(insertData);
    await logEvent(newId, 'creation', null, 'discovered', 'user', { createdVia: 'api' });

    res.status(201).json(insertData);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to create opportunity', details: error.message });
  }
});

// 4. PATCH /api/revenue/opportunities/:id
router.patch('/opportunities/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = { ...req.body, updatedAt: new Date().toISOString() };
    
    // Prevent updating critical fields via generic patch
    delete updateData.id;
    delete updateData.stage;
    delete updateData.approvalStatus;

    const result = await db.update(revenueOpportunities)
      .set(updateData)
      .where(eq(revenueOpportunities.id, id))
      .returning();

    if (result.length === 0) {
      return res.status(404).json({ error: 'Opportunity not found' });
    }
    
    await logEvent(id, 'metadata_change', null, null, 'user', { changedFields: Object.keys(updateData) });

    res.json(result[0]);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to update opportunity', details: error.message });
  }
});

// 5. POST /api/revenue/opportunities/:id/transition
const VALID_STAGES = ['discovered', 'researching', 'scored', 'awaiting_approval', 'approved', 'in_production', 'published', 'measuring', 'rejected', 'archived'];

router.post('/opportunities/:id/transition', async (req, res) => {
  try {
    const { id } = req.params;
    const { stage } = req.body;

    if (!stage || !VALID_STAGES.includes(stage)) {
      return res.status(400).json({ error: 'Valid stage is required' });
    }

    const current = await db.select().from(revenueOpportunities).where(eq(revenueOpportunities.id, id)).limit(1);
    if (current.length === 0) return res.status(404).json({ error: 'Opportunity not found' });

    const prevStage = current[0].stage;

    // Optional: add stricter state machine rules here if desired

    const result = await db.update(revenueOpportunities)
      .set({ stage, updatedAt: new Date().toISOString() })
      .where(eq(revenueOpportunities.id, id))
      .returning();

    await logEvent(id, 'stage_transition', prevStage, stage, 'user', {});

    res.json(result[0]);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to transition opportunity', details: error.message });
  }
});

// 6. POST /api/revenue/opportunities/:id/approve
router.post('/opportunities/:id/approve', async (req, res) => {
  try {
    const { id } = req.params;

    const current = await db.select().from(revenueOpportunities).where(eq(revenueOpportunities.id, id)).limit(1);
    if (current.length === 0) return res.status(404).json({ error: 'Opportunity not found' });

    if (current[0].stage !== 'awaiting_approval') {
      return res.status(409).json({ error: 'Opportunity must be in awaiting_approval stage to be approved' });
    }

    const result = await db.update(revenueOpportunities)
      .set({ 
        approvalStatus: 'approved', 
        stage: 'approved',
        approvedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      })
      .where(eq(revenueOpportunities.id, id))
      .returning();

    await logEvent(id, 'approval', 'awaiting_approval', 'approved', 'user', { action: 'approve' });

    res.json(result[0]);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to approve opportunity', details: error.message });
  }
});

// 7. POST /api/revenue/opportunities/:id/reject
router.post('/opportunities/:id/reject', async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    if (!reason) {
      return res.status(400).json({ error: 'Rejection reason is required' });
    }

    const current = await db.select().from(revenueOpportunities).where(eq(revenueOpportunities.id, id)).limit(1);
    if (current.length === 0) return res.status(404).json({ error: 'Opportunity not found' });

    if (current[0].stage !== 'awaiting_approval') {
      return res.status(409).json({ error: 'Opportunity must be in awaiting_approval stage to be rejected' });
    }

    const result = await db.update(revenueOpportunities)
      .set({ 
        approvalStatus: 'rejected', 
        stage: 'rejected',
        rejectionReason: reason,
        updatedAt: new Date().toISOString()
      })
      .where(eq(revenueOpportunities.id, id))
      .returning();

    await logEvent(id, 'rejection', 'awaiting_approval', 'rejected', 'user', { reason });

    res.json(result[0]);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to reject opportunity', details: error.message });
  }
});

// 8. POST /api/revenue/opportunities/check-duplicate
router.post('/opportunities/check-duplicate', async (req, res) => {
  try {
    const { sourceUrl, title, sourcePlatform } = req.body;
    let conditions = [];
    if (sourceUrl) conditions.push(eq(revenueOpportunities.sourceUrl, sourceUrl));
    if (title && sourcePlatform) {
      conditions.push(and(eq(revenueOpportunities.title, title), eq(revenueOpportunities.sourcePlatform, sourcePlatform)));
    }
    
    if (conditions.length === 0) return res.json({ duplicate: false });

    // Using OR for multiple conditions
    // Actually drizzle OR is needed, let's just do a simple search
    // We will find by URL first, then by title+platform
    let match = null;
    if (sourceUrl) {
      const byUrl = await db.select().from(revenueOpportunities).where(eq(revenueOpportunities.sourceUrl, sourceUrl)).limit(1);
      if (byUrl.length > 0) match = byUrl[0];
    }
    if (!match && title && sourcePlatform) {
      const byTitle = await db.select().from(revenueOpportunities).where(and(eq(revenueOpportunities.title, title), eq(revenueOpportunities.sourcePlatform, sourcePlatform))).limit(1);
      if (byTitle.length > 0) match = byTitle[0];
    }

    if (match) {
      return res.json({ duplicate: true, opportunity: match });
    }
    return res.json({ duplicate: false });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to check duplicates', details: error.message });
  }
});

// 9. POST /api/revenue/opportunities/:id/evidence
router.post('/opportunities/:id/evidence', async (req, res) => {
  try {
    const { id } = req.params;
    const { evidence } = req.body;

    const current = await db.select().from(revenueOpportunities).where(eq(revenueOpportunities.id, id)).limit(1);
    if (current.length === 0) return res.status(404).json({ error: 'Opportunity not found' });

    const opp = current[0];
    const payloadStr = opp.evidencePayload as string | null;
    let evidenceList: any[] = [];
    if (payloadStr) {
      try { evidenceList = JSON.parse(payloadStr); } catch (e) {}
    }
    
    evidenceList.push(evidence);
    
    const result = await db.update(revenueOpportunities)
      .set({ 
        evidencePayload: JSON.stringify(evidenceList),
        updatedAt: new Date().toISOString()
      })
      .where(eq(revenueOpportunities.id, id))
      .returning();

    await logEvent(id, 'evidence_added', null, null, 'user', { evidenceTitle: evidence.title });

    res.json(result[0]);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to append evidence', details: error.message });
  }
});

// 10. POST /api/revenue/opportunities/:id/score
import { scoreOpportunity } from '../services/revenue/scoring.js';

router.post('/opportunities/:id/score', async (req, res) => {
  try {
    const { id } = req.params;
    const current = await db.select().from(revenueOpportunities).where(eq(revenueOpportunities.id, id)).limit(1);
    if (current.length === 0) return res.status(404).json({ error: 'Opportunity not found' });
    
    const opp = current[0];
    if (!['discovered', 'researching', 'scored'].includes(opp.stage)) {
      return res.status(400).json({ error: 'Opportunity cannot be scored in current stage' });
    }

    if (opp.stage === 'discovered') {
      await db.update(revenueOpportunities).set({ stage: 'researching' }).where(eq(revenueOpportunities.id, id));
      await logEvent(id, 'stage_transition', 'discovered', 'researching');
    }

    const payloadStr = opp.evidencePayload as string | null;
    let evidenceList: any[] = [];
    if (payloadStr) {
      try { evidenceList = JSON.parse(payloadStr); } catch (e) {}
    }

    const result = scoreOpportunity(evidenceList);

    const updated = await db.update(revenueOpportunities)
      .set({
        demandScore: result.demandScore,
        competitionScore: result.competitionScore,
        profitabilityScore: result.profitabilityScore,
        complianceRiskScore: result.complianceRiskScore,
        evidenceQualityScore: result.evidenceQualityScore,
        overallScore: result.overallScore,
        scoringConfidence: result.confidence,
        scoringVersion: result.scoringVersion,
        researchPayload: JSON.stringify(result),
        stage: 'scored',
        updatedAt: new Date().toISOString()
      })
      .where(eq(revenueOpportunities.id, id))
      .returning();

    await logEvent(id, 'opportunity_scored', opp.stage, 'scored', 'system', {
      scoringVersion: result.scoringVersion,
      confidence: result.confidence,
      overallScore: result.overallScore,
    });

    res.json(updated[0]);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to score opportunity', details: error.message });
  }
});

// 11. POST /api/revenue/opportunities/:id/request-approval
router.post('/opportunities/:id/request-approval', async (req, res) => {
  try {
    const { id } = req.params;
    const current = await db.select().from(revenueOpportunities).where(eq(revenueOpportunities.id, id)).limit(1);
    if (current.length === 0) return res.status(404).json({ error: 'Opportunity not found' });
    
    const opp = current[0];
    if (opp.stage !== 'scored') {
      return res.status(400).json({ error: 'Opportunity must be scored before requesting approval' });
    }
    
    if (opp.overallScore === null) {
      return res.status(400).json({ error: 'Opportunity has not been scored' });
    }

    const updated = await db.update(revenueOpportunities)
      .set({
        stage: 'awaiting_approval',
        approvalStatus: 'pending',
        updatedAt: new Date().toISOString()
      })
      .where(eq(revenueOpportunities.id, id))
      .returning();

    await logEvent(id, 'approval_requested', 'scored', 'awaiting_approval');

    res.json(updated[0]);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to request approval', details: error.message });
  }
});

// 12. GET /api/revenue/metrics
router.get('/metrics', async (req, res) => {
  try {
    const allOpps = await db.select().from(revenueOpportunities);
    const allBriefs = await db.select().from(productionBriefs);
    const allAssets = await db.select().from(generatedAssets);

    const countsByStage: Record<string, number> = {};
    let totalScore = 0;
    let totalEvidenceQuality = 0;
    let scoredCount = 0;
    let lowConfidenceCount = 0;

    for (const opp of allOpps) {
      countsByStage[opp.stage] = (countsByStage[opp.stage] || 0) + 1;
      if (opp.overallScore !== null) {
        totalScore += opp.overallScore;
        totalEvidenceQuality += opp.evidenceQualityScore || 0;
        scoredCount++;
        if (opp.scoringConfidence === 'low') lowConfidenceCount++;
      }
    }

    const averageOverallScore = scoredCount > 0 ? Math.round(totalScore / scoredCount) : 0;
    const averageEvidenceQuality = scoredCount > 0 ? Math.round(totalEvidenceQuality / scoredCount) : 0;

    const failedBriefs = allBriefs.filter(b => b.status === 'generation_failed').length;
    const failedAssets = allAssets.filter(a => a.status === 'validation_failed' || a.status === 'compliance_flagged').length;
    const failureRate = allBriefs.length > 0 ? ((failedBriefs / allBriefs.length) * 100).toFixed(1) : 0;

    let totalCost = 0;
    let costCount = 0;
    allBriefs.forEach(b => {
      if (b.actualGenerationCost) {
        totalCost += b.actualGenerationCost;
        costCount++;
      }
    });
    const avgGenCost = costCount > 0 ? (totalCost / costCount).toFixed(2) : 0;

    res.json({
      totalOpportunities: allOpps.length,
      countsByStage,
      averageOverallScore,
      averageEvidenceQuality,
      lowConfidenceCount,
      failureRate,
      avgGenCost,
      totalAssets: allAssets.length
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch metrics', details: error.message });
  }
});

// Helper to log brief events
async function logBriefEvent(briefId: string, opportunityId: string, eventType: string, actorId: string = 'system', metadata: any = {}) {
  await db.insert(productionBriefEvents).values({
    id: crypto.randomUUID(),
    briefId,
    opportunityId,
    eventType,
    actorId,
    metadata: JSON.stringify(metadata),
    createdAt: new Date().toISOString(),
  });
}

// 13. POST /api/revenue/opportunities/:id/create-production-brief
router.post('/opportunities/:id/create-production-brief', async (req, res) => {
  try {
    const { id } = req.params;
    const current = await db.select().from(revenueOpportunities).where(eq(revenueOpportunities.id, id)).limit(1);
    if (current.length === 0) return res.status(404).json({ error: 'Opportunity not found' });
    
    const opp = current[0];
    if (opp.stage !== 'approved') {
      return res.status(400).json({ error: 'Opportunity must be approved before creating a production brief' });
    }

    const newBriefId = crypto.randomUUID();
    const now = new Date().toISOString();

    const insertData = {
      id: newBriefId,
      opportunityId: id,
      version: 1,
      status: 'draft',
      objective: `Generate revenue content for ${opp.title}`,
      createdAt: now,
      updatedAt: now,
    };

    await db.insert(productionBriefs).values(insertData);
    await logBriefEvent(newBriefId, id, 'brief_created', 'user');

    res.status(201).json(insertData);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to create production brief', details: error.message });
  }
});

// 14. GET /api/revenue/opportunities/:id/production-briefs
router.get('/opportunities/:id/production-briefs', async (req, res) => {
  try {
    const { id } = req.params;
    const results = await db.select().from(productionBriefs)
      .where(eq(productionBriefs.opportunityId, id))
      .orderBy(desc(productionBriefs.createdAt));
      
    res.json(results);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch opportunity production briefs', details: error.message });
  }
});

// 15. GET /api/revenue/production-briefs/:id
router.get('/production-briefs/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.select().from(productionBriefs).where(eq(productionBriefs.id, id)).limit(1);
    
    if (result.length === 0) {
      return res.status(404).json({ error: 'Production brief not found' });
    }
    res.json(result[0]);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch production brief', details: error.message });
  }
});

import { generateUltronPlan } from '../services/revenue/ultron.js';

// 16. POST /api/revenue/production-briefs/:id/generate-plan
router.post('/production-briefs/:id/generate-plan', async (req, res) => {
  try {
    const { id } = req.params;
    const current = await db.select().from(productionBriefs).where(eq(productionBriefs.id, id)).limit(1);
    if (current.length === 0) return res.status(404).json({ error: 'Production brief not found' });
    
    const brief = current[0];

    const plan = await generateUltronPlan(brief);

    const updated = await db.update(productionBriefs)
      .set({
        status: 'awaiting_review',
        executionPlan: JSON.stringify(plan),
        updatedAt: new Date().toISOString()
      })
      .where(eq(productionBriefs.id, id))
      .returning();

    await logBriefEvent(id, brief.opportunityId, 'plan_generated', 'system', { planVersion: plan.planVersion });

    res.json(updated[0]);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to generate execution plan', details: error.message });
  }
});

// 17. POST /api/revenue/production-briefs/:id/approve-plan
router.post('/production-briefs/:id/approve-plan', async (req, res) => {
  try {
    const { id } = req.params;
    const current = await db.select().from(productionBriefs).where(eq(productionBriefs.id, id)).limit(1);
    if (current.length === 0) return res.status(404).json({ error: 'Production brief not found' });
    
    const brief = current[0];
    if (brief.status !== 'awaiting_review') {
      return res.status(400).json({ error: 'Plan is not awaiting review' });
    }

    const updated = await db.update(productionBriefs)
      .set({
        status: 'ready_for_generation',
        approvedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      })
      .where(eq(productionBriefs.id, id))
      .returning();

    await logBriefEvent(id, brief.opportunityId, 'plan_approved', 'user');

    res.json(updated[0]);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to approve execution plan', details: error.message });
  }
});

// 18. POST /api/revenue/production-briefs/:id/reject-plan
router.post('/production-briefs/:id/reject-plan', async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const current = await db.select().from(productionBriefs).where(eq(productionBriefs.id, id)).limit(1);
    if (current.length === 0) return res.status(404).json({ error: 'Production brief not found' });
    
    const brief = current[0];
    if (brief.status !== 'awaiting_review') {
      return res.status(400).json({ error: 'Plan is not awaiting review' });
    }

    const updated = await db.update(productionBriefs)
      .set({
        status: 'changes_requested',
        updatedAt: new Date().toISOString()
      })
      .where(eq(productionBriefs.id, id))
      .returning();

    await logBriefEvent(id, brief.opportunityId, 'plan_rejected', 'user', { reason });

    res.json(updated[0]);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to reject execution plan', details: error.message });
  }
});

import { orchestrateOmniRouteGeneration } from '../services/revenue/orchestration.js';

// 19. POST /api/revenue/production-briefs/:id/start-generation
router.post('/production-briefs/:id/start-generation', async (req, res) => {
  try {
    const { id } = req.params;
    const current = await db.select().from(productionBriefs).where(eq(productionBriefs.id, id)).limit(1);
    if (current.length === 0) return res.status(404).json({ error: 'Production brief not found' });
    
    const brief = current[0];
    if (brief.status !== 'ready_for_generation') {
      return res.status(400).json({ error: 'Plan must be ready for generation' });
    }

    await orchestrateOmniRouteGeneration(brief);

    const updated = await db.update(productionBriefs)
      .set({
        status: 'generating',
        updatedAt: new Date().toISOString()
      })
      .where(eq(productionBriefs.id, id))
      .returning();

    await logBriefEvent(id, brief.opportunityId, 'generation_started', 'system');

    res.json(updated[0]);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to start generation', details: error.message });
  }
});

// 19.5 GET /api/revenue/production-briefs/:id/tasks
router.get('/production-briefs/:id/tasks', async (req, res) => {
  try {
    const { id } = req.params;
    const results = await db.select().from(tasks).where(eq(tasks.briefId, id)).orderBy(desc(tasks.createdAt));
    res.json(results);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch tasks', details: error.message });
  }
});

// 20. GET /api/revenue/generated-assets
router.get('/generated-assets', async (req, res) => {
  try {
    const { status, briefId, opportunityId } = req.query;
    let conditions = [];
    
    if (status) conditions.push(eq(generatedAssets.status, String(status)));
    if (briefId) conditions.push(eq(generatedAssets.briefId, String(briefId)));
    if (opportunityId) conditions.push(eq(generatedAssets.opportunityId, String(opportunityId)));

    const results = await db.select().from(generatedAssets)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(generatedAssets.createdAt));
      
    res.json(results);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch generated assets', details: error.message });
  }
});

// 21. POST /api/revenue/generated-assets/:id/approve
router.post('/generated-assets/:id/approve', async (req, res) => {
  try {
    const { id } = req.params;
    const current = await db.select().from(generatedAssets).where(eq(generatedAssets.id, id)).limit(1);
    if (current.length === 0) return res.status(404).json({ error: 'Generated asset not found' });
    
    const asset = current[0];
    if (asset.status !== 'ready_for_review') {
      return res.status(400).json({ error: 'Asset is not ready for review' });
    }

    const updated = await db.update(generatedAssets)
      .set({
        status: 'approved',
        updatedAt: new Date().toISOString()
      })
      .where(eq(generatedAssets.id, id))
      .returning();

    // Push to staging destination
    const campaignId = crypto.randomUUID();
    const now = new Date().toISOString();
    
    await db.insert(campaigns).values({
      id: campaignId,
      opportunityId: asset.opportunityId,
      briefId: asset.briefId,
      name: `[Staged] ${asset.title}`,
      platform: 'staging',
      productReference: asset.fileReference || '',
      status: 'active',
      startAt: now,
      budget: 100, // Synthetic starting budget
      spend: 0,
      revenue: 0,
      commission: 0,
      roi: 0,
      notes: 'Automatically staged after Hermes approval',
      createdAt: now,
      updatedAt: now,
    });

    res.json(updated[0]);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to approve asset', details: error.message });
  }
});

// 22. POST /api/revenue/generated-assets/:id/reject
router.post('/generated-assets/:id/reject', async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const current = await db.select().from(generatedAssets).where(eq(generatedAssets.id, id)).limit(1);
    if (current.length === 0) return res.status(404).json({ error: 'Generated asset not found' });
    
    const asset = current[0];
    if (asset.status !== 'ready_for_review') {
      return res.status(400).json({ error: 'Asset is not ready for review' });
    }

    const updated = await db.update(generatedAssets)
      .set({
        status: 'rejected',
        updatedAt: new Date().toISOString()
      })
      .where(eq(generatedAssets.id, id))
      .returning();

    // Create a revision task
    if (asset.jobId && asset.briefId) {
      const taskId = crypto.randomUUID();
      const runId = crypto.randomUUID();
      const now = new Date().toISOString();

      await db.insert(tasks).values({
        id: taskId,
        title: `[Revision] ${asset.title}`,
        description: `Revision requested: ${reason}`,
        status: 'draft',
        priority: 'high',
        skillIds: JSON.stringify([]), // Would inherit from original job
        input: JSON.stringify({ previousContent: asset.content, reason }),
        assignedAgentId: asset.createdByAgentId || 'Editor',
        requiresApproval: true,
        dependencies: JSON.stringify([]),
        briefId: asset.briefId,
        metadata: JSON.stringify({
          jobId: asset.jobId,
          taskType: 'revision',
          previousVersionId: asset.id
        }),
        budgetLimit: null,
        retryPolicy: JSON.stringify({ maxAttempts: 3, backoffSeconds: 5 }),
        createdAt: now,
        updatedAt: now,
      });

      await db.insert(runs).values({
        id: runId,
        taskId: taskId,
        trigger: 'api',
        status: 'queued',
        attempt: 1,
        input: JSON.stringify({ previousContent: asset.content, reason }),
        metadata: JSON.stringify({
          briefId: asset.briefId,
          jobId: asset.jobId,
          taskType: 'revision',
          previousVersionId: asset.id
        }),
        createdAt: now,
      });
    }

    res.json(updated[0]);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to reject asset', details: error.message });
  }
});

export default router;
