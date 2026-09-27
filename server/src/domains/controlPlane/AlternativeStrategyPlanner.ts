/**
 * AlternativeStrategyPlanner.ts — General Alternative Strategy Planner
 *
 * Implements Section 9:
 * When one execution strategy fails, searches across viable alternative execution
 * surfaces before escalating to engineering source repairs.
 */

import { logger } from '../../utils/logger.js';
import { capabilityDiscovery } from './CapabilityDiscovery.js';
import type { DiscoveredCapability } from './types.js';

export interface ProposedStrategy {
  strategyName: string;
  surface: string;
  target: string;
  parameters?: Record<string, any>;
  confidence: number;
  reason: string;
}

export class AlternativeStrategyPlanner {
  private static instance: AlternativeStrategyPlanner;

  private constructor() {}

  public static getInstance(): AlternativeStrategyPlanner {
    if (!AlternativeStrategyPlanner.instance) {
      AlternativeStrategyPlanner.instance = new AlternativeStrategyPlanner();
    }
    return AlternativeStrategyPlanner.instance;
  }

  /**
   * Propose viable alternative strategies given a failed strategy and target.
   */
  public async planAlternatives(opts: {
    target: string;
    goalType: string;
    failedSurfaces: string[];
    availableCapabilities?: DiscoveredCapability[];
  }): Promise<ProposedStrategy[]> {
    const { target, goalType, failedSurfaces } = opts;
    const allDiscovered = opts.availableCapabilities || await capabilityDiscovery.discover(target, goalType);

    // Filter out surfaces that already failed
    const viable = allDiscovered.filter(c => !failedSurfaces.includes(c.surface));
    const proposals: ProposedStrategy[] = [];

    for (const cap of viable) {
      proposals.push({
        strategyName: `strategy-${cap.surface}`,
        surface: cap.surface,
        target: cap.target,
        parameters: cap.parameters,
        confidence: cap.score,
        reason: `Alternative surface: ${cap.description}`,
      });
    }

    // Generic fallbacks if no specific discovered capability (only for open/search/read, never for mutations)
    const isMutation = /^(?:rename|set_|change_|update|create|delete|modify)/i.test(goalType);
    if (!isMutation) {
      if (!failedSurfaces.includes('shell') && process.platform === 'win32') {
        proposals.push({
          strategyName: 'strategy-shell-start',
          surface: 'shell',
          target: `start "" "${target}"`,
          confidence: 0.50,
          reason: 'Windows shell start fallback',
        });
      }

      if (!failedSurfaces.includes('browser') && !target.startsWith('http')) {
        proposals.push({
          strategyName: 'strategy-browser-search',
          surface: 'browser',
          target: `https://www.google.com/search?q=${encodeURIComponent(target)}`,
          confidence: 0.40,
          reason: 'Web search fallback for unresolved target',
        });
      }
    }

    // Sort by confidence descending
    proposals.sort((a, b) => b.confidence - a.confidence);
    logger.info(`[AlternativeStrategyPlanner] Proposed ${proposals.length} alternatives for "${target}" (failed: ${failedSurfaces.join(', ')})`);

    return proposals;
  }
}

export const alternativeStrategyPlanner = AlternativeStrategyPlanner.getInstance();
