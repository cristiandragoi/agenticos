/**
 * activeInteractionContext.ts — Canonical Active Interaction Context for JARVIS.
 *
 * Requirements:
 * - Persist structured operational state across turns (not raw conversation text).
 * - Distinguish durable operational context from ephemeral UI context.
 * - Confirmed state only: updates occur only after verified post-conditions.
 * - Backed by SQLite (table `jarvis_active_interaction_context`) + memory cache.
 * - Validates browser session liveness to avoid stale browser assumptions on restart.
 */

import { rawDb } from '../../db/index.js';
import { logger } from '../../utils/logger.js';
import { browserSessionManager } from '../../services/browser/browserSession.js';
import type { ActiveBrowserEntityContext } from '../../services/browser/browserActionContract.js';

export interface CompactSearchResult {
  index: number;
  type: 'channel' | 'video' | 'website' | 'link' | 'result';
  title: string;
  href: string;
  visibleText: string;
}

export interface ReferencedEntity {
  type: 'channel' | 'video' | 'website' | 'organization' | 'person' | 'app' | 'project' | 'link' | 'result';
  name: string;
  url?: string;
  role?: string;
  timestamp: number;
}

export interface ResolvedReferent {
  type: 'website' | 'video' | 'channel' | 'link' | 'result' | 'entity';
  entity: string;
  url?: string;
  sourceTurn?: number;
  actionable: boolean;
  timestamp: number;
}

export interface ActiveInteractionContext {
  conversationId: string;
  activeCapability: 'browser' | 'desktop' | 'terminal' | 'system';
  activeBrowserSessionId: string | null;
  activePageUrl: string;
  activePageTitle: string;
  currentDomain: string;
  currentIntent: string;
  currentEntity: {
    type: 'channel' | 'video' | 'website' | 'organization' | 'person' | 'app' | 'project' | 'link' | 'result';
    name: string;
    url?: string;
    details?: Record<string, any>;
  } | null;
  activeBrowserEntity?: ActiveBrowserEntityContext | null;
  lastSearchQuery: string | null;
  lastSearchResults: CompactSearchResult[];
  lastSelectedResult: CompactSearchResult | null;
  latestResolvedReferent: ResolvedReferent | null;
  referencedEntities: ReferencedEntity[];
  navigationHistory: Array<{
    url: string;
    title: string;
    timestamp: number;
  }>;
  lastSuccessfulAction: {
    action: string;
    target?: string;
    timestamp: number;
  } | null;
  lastFailedAction: {
    action: string;
    error: string;
    timestamp: number;
  } | null;
  timestamp: number;
}

const DDL = `
CREATE TABLE IF NOT EXISTS jarvis_active_interaction_context (
  conversation_id TEXT PRIMARY KEY,
  active_capability TEXT NOT NULL DEFAULT 'browser',
  active_browser_session_id TEXT,
  active_page_url TEXT NOT NULL DEFAULT '',
  active_page_title TEXT NOT NULL DEFAULT '',
  current_domain TEXT NOT NULL DEFAULT '',
  current_intent TEXT NOT NULL DEFAULT '',
  current_entity_json TEXT,
  active_browser_entity_json TEXT,
  last_search_query TEXT,
  last_search_results_json TEXT,
  last_selected_result_json TEXT,
  latest_resolved_referent_json TEXT,
  referenced_entities_json TEXT,
  navigation_history_json TEXT,
  last_successful_action_json TEXT,
  last_failed_action_json TEXT,
  updated_at INTEGER NOT NULL
);
`;

let tableInitialized = false;
function ensureTable(): void {
  if (tableInitialized) return;
  try {
    rawDb.exec(DDL);
    try {
      rawDb.exec('ALTER TABLE jarvis_active_interaction_context ADD COLUMN latest_resolved_referent_json TEXT');
    } catch {}
    try {
      rawDb.exec('ALTER TABLE jarvis_active_interaction_context ADD COLUMN active_browser_entity_json TEXT');
    } catch {}
    tableInitialized = true;
  } catch (err: any) {
    logger.error('[ActiveInteractionContext] Table init failed:', err?.message);
  }
}
ensureTable();

export class ActiveInteractionContextStore {
  private cache = new Map<string, ActiveInteractionContext>();

  public createDefault(conversationId: string): ActiveInteractionContext {
    return {
      conversationId,
      activeCapability: 'browser',
      activeBrowserSessionId: null,
      activePageUrl: '',
      activePageTitle: '',
      currentDomain: '',
      currentIntent: '',
      currentEntity: null,
      activeBrowserEntity: null,
      lastSearchQuery: null,
      lastSearchResults: [],
      lastSelectedResult: null,
      latestResolvedReferent: null,
      referencedEntities: [],
      navigationHistory: [],
      lastSuccessfulAction: null,
      lastFailedAction: null,
      timestamp: Date.now(),
    };
  }

