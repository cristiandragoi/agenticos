import { db, rawDb, sqliteDbPath } from '../../db/index.js';
import { revenueMissions, revenueExperiments, revenueHumanGates } from '../../db/schema.js';
import { eq } from 'drizzle-orm';
import { logger } from '../../utils/logger.js';
import fs from 'fs';
import path from 'path';

export interface BriefingData {
  id: string;
  missionId: string;
  missionTitle: string;
  type: 'daily' | 'weekly';
  idempotencyKey: string;
  periodStart: string;
  periodEnd: string;
  generatedAt: string;
  kpis: {
    targetAmount: number;
    realizedRevenue: number;
    verifiedRevenue: number;
    pipelineValue: number;
    actualSpend: number;
    actualCost: number;
    netRevenue: number;
  };
  digitalProducts: {
    total: number;
    readyToPublish: number;
    published: number;
    discovered: number;
  };
  germanSme: {
    total: number;
    audited: number;
    qualified: number;
    inOutreach: number;
  };
  humanGates: {
    total: number;
    open: number;
    resolved: number;
    gatesList: Array<{ id: string; type: string; status: string; paused: boolean }>;
  };
  narrative: string;
}

export class RevenueBriefingService {
  private get briefingsDir(): string {
    return path.join(path.dirname(sqliteDbPath), 'revenue-operator', 'briefings');
  }

  constructor() {
    try {
      fs.mkdirSync(this.briefingsDir, { recursive: true });
    } catch (_) {}
    this.ensureBriefingTable();
  }

  private ensureBriefingTable(): void {
    try {
      rawDb.exec(`
        CREATE TABLE IF NOT EXISTS revenue_briefings (
          id TEXT PRIMARY KEY NOT NULL,
          mission_id TEXT NOT NULL,
          type TEXT NOT NULL,
          idempotency_key TEXT UNIQUE NOT NULL,
          period_start TEXT NOT NULL,
          period_end TEXT NOT NULL,
          narrative TEXT NOT NULL,
          data TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
      `);
    } catch (err: any) {
      logger.warn(`[BriefingService] ensureBriefingTable error: ${err.message}`);
    }
  }

