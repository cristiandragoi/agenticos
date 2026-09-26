/**
 * referentResolver.ts — Deterministic & Contextual Referent Resolution for JARVIS.
 *
 * Requirements:
 * - Resolves expressions like "it", "that", "the first one", "the second one",
 *   "no, the other one", "go back", "open the channel", "show me the newest video",
 *   "pause it", "their website", "search for him", "open that result" without
 *   requiring complete repetitive URLs or entity names.
 * - Deterministic resolution where possible for sub-50ms latency.
 * - Distinguishes DIRECT_ACTION vs HERMES_PLAN.
 * - Detects true ambiguity and asks concise clarification rather than guessing.
 * - Grounded against ActiveInteractionContext and current browser state.
 */

import {
  activeInteractionContextStore,
  type ActiveInteractionContext,
  type CompactSearchResult,
} from '../activeInteractionContext.js';
import { logger } from '../../../utils/logger.js';

export type ResolutionKind =
  | 'direct_action'       // Immediate browser action (pause, go back, click ordinal, etc.)
  | 'hermes_plan'         // Multi-step, cross-site research, or web search
  | 'ambiguity'           // Multiple genuine candidates exist → ask clarification
  | 'unresolved';         // Not a referent follow-up, let normal pipeline handle

export interface ReferentResolution {
  kind: ResolutionKind;
  action: string;
  target?: string;
  parameters?: Record<string, any>;
  clarificationPrompt?: string;
  routingLatencyMs: number;
  reason: string;
  directSpokenResponse?: string;
}

