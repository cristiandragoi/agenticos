/**
 * RepairKnowledgeStore.ts — Persistent Reusable Repair & Discovery Knowledge
 *
 * Implements Section 10: REPAIR MEMORY / LEARNING.
 * Successful recoveries and capability discoveries become reusable knowledge.
 * Future similar requests consult this store before starting new recovery/engineering cycles.
 */

import { db } from '../../db/index.js';
import { repairKnowledge } from './schema.js';
import { eq, desc } from 'drizzle-orm';
import { logger } from '../../utils/logger.js';
import type { LearnedResolution } from './types.js';

export class RepairKnowledgeStore {
  private static instance: RepairKnowledgeStore;
  private cache: Map<string, LearnedResolution> = new Map();
  private initialized: boolean = false;

  private constructor() {
    this.init();
  }

  public static getInstance(): RepairKnowledgeStore {
    if (!RepairKnowledgeStore.instance) {
      RepairKnowledgeStore.instance = new RepairKnowledgeStore();
    }
    return RepairKnowledgeStore.instance;
  }

  private init(): void {
    if (this.initialized) return;
    this.initialized = true;

    try {
      // Warm up cache from SQLite
      const rows = db.select().from(repairKnowledge).orderBy(desc(repairKnowledge.lastValidatedAt)).all();
      for (const r of rows) {
        const key = this.makeKey(r.target, r.goalType);
        if (!this.cache.has(key)) {
          this.cache.set(key, {
            target: r.target,
            goalType: r.goalType,
            successfulStrategy: r.successfulStrategy,
            surface: r.surface,
            executablePath: r.executablePath || undefined,
            resolvedCommand: r.resolvedCommand || undefined,
            url: r.url || undefined,
            parameters: r.requiredParams || undefined,
            verificationMethod: r.verificationMethod,
            confidence: r.confidence,
            learnedAt: r.lastValidatedAt,
          });
        }
      }
      logger.info(`[RepairKnowledgeStore] Hydrated ${this.cache.size} learned resolutions.`);
    } catch (err: any) {
      logger.warn(`[RepairKnowledgeStore] DB hydration notice: ${err?.message}`);
    }
  }

  private makeKey(target: string, goalType: string = 'general'): string {
    return `${goalType.toLowerCase().trim()}:${target.toLowerCase().trim()}`;
  }

  public lookupResolution(target: string, goalType: string = 'general'): LearnedResolution | null {
    this.init();
    const cleanTarget = target.toLowerCase().trim();

    // 1. Direct key lookup
    const directKey = this.makeKey(cleanTarget, goalType);
    if (this.cache.has(directKey)) {
      return this.cache.get(directKey)!;
    }

    // 2. Goal type must match
    for (const [key, val] of this.cache.entries()) {
      if (val.target.toLowerCase() === cleanTarget && val.goalType.toLowerCase() === goalType.toLowerCase()) {
        return val;
      }
    }

    return null;
  }

  public recordResolution(res: LearnedResolution): void {
    this.init();
    const key = this.makeKey(res.target, res.goalType);
    this.cache.set(key, res);

    try {
      const id = `rk-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      db.insert(repairKnowledge)
        .values({
          id,
          failureSignature: `auto-${res.goalType}-${res.target}`,
          goalType: res.goalType,
          target: res.target,
          environment: process.platform,
          failedStrategy: 'none_or_initial',
          successfulStrategy: res.successfulStrategy,
          resolvedTarget: res.executablePath || res.url || res.resolvedCommand || res.target,
          surface: res.surface,
          executablePath: res.executablePath || null,
          resolvedCommand: res.resolvedCommand || null,
          url: res.url || null,
          requiredParams: res.parameters || null,
          verificationMethod: res.verificationMethod,
          repairSource: 'autonomous_discovery',
          confidence: res.confidence,
          lastValidatedAt: res.learnedAt || new Date().toISOString(),
        })
        .onConflictDoNothing()
        .run();

      logger.info(`[RepairKnowledgeStore] Learned resolution recorded: ${res.goalType} -> ${res.target} (${res.surface})`);
    } catch (err: any) {
      logger.warn(`[RepairKnowledgeStore] Could not persist learned resolution: ${err?.message}`);
    }
  }

  public listAll(): LearnedResolution[] {
    this.init();
    return Array.from(this.cache.values());
  }
}

export const repairKnowledgeStore = RepairKnowledgeStore.getInstance();