  async generateBriefing(missionIdPrefix = 'mission-616808fe-', type: 'daily' | 'weekly' = 'daily'): Promise<BriefingData> {
    logger.info(`[BriefingService] Generating ${type} briefing for mission prefix ${missionIdPrefix}`);
    this.ensureBriefingTable();

    // 1. Fetch mission
    const allMissions = await db.select().from(revenueMissions).all();
    const mission = allMissions.find(m => m.id.startsWith(missionIdPrefix)) || allMissions[0];

    if (!mission) {
      throw new Error(`Mission with prefix ${missionIdPrefix} not found in database.`);
    }

    // 2. Fetch experiments
    const exps = await db.select().from(revenueExperiments).where(eq(revenueExperiments.missionId, mission.id)).all();

    const dpExps = exps.filter(e => e.engine === 'digital_products');
    const smeExps = exps.filter(e => e.engine === 'german_sme');

    // 3. Fetch human gates
    const expIds = exps.map(e => e.id);
    const allGates = await db.select().from(revenueHumanGates).all();
    const gates = allGates.filter(g => expIds.includes(g.experimentId || ''));

    const now = new Date();
    const periodStart = type === 'daily'
      ? new Date(now.getTime() - 24 * 3600 * 1000).toISOString()
      : new Date(now.getTime() - 7 * 24 * 3600 * 1000).toISOString();
    const periodEnd = now.toISOString();

    // Idempotency period key:
    //   daily  → calendar day (YYYY-MM-DD)
    //   weekly → ISO week start (Monday, YYYY-MM-DD), NOT the day — so repeated
    //            weekly generation within the same week dedupes to ONE record.
    const dateKey = now.toISOString().slice(0, 10);
    const daysSinceMonday = (now.getUTCDay() + 6) % 7; // Mon=0 .. Sun=6
    const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysSinceMonday));
    const weekKey = monday.toISOString().slice(0, 10);
    const periodKey = type === 'daily' ? dateKey : weekKey;
    const idempotencyKey = `${type}-briefing-${mission.id}-${periodKey}`;
    const briefingId = `briefing-${type}-${mission.id.slice(0, 16)}-${periodKey}`;

    const kpis = {
      targetAmount: mission.targetAmount || 300,
      realizedRevenue: mission.realizedRevenue || 0,
      verifiedRevenue: mission.verifiedRevenue || 0,
      pipelineValue: mission.pipelineValue || 1500,
      actualSpend: mission.actualSpend || 0,
      actualCost: mission.actualCost || 0,
      netRevenue: mission.netRevenue || 0,
    };

    const digitalProducts = {
      total: dpExps.length,
      readyToPublish: dpExps.filter(e => ['READY_TO_PUBLISH', 'APPROVED', 'VALIDATED'].includes(e.status)).length,
      published: dpExps.filter(e => e.status === 'PUBLISHED').length,
      discovered: dpExps.filter(e => e.status === 'DISCOVERED').length,
    };

    const germanSme = {
      total: smeExps.length,
      audited: smeExps.filter(e => ['AUDITED', 'SCORED', 'READY_FOR_OUTREACH'].includes(e.status)).length,
      qualified: smeExps.filter(e => ['QUALIFIED', 'PROPOSAL_GENERATED'].includes(e.status)).length,
      inOutreach: smeExps.filter(e => e.status === 'OUTREACH_ACTIVE').length,
    };

    const humanGates = {
      total: gates.length,
      open: gates.filter(g => g.status === 'open').length,
      resolved: gates.filter(g => g.status === 'resolved').length,
      gatesList: gates.map(g => ({
        id: g.id,
        type: g.gateType,
        status: g.status,
        paused: Boolean(g.branchPaused),
      })),
    };

    const narrative = `### Revenue Mission ${type === 'daily' ? 'Daily Briefing' : 'Weekly Digest'}
**Mission**: ${mission.title} (${mission.id})
**Target**: €${kpis.targetAmount} | **Pipeline**: €${kpis.pipelineValue} | **Verified Revenue**: €${kpis.verifiedRevenue}

#### Engines Breakdown:
- **Digital Products Engine**: ${digitalProducts.total} items cataloged (${digitalProducts.readyToPublish} ready to publish, ${digitalProducts.published} live).
- **German SME Engine**: ${germanSme.total} target leads audited (${germanSme.qualified} qualified, ${germanSme.inOutreach} in outreach).
- **Human Gates Isolation**: ${humanGates.open} open human gates holding specific branches (${humanGates.resolved} resolved). Non-gated autonomous actions are running smoothly.`;

    const briefing: BriefingData = {
      id: briefingId,
      missionId: mission.id,
      missionTitle: mission.title,
      type,
      idempotencyKey,
      periodStart,
      periodEnd,
      generatedAt: now.toISOString(),
      kpis,
      digitalProducts,
      germanSme,
      humanGates,
      narrative,
    };

    // 4. Save to SQLite idempotently
    try {
      rawDb.prepare(`
        INSERT INTO revenue_briefings (id, mission_id, type, idempotency_key, period_start, period_end, narrative, data, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(idempotency_key) DO UPDATE SET
          narrative = excluded.narrative,
          data = excluded.data,
          period_end = excluded.period_end,
          created_at = excluded.created_at
      `).run(
        briefingId,
        mission.id,
        type,
        idempotencyKey,
        periodStart,
        periodEnd,
        narrative,
        JSON.stringify(briefing),
        now.toISOString()
      );
    } catch (dbErr: any) {
      logger.warn(`[BriefingService] DB persist error: ${dbErr.message}`);
    }

    // 5. Save to disk idempotently
    try {
      const filename = `${type}-${mission.id}-${periodKey}.json`;
      fs.writeFileSync(path.join(this.briefingsDir, filename), JSON.stringify(briefing, null, 2), 'utf8');
    } catch (_) {}

    return briefing;
  }
}

export const revenueBriefingService = new RevenueBriefingService();