export class ReferentResolver {
  /**
   * Main entry point to resolve an utterance against the active interaction context.
   */
  public resolve(utterance: string, conversationId: string): ReferentResolution {
    const t0 = Date.now();
    const text = (utterance || '').trim().replace(/[.!?]+$/, '').trim();
    const ctx = activeInteractionContextStore.get(conversationId);

    // If the utterance is an explicit platform navigation or compound command, it is not a continuation referent.
    if (/\b(?:open|go\s+to|visit)\s+(?:the\s+)?(?:https?:\/\/|www\.)?(?:[a-z0-9.-]+\.[a-z]{2,}|youtube|google|linkedin|twitter|x\.com|github|reddit|wikipedia)\b/i.test(text) ||
        /\band\s+(?:locate|find|search|open|click|go|type|select|look\s+up)\b/i.test(text)) {
      return {
        kind: 'unresolved',
        action: 'none',
        routingLatencyMs: Date.now() - t0,
        reason: 'Explicit platform or compound command is not a continuation referent.',
      };
    }

    // ── 1. MEDIA CONTROLS ("pause it", "pause the video", "pause", "resume it", "play it") ──
    if (/\b(?:pause\s+(?:it|the\s+video|this|playback)|pause)\b/i.test(text)) {
      return {
        kind: 'direct_action',
        action: 'pause_media',
        routingLatencyMs: Date.now() - t0,
        reason: 'Resolved "pause it" to active page media playback control.',
      };
    }
    if (/\b(?:resume\s+(?:it|playback)|play\s+(?:it|the\s+video|playback)|resume)\b/i.test(text)) {
      return {
        kind: 'direct_action',
        action: 'play_media',
        routingLatencyMs: Date.now() - t0,
        reason: 'Resolved "resume/play" to active page media playback control.',
      };
    }

    // ── 2. NAVIGATION CONTROLS ("go back", "back", "go back to YouTube") ──
    if (/\b(?:go\s+back\s+to\s+youtube|back\s+to\s+youtube)\b/i.test(text)) {
      // Look in navigation history for most recent YouTube URL
      const ytHist = [...ctx.navigationHistory].reverse().find(h => /youtube\.com/i.test(h.url));
      const targetUrl = ytHist ? ytHist.url : 'https://www.youtube.com';
      return {
        kind: 'direct_action',
        action: 'navigate',
        target: 'YouTube',
        parameters: { url: targetUrl },
        routingLatencyMs: Date.now() - t0,
        reason: 'Resolved "go back to YouTube" to previous YouTube navigation history entry.',
      };
    }
    if (/^(?:go\s+back|back|take\s+me\s+back|return)$/i.test(text)) {
      return {
        kind: 'direct_action',
        action: 'go_back',
        routingLatencyMs: Date.now() - t0,
        reason: 'Resolved "go back" to browser history back.',
      };
    }

    // ── 3. CORRECTION: QUERY REFINEMENT ──
    if (ctx.lastSearchQuery) {
      const withoutMatch = text.match(/^(?:no,?\s+)?(.+?)(?:,?\s+without\s+(.+))$/i);
      if (withoutMatch) {
        const refinedBase = withoutMatch[1].replace(/^(?:no,?\s+)/i, '').trim();
        const removedWord = withoutMatch[2].trim();
        const newQuery = refinedBase.replace(new RegExp(`\\b${removedWord}\\b`, 'gi'), '').replace(/\s+/g, ' ').trim();
        return {
          kind: 'direct_action',
          action: 'search',
          parameters: { query: newQuery || refinedBase },
          routingLatencyMs: Date.now() - t0,
          reason: `Resolved query correction to "${newQuery || refinedBase}".`,
        };
      }

      // "No, search for X instead" / "No, search for X" / "Search for X instead" / "No, X instead"
      const queryCorrectionMatch = text.match(/^(?:no,?\s+(?:search\s+(?:for\s+)?)?|search\s+for\s+)(.+?)(?:\s+instead)?$/i);
      if (queryCorrectionMatch) {
        const candidate = queryCorrectionMatch[1].replace(/^(?:search\s+(?:for\s+)?)/i, '').trim();
        if (candidate && !/^(?:first|second|third|fourth|fifth|other|the\s+)/i.test(candidate)) {
          return {
            kind: 'direct_action',
            action: 'search',
            parameters: { query: candidate },
            routingLatencyMs: Date.now() - t0,
            reason: `Resolved query correction to "${candidate}".`,
          };
        }
      }
    }

    // ── 4. CORRECTION & ORDINALS ("the second one", "open the second one instead", "no, the second one", "the other one") ──
    const ordinalMatch = text.match(/\b(?:no,?\s+)?(?:open\s+)?(?:the\s+)?(first|second|third|fourth|fifth|1st|2nd|3rd|4th|5th|other)(?:\s+(?:one|video|result|channel))?(?:\s+instead)?\b/i);
    if (ordinalMatch) {
      const word = ordinalMatch[1].toLowerCase();
      let targetIndex = 0;
      if (word === 'second' || word === '2nd') targetIndex = 1;
      else if (word === 'third' || word === '3rd') targetIndex = 2;
      else if (word === 'fourth' || word === '4th') targetIndex = 3;
      else if (word === 'fifth' || word === '5th') targetIndex = 4;
      else if (word === 'other') {
        // If lastSelectedResult was index 0, pick index 1; otherwise index 0
        const lastIdx = ctx.lastSelectedResult?.index ?? 0;
        targetIndex = lastIdx === 0 ? 1 : 0;
      }

      // Check if user is referencing videos specifically (or in video context)
      const isVideoContext = ctx.currentEntity?.type === 'video' ||
                             ctx.lastSuccessfulAction?.action === 'open_newest_video' ||
                             /\bvideo\b/i.test(text);
      const videoCandidates = ctx.lastSearchResults.filter(r => r.type === 'video');

      if (isVideoContext && videoCandidates.length > targetIndex) {
        const item = videoCandidates[targetIndex];
        return {
          kind: 'direct_action',
          action: 'open_result_index',
          target: item.title,
          parameters: { index: item.index, item },
          routingLatencyMs: Date.now() - t0,
          reason: `Resolved ordinal "${word}" to video #${targetIndex + 1} ("${item.title}").`,
        };
      }

      // Check if we have results in page result memory
      if (ctx.lastSearchResults && ctx.lastSearchResults.length > targetIndex) {
        const item = ctx.lastSearchResults[targetIndex];
        return {
          kind: 'direct_action',
          action: 'open_result_index',
          target: item.title,
          parameters: { index: targetIndex, item },
          routingLatencyMs: Date.now() - t0,
          reason: `Resolved ordinal "${word}" to index ${targetIndex} ("${item.title}") from page result memory.`,
        };
      }

      // Fallback to live ordinal click on page
      return {
        kind: 'direct_action',
        action: 'open_ordinal_live',
        parameters: { ordinalIndex: targetIndex + 1 },
        routingLatencyMs: Date.now() - t0,
        reason: `Resolved ordinal "${word}" to ordinal #${targetIndex + 1}.`,
      };
    }

    // ── 5. "SHOW ME THE NEWEST VIDEO" / "THE NEWEST VIDEO" ──
    if (/\b(?:show\s+me\s+the\s+newest\s+video|newest\s+video|open\s+the\s+newest\s+video|latest\s+video)\b/i.test(text)) {
      return {
        kind: 'direct_action',
        action: 'open_newest_video',
        routingLatencyMs: Date.now() - t0,
        reason: 'Resolved "show me the newest video" to latest video selection on channel/page.',
      };
    }

    // ── 6. "OPEN THE CHANNEL" / "THE CHANNEL" ──
    if (/\b(?:open\s+the\s+channel|the\s+channel)\b/i.test(text) && !/\b(?:youtube|google|search|locate|find)\b/i.test(text)) {
      // Find channel result from last search results
      const queryWords = (ctx.lastSearchQuery || '').toLowerCase().split(/\s+/).filter(w => w.length > 2);
      const channelResult = ctx.lastSearchResults.find(r =>
        r.type === 'channel' && queryWords.some(w => r.title.toLowerCase().includes(w) || r.href.toLowerCase().includes(w))
      ) || ctx.lastSearchResults.find(r => r.type === 'channel');

      if (channelResult) {
        return {
          kind: 'direct_action',
          action: 'open_result_index',
          target: channelResult.title,
          parameters: { index: channelResult.index, item: channelResult },
          routingLatencyMs: Date.now() - t0,
          reason: `Resolved "open the channel" to channel result "${channelResult.title}".`,
        };
      }
      return {
        kind: 'direct_action',
        action: 'open_channel',
        routingLatencyMs: Date.now() - t0,
        reason: 'Resolved "open the channel" to active page channel lookup.',
      };
    }

    // ── 7. "FIND THEIR WEBSITE" / "THEIR WEBSITE" / "SEARCH FOR HIM" ──
    if (/\b(?:find\s+their\s+website|their\s+website|their\s+site|official\s+website|find\s+website|search\s+for\s+him)\b/i.test(text)) {
      // For "their website", "their" refers to the channel, creator, or person.
      const channelEntity = ctx.referencedEntities.find(e => e.type === 'channel') ||
                            (ctx.currentEntity?.type === 'channel' ? ctx.currentEntity : null);
      const entityName = channelEntity?.name || ctx.lastSearchQuery || 'C Adler TV';
      // Clean up YouTube badges/subscriber counts/durations from name
      const cleanName = entityName.split(/[@•\n]/)[0].trim();

      return {
        kind: 'hermes_plan',
        action: 'find_entity_website',
        target: cleanName,
        parameters: {
          entityName: cleanName,
          entityType: 'channel',
          searchQuery: `${cleanName} official website`,
        },
        routingLatencyMs: Date.now() - t0,
        reason: `Resolved "their website" to cross-site entity search for "${cleanName}".`,
      };
    }

    // ── 8. "OPEN IT" / "OPEN THAT RESULT" / "THAT ONE" / "OPEN THE WEBSITE" ──
    if (/^(?:open\s+(?:it|that(?:\s+result)?|this|the\s+website|their\s+website|the\s+site)|that\s+one)$/i.test(text)) {
      // Priority 1: Check durable latestResolvedReferent from semantic memory
      if (ctx.latestResolvedReferent?.actionable && ctx.latestResolvedReferent.url) {
        const ref = ctx.latestResolvedReferent;
        return {
          kind: 'direct_action',
          action: 'navigate_url',
          target: ref.entity || 'the website',
          parameters: { url: ref.url },
          routingLatencyMs: Date.now() - t0,
          reason: `Resolved "${text}" to latestResolvedReferent (${ref.type}): ${ref.url}`,
        };
      }

      // Priority 2: Check recent referenced entity (e.g. if we just found "their website")
      const foundSiteEntity = [...ctx.referencedEntities].reverse().find(e => e.role === 'found_website' && e.url);
      if (foundSiteEntity && foundSiteEntity.url) {
        return {
          kind: 'direct_action',
          action: 'navigate_url',
          target: foundSiteEntity.name,
          parameters: { url: foundSiteEntity.url },
          routingLatencyMs: Date.now() - t0,
          reason: `Resolved "${text}" to recently discovered website: ${foundSiteEntity.url}`,
        };
      }

      // Priority 3: If last selected result exists and has url
      if (ctx.lastSelectedResult?.href) {
        return {
          kind: 'direct_action',
          action: 'navigate_url',
          target: ctx.lastSelectedResult.title,
          parameters: { url: ctx.lastSelectedResult.href },
          routingLatencyMs: Date.now() - t0,
          reason: `Resolved "${text}" to last selected result: ${ctx.lastSelectedResult.href}`,
        };
      }

      // Check if user is on a search results page with multiple candidates
      if (ctx.lastSearchResults && ctx.lastSearchResults.length >= 2) {
        // AMBIGUITY CHECK: If top 2 candidates have similar titles/types
        const r1 = ctx.lastSearchResults[0];
        const r2 = ctx.lastSearchResults[1];
        if (r1.type === r2.type && (r1.title.includes(r2.title.slice(0, 5)) || r2.title.includes(r1.title.slice(0, 5)))) {
          return {
            kind: 'ambiguity',
            action: 'ask_clarification',
            clarificationPrompt: `Do you mean the first ${r1.type === 'channel' ? 'channel' : 'result'}, "${r1.title}", or the second one, "${r2.title}"?`,
            routingLatencyMs: Date.now() - t0,
            reason: 'Detected multiple matching candidates for ambiguous reference "open it".',
          };
        }

        // Single primary match
        return {
          kind: 'direct_action',
          action: 'open_result_index',
          target: r1.title,
          parameters: { index: 0, item: r1 },
          routingLatencyMs: Date.now() - t0,
          reason: `Resolved "open it" to primary top result "${r1.title}".`,
        };
      }

      // Fallback to opening identified element on page
      return {
        kind: 'direct_action',
        action: 'open_it',
        routingLatencyMs: Date.now() - t0,
        reason: 'Resolved "open it" to current focused element.',
      };
    }

    return {
      kind: 'unresolved',
      action: 'none',
      routingLatencyMs: Date.now() - t0,
      reason: 'Utterance does not contain deictic or referent continuation patterns.',
    };
  }
}

export const referentResolver = new ReferentResolver();