  public get(conversationId: string): ActiveInteractionContext {
    ensureTable();
    if (this.cache.has(conversationId)) {
      return this.cache.get(conversationId)!;
    }

    try {
      const row = rawDb.prepare(
        'SELECT * FROM jarvis_active_interaction_context WHERE conversation_id = ?'
      ).get(conversationId) as any;

      if (row) {
        const ctx: ActiveInteractionContext = {
          conversationId: row.conversation_id,
          activeCapability: row.active_capability || 'browser',
          activeBrowserSessionId: row.active_browser_session_id || null,
          activePageUrl: row.active_page_url || '',
          activePageTitle: row.active_page_title || '',
          currentDomain: row.current_domain || '',
          currentIntent: row.current_intent || '',
          currentEntity: row.current_entity_json ? JSON.parse(row.current_entity_json) : null,
          activeBrowserEntity: row.active_browser_entity_json ? JSON.parse(row.active_browser_entity_json) : null,
          lastSearchQuery: row.last_search_query || null,
          lastSearchResults: row.last_search_results_json ? JSON.parse(row.last_search_results_json) : [],
          lastSelectedResult: row.last_selected_result_json ? JSON.parse(row.last_selected_result_json) : null,
          latestResolvedReferent: row.latest_resolved_referent_json ? JSON.parse(row.latest_resolved_referent_json) : null,
          referencedEntities: row.referenced_entities_json ? JSON.parse(row.referenced_entities_json) : [],
          navigationHistory: row.navigation_history_json ? JSON.parse(row.navigation_history_json) : [],
          lastSuccessfulAction: row.last_successful_action_json ? JSON.parse(row.last_successful_action_json) : null,
          lastFailedAction: row.last_failed_action_json ? JSON.parse(row.last_failed_action_json) : null,
          timestamp: row.updated_at || Date.now(),
        };
        this.cache.set(conversationId, ctx);
        return ctx;
      }
    } catch (err: any) {
      logger.debug('[ActiveInteractionContext] DB load error:', err?.message);
    }

    const defaultCtx = this.createDefault(conversationId);
    this.cache.set(conversationId, defaultCtx);
    return defaultCtx;
  }

  public update(conversationId: string, patch: Partial<ActiveInteractionContext>): ActiveInteractionContext {
    ensureTable();
    const current = this.get(conversationId);
    const updated: ActiveInteractionContext = {
      ...current,
      ...patch,
      timestamp: Date.now(),
    };

    // If activePageUrl changed, derive domain
    if (patch.activePageUrl !== undefined) {
      try {
        const u = new URL(patch.activePageUrl);
        updated.currentDomain = u.hostname.replace(/^www\./i, '');
      } catch {
        updated.currentDomain = '';
      }
    }

    this.cache.set(conversationId, updated);

    try {
      rawDb.prepare(`
        INSERT INTO jarvis_active_interaction_context (
          conversation_id,
          active_capability,
          active_browser_session_id,
          active_page_url,
          active_page_title,
          current_domain,
          current_intent,
          current_entity_json,
          active_browser_entity_json,
          last_search_query,
          last_search_results_json,
          last_selected_result_json,
          latest_resolved_referent_json,
          referenced_entities_json,
          navigation_history_json,
          last_successful_action_json,
          last_failed_action_json,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(conversation_id) DO UPDATE SET
          active_capability = excluded.active_capability,
          active_browser_session_id = excluded.active_browser_session_id,
          active_page_url = excluded.active_page_url,
          active_page_title = excluded.active_page_title,
          current_domain = excluded.current_domain,
          current_intent = excluded.current_intent,
          current_entity_json = excluded.current_entity_json,
          active_browser_entity_json = excluded.active_browser_entity_json,
          last_search_query = excluded.last_search_query,
          last_search_results_json = excluded.last_search_results_json,
          last_selected_result_json = excluded.last_selected_result_json,
          latest_resolved_referent_json = excluded.latest_resolved_referent_json,
          referenced_entities_json = excluded.referenced_entities_json,
          navigation_history_json = excluded.navigation_history_json,
          last_successful_action_json = excluded.last_successful_action_json,
          last_failed_action_json = excluded.last_failed_action_json,
          updated_at = excluded.updated_at
      `).run(
        updated.conversationId,
        updated.activeCapability,
        updated.activeBrowserSessionId,
        updated.activePageUrl,
        updated.activePageTitle,
        updated.currentDomain,
        updated.currentIntent,
        updated.currentEntity ? JSON.stringify(updated.currentEntity) : null,
        updated.activeBrowserEntity ? JSON.stringify(updated.activeBrowserEntity) : null,
        updated.lastSearchQuery,
        JSON.stringify(updated.lastSearchResults || []),
        updated.lastSelectedResult ? JSON.stringify(updated.lastSelectedResult) : null,
        updated.latestResolvedReferent ? JSON.stringify(updated.latestResolvedReferent) : null,
        JSON.stringify(updated.referencedEntities || []),
        JSON.stringify(updated.navigationHistory || []),
        updated.lastSuccessfulAction ? JSON.stringify(updated.lastSuccessfulAction) : null,
        updated.lastFailedAction ? JSON.stringify(updated.lastFailedAction) : null,
        updated.timestamp
      );
    } catch (err: any) {
      logger.error('[ActiveInteractionContext] Persist error:', err?.message);
    }

    return updated;
  }

