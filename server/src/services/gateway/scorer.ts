import { ModelGateway, ChatRequest } from './types.js';
import { GatewayRunLedger } from './ledger.js';

export class ProviderScorer {
  private ledger: GatewayRunLedger;

  constructor(ledger: GatewayRunLedger) {
    this.ledger = ledger;
  }

  /**
   * Sorts the available providers dynamically based on task requirements, capabilities, and health.
   */
  public rankProviders(
    availableProviders: ModelGateway[],
    req: ChatRequest,
    defaultOrder: string[]
  ): ModelGateway[] {
    
    // 1. Preferred Provider Override
    if (req.preferredProvider) {
      const preferred = availableProviders.find(p => p.name === req.preferredProvider);
      if (preferred) return [preferred];
    }

    // 2. Score each provider
    const scored = availableProviders.map(provider => {
      let score = 0;
      
      // Base score from default configuration priority (lower index = higher score)
      const defaultIndex = defaultOrder.indexOf(provider.name);
      if (defaultIndex !== -1) {
        score += (defaultOrder.length - defaultIndex) * 10;
      }

      // Capability Check
      if (req.requiredCapabilities) {
        let hasAll = true;
        for (const cap of req.requiredCapabilities) {
          if (typeof (provider as any)[cap] !== 'function' || !(provider as any)[cap]()) {
            hasAll = false;
          }
        }
        if (!hasAll) return null; // Exclude entirely
        else score += 50; // Bonus for having required capabilities
      }

      // Tag-based routing
      if (req.taskProfile) {
        const tags = provider.definition.tags || [];
        
        if (req.taskProfile === 'tiny_summary' || req.taskProfile === 'simple_formatting') {
           if (tags.includes('local') || tags.includes('cheap')) score += 100; 
        }
        else if (req.taskProfile === 'repo_analysis' || req.taskProfile === 'heavy_reasoning' || req.taskProfile === 'heavy_refactor') {
           if (tags.includes('cloud') || tags.includes('coding') || tags.includes('reasoning')) score += 100;
           if (tags.includes('local')) score -= 50;
        }
        else if (req.taskProfile === 'vision_task') {
           if ((provider.supportsVision && provider.supportsVision()) || tags.includes('vision')) score += 200;
           else score -= 1000;
        }
        else if (req.taskProfile === 'massive_context') {
           if ((provider.maxContext && provider.maxContext() > 100000) || tags.includes('long-context')) score += 100;
        }
      }

      // Telemetry & Health Scoring
      const metrics = this.ledger.getMetrics(provider.name);
      const validCalls = metrics.totalSuccesses + metrics.totalFailures;
      if (validCalls > 0) {
        const successRate = metrics.totalSuccesses / validCalls;
        // Map 0% success to -20, 100% success to +20
        score += ((successRate - 0.5) * 40);
        
        if (metrics.totalTimeouts > 5) score -= 10;
      }

      return { provider, score };
    });

    // 3. Filter out nulls and Sort by score descending
    const validScored = scored.filter(s => s !== null) as { provider: ModelGateway, score: number }[];
    validScored.sort((a, b) => b.score - a.score);

    // Return just the providers in ranked order
    return validScored.map(s => s.provider);
  }
}