  public setLatestReferent(
    conversationId: string,
    referent: ResolvedReferent | null
  ): ActiveInteractionContext {
    return this.update(conversationId, {
      latestResolvedReferent: referent,
    });
  }

  public getLatestReferent(conversationId: string): ResolvedReferent | null {
    return this.get(conversationId).latestResolvedReferent || null;
  }

  /**
   * Confirmed State Only: record verified successful action.
   */
  public recordSuccess(
    conversationId: string,
    action: string,
    target?: string,
    extraPatch: Partial<ActiveInteractionContext> = {}
  ): ActiveInteractionContext {
    const current = this.get(conversationId);
    return this.update(conversationId, {
      ...extraPatch,
      lastSuccessfulAction: {
        action,
        target,
        timestamp: Date.now(),
      },
      lastFailedAction: null,
    });
  }

  /**
   * Confirmed State Only: record action failure without poisoning currentEntity or pageUrl.
   */
  public recordFailure(
    conversationId: string,
    action: string,
    error: string
  ): ActiveInteractionContext {
    return this.update(conversationId, {
      lastFailedAction: {
        action,
        error,
        timestamp: Date.now(),
      },
    });
  }

  /**
   * Push page navigation into history.
   */
  public pushNavigation(conversationId: string, url: string, title: string): ActiveInteractionContext {
    const current = this.get(conversationId);
    const history = [...current.navigationHistory];
    // Avoid immediate duplicates
    if (history.length === 0 || history[history.length - 1].url !== url) {
      history.push({ url, title, timestamp: Date.now() });
      if (history.length > 30) history.shift();
    }
    return this.update(conversationId, {
      activePageUrl: url,
      activePageTitle: title,
      navigationHistory: history,
    });
  }

  /**
   * Update search results memory.
   */
  public setSearchResults(
    conversationId: string,
    query: string,
    results: CompactSearchResult[]
  ): ActiveInteractionContext {
    return this.update(conversationId, {
      lastSearchQuery: query,
      lastSearchResults: results.slice(0, 15),
      lastSelectedResult: null,
    });
  }

  /**
   * Select a result from memory.
   */
  public selectResult(
    conversationId: string,
    item: CompactSearchResult | number
  ): ActiveInteractionContext {
    const current = this.get(conversationId);
    let selected: CompactSearchResult | null = null;
    if (typeof item === 'number') {
      selected = current.lastSearchResults[item] || null;
    } else {
      selected = item;
    }

    const referenced = [...current.referencedEntities];
    if (selected) {
      referenced.push({
        type: selected.type,
        name: selected.title,
        url: selected.href,
        role: 'selected_result',
        timestamp: Date.now(),
      });
      if (referenced.length > 20) referenced.shift();
    }

    return this.update(conversationId, {
      lastSelectedResult: selected,
      referencedEntities: referenced,
      currentEntity: selected ? {
        type: selected.type,
        name: selected.title,
        url: selected.href,
      } : current.currentEntity,
    });
  }

  /**
   * Validate that the active browser session actually exists on the system.
   * If not (e.g. backend restarted or browser closed), clear ephemeral session id.
   */
  public validateSessionLiveness(conversationId: string): boolean {
    const ctx = this.get(conversationId);
    if (!ctx.activeBrowserSessionId) return false;
    const session = browserSessionManager.getSession();
    if (!session || session.sessionId !== ctx.activeBrowserSessionId) {
      this.update(conversationId, { activeBrowserSessionId: null });
      return false;
    }
    return true;
  }
}

export const activeInteractionContextStore = new ActiveInteractionContextStore();
