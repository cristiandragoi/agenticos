import { desktopExecutor } from './executors/desktopExecutor.js';
import { browserExecutor } from './executors/browserExecutor.js';
import { browserStateStore, parseOrdinalIndex } from '../../../services/browser/browserActionContract.js';
import { getWorkspaceRoot } from '../../../services/workspaceStore.js';
import { normalizeProjectEntityName } from '../projectNameMatch.js';
import { logger } from '../../../utils/logger.js';
import type { ActionPlan, ActionPlanStep, CandidateScore, CapabilityRisk, TurnContext } from './types.js';

export class SemanticGoalParser {
  /**
   * Parse a goal into a concrete ActionPlan using closed candidate scoring.
   * If confidence is below threshold (0.80), marks plan as requiring clarification
   * instead of falling through to terminal execution.
   */
  public parseGoal(goalInput: string, context?: TurnContext): ActionPlan {
    const effectiveContext: TurnContext = context || { conversationId: '' };
    const raw = (goalInput || '').trim();
    const clean = raw.replace(/^[.,:;\-\s]+/, '').replace(/[.!?]+$/, '').trim();
    const goalId = `goal-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

    if (!clean) {
      return {
        goalId,
        goalDescription: '',
        steps: [],
        estimatedRisk: 'read',
        requiresApproval: false,
        confidence: 0,
        clarificationRequired: true,
      };
    }

    // ── Check Multi-Step Conjunctions ("and", "then", "followed by") ─────
    const parts = this.splitCompoundGoal(clean);

    // If single-part goal, evaluate closed candidate scores
    if (parts.length <= 1) {
      const candidates = this.scoreCandidates(clean, effectiveContext, goalId, 1);
      // Sort descending by confidence
      candidates.sort((a, b) => b.confidence - a.confidence);
      const winner = candidates[0];

      if (!winner || winner.confidence < 0.80 || !winner.matched || !winner.plan) {
        logger.warn('[SemanticGoalParser] No executor met confidence threshold (0.80):', {
          clean,
          topConfidence: winner?.confidence ?? 0,
          topExecutor: winner?.executorId,
          candidates: candidates.map((c) => ({ id: c.executorId, conf: c.confidence })),
        });

        return {
          goalId,
          goalDescription: clean,
          steps: [],
          estimatedRisk: 'read',
          requiresApproval: false,
          confidence: winner ? winner.confidence : 0,
          primaryExecutor: winner?.executorId,
          candidates,
          clarificationRequired: true,
        };
      }

      return {
        ...winner.plan,
        primaryExecutor: winner.executorId,
        candidates,
        confidence: winner.confidence,
        clarificationRequired: false,
      };
    }

    // Multi-part compound goal: score each part
    const combinedSteps: ActionPlanStep[] = [];
    let minConfidence = 1.0;
    let combinedRisk: CapabilityRisk = 'read';
    const allCandidates: CandidateScore[] = [];

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const partCandidates = this.scoreCandidates(part, effectiveContext, goalId, i + 1, combinedSteps[i - 1]);
      partCandidates.sort((a, b) => b.confidence - a.confidence);
      const partWinner = partCandidates[0];

      if (!partWinner || partWinner.confidence < 0.70 || !partWinner.matched || !partWinner.plan) {
        logger.warn(`[SemanticGoalParser] Multi-step part "${part}" failed confidence:`, partWinner);
        return {
          goalId,
          goalDescription: clean,
          steps: [],
          estimatedRisk: 'read',
          requiresApproval: false,
          confidence: partWinner ? partWinner.confidence : 0,
          clarificationRequired: true,
          candidates: partCandidates,
        };
      }

      minConfidence = Math.min(minConfidence, partWinner.confidence);
      if (partWinner.plan.estimatedRisk === 'destructive') combinedRisk = 'destructive';
      else if (partWinner.plan.estimatedRisk === 'external_write' && combinedRisk !== 'destructive') combinedRisk = 'external_write';
      else if (partWinner.plan.estimatedRisk === 'local_write' && combinedRisk === 'read') combinedRisk = 'local_write';

      combinedSteps.push(...partWinner.plan.steps);
      allCandidates.push(partWinner);
    }

    return {
      goalId,
      goalDescription: clean,
      steps: combinedSteps,
      estimatedRisk: combinedRisk,
      requiresApproval: combinedRisk === 'destructive' || combinedRisk === 'external_write',
      confidence: minConfidence,
      primaryExecutor: combinedSteps[0]?.executorId,
      candidates: allCandidates,
      clarificationRequired: false,
    };
  }

  /**
   * Closed candidate scoring for a single command part.
   * Evaluates all executors independently and assigns explicit confidence.
   */
  public scoreCandidates(
    part: string,
    context?: TurnContext,
    goalId: string = 'goal-default',
    stepIndex: number = 1,
    priorStep?: ActionPlanStep,
  ): CandidateScore[] {
    const effectiveContext: TurnContext = context || { conversationId: '' };
    const lower = part.toLowerCase().trim();
    const stepId = `${goalId}-s${stepIndex}`;
    const candidates: CandidateScore[] = [];

    // ── 0. YOUTUBE VIDEO & CHANNEL CONTENT INTENT ────────────────────────
    // Infer YouTube platform directly from platform-specific concepts (channel, video, shorts)
    // even without mentioning the word "YouTube".
    const ytVideoIntent = this.extractYouTubeVideoIntent(part);
    if (ytVideoIntent) {
      candidates.push({
        executorId: 'browser',
        matched: true,
        confidence: 0.98,
        reason: `YouTube video request: ${ytVideoIntent.entityQuery} (${ytVideoIntent.ordering} video, excludeShorts: ${ytVideoIntent.excludeShorts})`,
        plan: {
          goalId,
          goalDescription: part,
          steps: [{
            stepId,
            capabilityId: 'browser',
            executorId: 'browser',
            action: 'search_and_open_video',
            parameters: {
              target: 'YouTube',
              platform: 'YouTube',
              entityType: 'channel',
              entityQuery: ytVideoIntent.entityQuery,
              query: ytVideoIntent.entityQuery,
              contentType: 'video',
              excludeShorts: ytVideoIntent.excludeShorts,
              excludeContentTypes: ytVideoIntent.excludeShorts ? ['short'] : [],
              ordering: ytVideoIntent.ordering,
              action: 'open',
              url: 'https://www.youtube.com',
            },
            description: `Search YouTube for ${ytVideoIntent.entityQuery}, locate newest video (excluding Shorts), and open it`,
          }],
          estimatedRisk: 'read',
          requiresApproval: false,
          confidence: 0.98,
        },
      });
      candidates.push({ executorId: 'desktop', matched: false, confidence: 0.0, reason: 'browser video intent takes priority' });
      candidates.push({ executorId: 'git', matched: false, confidence: 0.0, reason: 'browser video intent takes priority' });
      candidates.push({ executorId: 'terminal', matched: false, confidence: 0.0, reason: 'browser video intent takes priority' });
      candidates.push({ executorId: 'internal_agenticos', matched: false, confidence: 0.0, reason: 'browser video intent takes priority' });
      candidates.push({ executorId: 'engineering', matched: false, confidence: 0.0, reason: 'browser video intent takes priority' });
      return candidates;
    }

    // ── 1. BROWSER CANDIDATE ──────────────────────────────────────────────
    const browserTarget = browserExecutor.resolveTarget(part);
    const hasBrowserSearch = /\b(?:search for|search|find|look up|locate)\b/i.test(part);
    const hasExplicitWebDomain = /\b(?:https?:\/\/|\.com\b|\.org\b|\.net\b|\.io\b|\.ai\b|www\.)/i.test(lower);
    const hasClickVerb = /\b(?:click|klick|drücke|druecke|tap|press|start|play|watch)\b/i.test(lower);
    const hasTypeVerb = /\b(?:type|tippe|enter|fill in|eingeben|schreibe)\b/i.test(lower);
    const hasContinuationRef = /\b(?:it|video|channel|result|first|first one)\b/i.test(lower);
    const isBrowserFollowUp = priorStep?.executorId === 'browser' && (hasBrowserSearch || hasClickVerb || hasContinuationRef);
    const hasCanonicalKeyword = /\b(youtube|google|linkedin|twitter|x\.com|x browser|google search|shopify site|tiktok shop site)\b/i.test(lower);
    const isWebIntent = /\b(open|browse|visit|go to|take me to|navigate to|look up|locate)\b/i.test(lower) && (browserTarget !== null || hasExplicitWebDomain || hasCanonicalKeyword);

    // ── PAGE INTERACTION (click / type) ───────────────────────────────────
    // A click or a typed entry is a page interaction, not a navigation. It must
    // route to the browser even when the utterance names no site — e.g.
    // "Click Alle akzeptieren." while a consent dialog is on screen, or "start it" after search.
    const quotedPhrase = part.match(/["'„“”]([^"'„“”]{1,80})["'„“”]/);
    const consentWord = /\b(?:akzeptieren|ablehnen|accept|reject|cookies?|consent|zustimmen|notwendige)\b/i.test(lower);
    const liveBrowserState = context?.conversationId
      ? browserStateStore.get(context.conversationId)
      : null;
    const hasLiveBrowserState = Boolean(
      liveBrowserState?.lastBrowserUrl ||
        liveBrowserState?.blockingDialog ||
        liveBrowserState?.lastBrowserGoal,
    );
    const activeLiveTarget = (() => {
      if (!liveBrowserState) return null;
      if (liveBrowserState.visibleTarget) return liveBrowserState.visibleTarget;
      const url = liveBrowserState.lastBrowserUrl || '';
      if (/youtube\.com/i.test(url)) return 'YouTube';
      if (/google\.com/i.test(url)) return 'Google';
      if (/linkedin\.com/i.test(url)) return 'LinkedIn';
      if (/x\.com|twitter\.com/i.test(url)) return 'Twitter';
      return null;
    })();

    const isExplicitDesktopRequest = /\b(?:desktop|computer|pc|laptop|windows|folder|file|program|app|application|shortcut|process|exe)\b/i.test(lower);

    const isContextualBrowserSearch = Boolean(
      hasBrowserSearch &&
      !isExplicitDesktopRequest &&
      hasLiveBrowserState &&
      activeLiveTarget &&
      (!browserTarget || browserTarget.displayName.toLowerCase() === activeLiveTarget.toLowerCase())
    );

    const ordinalIndex = parseOrdinalIndex(lower);
    const isResultSelection = Boolean(
      !isExplicitDesktopRequest &&
      (ordinalIndex !== null || /\b(?:result|first|second|third|that|it|video|channel)\b/i.test(lower)) &&
      /\b(?:open|click|klick|select|pick|choose|play|watch|locate)\b/i.test(lower) &&
      !browserTarget &&
      (hasLiveBrowserState || priorStep?.executorId === 'browser')
    );
    const isScrollAction = Boolean(
      /\b(?:scroll|scrolle)\s+(?:down|up|runter|hoch)\b/i.test(lower) &&
      (hasLiveBrowserState || priorStep?.executorId === 'browser')
    );
    const isHistoryNav = Boolean(
      /\b(?:go\s+back|zurück|go\s+forward|vorwärts|vorwaerts)\b/i.test(lower) &&
      (hasLiveBrowserState || priorStep?.executorId === 'browser')
    );

    const isPageInteraction =
      (hasClickVerb || hasTypeVerb) &&
      (Boolean(quotedPhrase) ||
        consentWord ||
        hasLiveBrowserState ||
        isBrowserFollowUp ||
        browserTarget !== null ||
        hasCanonicalKeyword);

    if (
      !isExplicitDesktopRequest &&
      (hasCanonicalKeyword ||
      browserTarget ||
      hasExplicitWebDomain ||
      isWebIntent ||
      isBrowserFollowUp ||
      isPageInteraction ||
      isContextualBrowserSearch ||
      isResultSelection ||
      isScrollAction ||
      isHistoryNav)
    ) {
      let action: string;
      let parameters: Record<string, unknown>;
      let description: string;

      // The thing the user pointed at: a quoted phrase, or the words after the verb.
      const clickedTargetName = (() => {
        if (quotedPhrase) return quotedPhrase[1].trim();
        const after = part.match(
          /\b(?:click|klick|drücke|druecke|tap|press|start|play|watch)\s+(?:on\s+|the\s+)?(.+)$/i,
        );
        const name = after ? after[1].replace(/[.,!?]+$/, '').trim() : '';
        if (name === 'it' || name === 'the video' || name === 'the channel' || name === '') {
          return (priorStep?.parameters?.query as string) || (priorStep?.parameters?.target as string) || 'play';
        }
        return name;
      })();
      const typedText = (() => {
        if (quotedPhrase) return quotedPhrase[1].trim();
        const after = part.match(
          /\b(?:type|enter|fill in|eingeben|schreibe)\s+(.+)$/i,
        );
        return after ? after[1].replace(/[.,!?]+$/, '').trim() : '';
      })();

      // Check for complete platform search & open instructions
      let platformSearchMatch: { platform: string; query: string; action: 'search_and_open' | 'search'; isChannel?: boolean } | null = null;
      let cleanPart = part.replace(/^jarvis,\s*/i, '').replace(/[.!?]+$/, '').trim();
      cleanPart = cleanPart.replace(/^(?:yes,?\s+)?(?:i\s+said\s+it\s+(?:three|[0-9]+)\s+times[.,]?\s*)/i, '');

      // Pattern 1: search [on] YouTube/Google for <query> [and/then open (his/the)? channel/it]
      const p1 = cleanPart.match(/^(?:now\s+|please\s+)?(?:search|look\s+up)(?:\s+on|\s+in)?\s+(you\s?tube|youtube|google)\s+for\s+(?:the\s+)?(.+?)(?:\s+(?:and|,?\s*then)\s+(?:open|watch|play|show|locate|openeast|open\w*)\s+(?:the\s+|his\s+|her\s+|its\s+|a\s+)?(?:channel|video|page|result|it))?$/i);
      // Pattern 2: find/search <query> on/in YouTube/Google [and/then open (his/the)? channel/it]
      const p2 = cleanPart.match(/^(?:now\s+|please\s+)?(?:find|locate|search\s+for|search|look\s+up|open|watch|play|browse|visit)\s+(?:the\s+)?(.+?)\s+(?:on|in|from|at)\s+(you\s?tube|youtube|google)(?:\s+(?:and|,?\s*then)\s+(?:open|play|start|watch|show|locate|openeast|open\w*)\s+(?:the\s+|his\s+|her\s+|its\s+|a\s+)?(?:channel|video|page|result|it))?$/i);
      // Pattern 3: open/go to YouTube/Google and/then search for / find <query> [and/then open (his/the)? channel/it]
      const p3 = cleanPart.match(/^(?:now\s+|please\s+)?(?:open|go\s+to|visit)\s+(you\s?tube|youtube|google)(?:[,.]?\s+(?:and\s+|then\s+)?(?:find|search\s+for|search|locate|look\s+up|open)\s+(?:the\s+)?(.+?))(?:\s+(?:and|,?\s*then)\s+(?:open|watch|play|show|locate|openeast|open\w*)\s+(?:the\s+|his\s+|her\s+|its\s+|a\s+)?(?:channel|video|page|result|it))?$/i);
      // Pattern 4: go to/open <entity> YouTube channel/video/page
      const p4 = cleanPart.match(/^(?:now\s+|please\s+)?(?:go\s+to|open|visit|find|locate)\s+(?:the\s+)?(.+?)\s+(you\s?tube|youtube)\s+(?:channel|video|page)$/i);
      // Pattern 5: open/go to/find <entity> channel
      const p5 = cleanPart.match(/^(?:now\s+|please\s+)?(?:go\s+to|open|visit|find|locate|show)\s+(?:the\s+)?(.+?)\s+channel$/i);
      // Pattern 6: channel first (e.g. "Now locate the channel Julian Goldy SEO")
      const p6 = cleanPart.match(/^(?:now\s+|please\s+)?(?:go\s+to|open|visit|find|locate|search\s+for|show)\s+(?:the\s+)?channel\s+(.+)$/i);

      if (p1) {
        const hasFollowOpen = Boolean(cleanPart.match(/\s+(?:and|,?\s*then)\s+(?:open|watch|play|show|locate|openeast|open\w*)\s+(?:the\s+|his\s+|her\s+|its\s+|a\s+)?(?:channel|video|page|result|it)/i));
        platformSearchMatch = {
          platform: p1[1].replace(/\s+/g, '').toLowerCase() === 'youtube' ? 'YouTube' : 'Google',
          query: p1[2].replace(/[,\s]+$/, '').trim(),
          action: hasFollowOpen ? 'search_and_open' : 'search',
          isChannel: /\bchannel\b/i.test(cleanPart),
        };
      } else if (p2) {
        platformSearchMatch = {
          platform: p2[2].replace(/\s+/g, '').toLowerCase() === 'youtube' ? 'YouTube' : 'Google',
          query: p2[1].replace(/[,\s]+$/, '').trim(),
          action: 'search_and_open',
          isChannel: /\bchannel\b/i.test(cleanPart),
        };
      } else if (p3 && p3[2]) {
        platformSearchMatch = {
          platform: p3[1].replace(/\s+/g, '').toLowerCase() === 'youtube' ? 'YouTube' : 'Google',
          query: p3[2].replace(/[,\s]+$/, '').trim(),
          action: 'search_and_open',
          isChannel: /\bchannel\b/i.test(cleanPart),
        };
      } else if (p4) {
        platformSearchMatch = {
          platform: 'YouTube',
          query: p4[1].replace(/[,\s]+$/, '').trim(),
          action: 'search_and_open',
          isChannel: true,
        };
      } else if (p5) {
        platformSearchMatch = {
          platform: 'YouTube',
          query: p5[1].replace(/[,\s]+$/, '').trim(),
          action: 'search_and_open',
          isChannel: true,
        };
      } else if (p6) {
        platformSearchMatch = {
          platform: 'YouTube',
          query: p6[1].replace(/[,\s]+$/, '').trim(),
          action: 'search_and_open',
          isChannel: true,
        };
      }

      if (platformSearchMatch) {
        const pTarget = platformSearchMatch.platform;
        const isExplicitChannel = Boolean(
          platformSearchMatch.isChannel ||
          /\bchannel\b/i.test(platformSearchMatch.query) ||
          /\bchannel\b/i.test(cleanPart)
        );
        const pQuery = platformSearchMatch.query
          .replace(/^(?:the\s+channel\s+|channel\s+|the\s+|a\s+|an\s+)/i, '')
          .replace(/^(?:open|find|search for|search|go to|locate)\s+/i, '')
          .replace(/^(?:the\s+channel\s+|channel\s+)/i, '')
          .replace(/[,\s]+$/, '')
          .trim();
        action = platformSearchMatch.action;
        parameters = {
          target: pTarget,
          query: pQuery,
          openFirst: action === 'search_and_open',
          isChannel: isExplicitChannel || action === 'search_and_open',
          url: pTarget === 'YouTube' ? 'https://www.youtube.com' : 'https://www.google.com',
        };
        description = action === 'search_and_open'
          ? (isExplicitChannel
              ? `Search ${pTarget} for "${pQuery}" and open the channel`
              : `Search ${pTarget} for "${pQuery}" and open the matching channel/result`)
          : `Search ${pTarget} for "${pQuery}"`;
      } else if (isPageInteraction && hasClickVerb && clickedTargetName) {
        action = 'click';
        parameters = {
          target: browserTarget ? browserTarget.displayName : (liveBrowserState?.visibleTarget ?? 'current page'),
          name: clickedTargetName,
          url: browserTarget?.url,
        };
        description = `Click "${clickedTargetName}" on the current page`;
      } else if (isPageInteraction && hasTypeVerb) {
        action = 'type';
        parameters = {
          target: browserTarget ? browserTarget.displayName : (liveBrowserState?.visibleTarget ?? 'current page'),
          query: typedText,
          url: browserTarget?.url,
        };
        description = `Type "${typedText}" into the page`;
      } else if (hasBrowserSearch) {
        action = 'search';
        const queryMatch = part.match(/\b(?:search for|search|find|look up)\s+(?:the\s+)?(.+)$/i);
        const query = queryMatch ? queryMatch[1].trim() : part;
        const target = browserTarget ? browserTarget.displayName : (activeLiveTarget || (priorStep?.parameters.target as string) || (liveBrowserState?.lastBrowserUrl?.includes('youtube') ? 'YouTube' : 'current page'));
        parameters = {
          target,
          query,
          url: target === 'YouTube' ? 'https://www.youtube.com' : target === 'Google' ? 'https://www.google.com' : liveBrowserState?.lastBrowserUrl || undefined,
        };
        description = `Search ${target} for "${query}"`;
      } else if (isResultSelection) {
        action = 'open_result';
        const target = browserTarget ? browserTarget.displayName : (activeLiveTarget || (priorStep?.parameters.target as string) || 'current page');
        parameters = {
          target,
          ordinalIndex: ordinalIndex ?? 0,
          name: clickedTargetName || `result ${(ordinalIndex ?? 0) + 1}`,
        };
        description = `Open result ${(ordinalIndex ?? 0) + 1} on ${target}`;
      } else if (isScrollAction) {
        action = 'scroll';
        const dir = /\b(?:up|hoch)\b/i.test(lower) ? 'up' : 'down';
        parameters = { direction: dir };
        description = `Scroll ${dir} on current page`;
      } else if (isHistoryNav) {
        action = /\b(?:go\s+forward|vorwärts|vorwaerts)\b/i.test(lower) ? 'forward' : 'back';
        parameters = {};
        description = action === 'forward' ? 'Go forward to next page' : 'Go back to previous page';
      } else if (browserTarget || hasExplicitWebDomain) {
        action = 'navigate';
        const target = browserTarget ? browserTarget.displayName : part;
        parameters = { target, url: browserTarget?.url || `https://${part}` };
        description = `Navigate browser to ${target}`;
      } else {
        // No browser target or explicit domain: do NOT fabricate Google navigation!
        candidates.push({
          executorId: 'browser',
          matched: false,
          confidence: 0.0,
          reason: 'no browser target or web intent',
        });
        return candidates;
      }

      const interactionConfidence = isPageInteraction || isContextualBrowserSearch ? 0.97 : browserTarget || hasCanonicalKeyword ? 0.99 : 0.95;
      candidates.push({
        executorId: 'browser',
        matched: true,
        confidence: interactionConfidence,
        reason: isPageInteraction
          ? `page interaction (${action}) against the current browser page`
          : isContextualBrowserSearch
            ? `contextual browser search against active ${activeLiveTarget} session`
            : browserTarget
              ? `canonical browser target: ${browserTarget.displayName}`
              : 'web navigation intent',
        plan: {
          goalId,
          goalDescription: part,
          steps: [{
            stepId,
            capabilityId: 'browser',
            executorId: 'browser',
            action,
            parameters,
            description,
          }],
          estimatedRisk: 'read',
          requiresApproval: false,
          confidence: interactionConfidence,
        },
      });
    } else {
      candidates.push({ executorId: 'browser', matched: false, confidence: 0.0, reason: 'no browser target or web intent' });
    }

    // ── 2. DESKTOP APPLICATION & FILESYSTEM CANDIDATE ─────────────────────
    // ABSOLUTE INVARIANT: If canonical browser target matched, desktop gets 0.00
    if (hasCanonicalKeyword || browserTarget) {
      candidates.push({ executorId: 'desktop', matched: false, confidence: 0.0, reason: 'browser canonical target takes absolute priority' });
    } else {
      // 2a. Filesystem / Folder routing
      // Triggered by verbs (open|show|display|launch|explore|view) AND (folder|directory|path|explorer|ordner|verzeichnis OR an absolute drive path)
      const isFolderVerb = /\b(?:open|show|display|launch|explore|view)\b/i.test(part);
      const isFolderKeyword = /\b(?:folder|directory|path|explorer|ordner|verzeichnis)\b/i.test(part);
      const absolutePathMatch = part.match(/\b([a-zA-Z]:\\[^\s,;"'<>|]+|[a-zA-Z]:\/[^\s,;"'<>|]+)/);
      const isAgenticOsFolder = /\b(?:agenticos|agentic\s+os)\b/i.test(part) && isFolderKeyword;

      if (isFolderVerb && (isFolderKeyword || absolutePathMatch)) {
        let resolvedFolderPath: string | null = null;
        let displayName = '';

        if (absolutePathMatch) {
          resolvedFolderPath = absolutePathMatch[1];
          displayName = resolvedFolderPath;
        } else if (isAgenticOsFolder) {
          try {
            resolvedFolderPath = getWorkspaceRoot();
            displayName = 'AgenticOS folder';
          } catch {
            resolvedFolderPath = process.cwd();
            displayName = 'AgenticOS folder';
          }
        }

        if (resolvedFolderPath) {
          candidates.push({
            executorId: 'desktop',
            matched: true,
            confidence: 0.98,
            reason: `filesystem folder request: ${displayName}`,
            plan: {
              goalId,
              goalDescription: part,
              steps: [{
                stepId,
                capabilityId: 'desktop',
                executorId: 'desktop',
                action: 'open_folder',
                parameters: {
                  path: resolvedFolderPath,
                  displayName,
                  targetType: 'filesystem',
                },
                description: `Open folder "${displayName}" in File Explorer`,
              }],
              estimatedRisk: 'read',
              requiresApproval: false,
              confidence: 0.98,
            },
          });
        }
      }

      // If not handled by folder routing, check desktop apps:
      if (!candidates.some((c) => c.executorId === 'desktop')) {
        const desktopApp = desktopExecutor.resolveApp(part);
        const explicitExeMatch = part.match(/\b([a-zA-Z0-9_\-]+\.exe)\b/i);
        const hasExplicitExe = explicitExeMatch !== null;
        const isVisibleOpen = /\b(open|launch|start|show|bring up|run)\b/i.test(part) && (desktopApp !== null || hasExplicitExe);
        const isVisibleClose = /\b(close|exit|terminate|kill|quit|schließe|beende)\b/i.test(part) && (desktopApp !== null || desktopExecutor.getLastActiveApp() !== null);
        const isReopen = /\b(?:open|reopen)\s+(?:it|that|the\s+folder|the\s+app)\s+again\b/i.test(part) || /^(?:open\s+(?:it|that)|reopen\s+it)$/i.test(part.trim());

        if (isReopen) {
          const lastFolder = desktopExecutor.getLastOpenedFolder();
          const lastApp = desktopExecutor.getLastActiveApp();
          if (lastFolder && (desktopExecutor.getLastActionType() === 'folder' || !lastApp)) {
            candidates.push({
              executorId: 'desktop',
              matched: true,
              confidence: 0.98,
              reason: `reopen last folder: ${lastFolder.displayName}`,
              plan: {
                goalId,
                goalDescription: part,
                steps: [{
                  stepId,
                  capabilityId: 'desktop',
                  executorId: 'desktop',
                  action: 'open_folder',
                  parameters: {
                    path: lastFolder.path,
                    displayName: lastFolder.displayName,
                    targetType: 'filesystem',
                  },
                  description: `Open folder "${lastFolder.displayName}" in File Explorer`,
                }],
                estimatedRisk: 'read',
                requiresApproval: false,
                confidence: 0.98,
              },
            });
          } else if (lastApp) {
            candidates.push({
              executorId: 'desktop',
              matched: true,
              confidence: 0.98,
              reason: `reopen last desktop application: ${lastApp.displayName}`,
              plan: {
                goalId,
                goalDescription: part,
                steps: [{
                  stepId,
                  capabilityId: 'desktop',
                  executorId: 'desktop',
                  action: 'open_app',
                  parameters: { app: lastApp.id, displayName: lastApp.displayName },
                  description: `Open ${lastApp.displayName} window`,
                }],
                estimatedRisk: 'read',
                requiresApproval: false,
                confidence: 0.98,
              },
            });
          }
        } else if (isVisibleClose) {
          const targetApp = desktopApp || desktopExecutor.getLastActiveApp();
          if (targetApp) {
            candidates.push({
              executorId: 'desktop',
              matched: true,
              confidence: 0.98,
              reason: `close desktop application: ${targetApp.displayName}`,
              plan: {
                goalId,
                goalDescription: part,
                steps: [{
                  stepId,
                  capabilityId: 'desktop',
                  executorId: 'desktop',
                  action: 'close_app',
                  parameters: { app: targetApp.id, displayName: targetApp.displayName },
                  description: `Close ${targetApp.displayName} window`,
                }],
                estimatedRisk: 'read',
                requiresApproval: false,
                confidence: 0.98,
              },
            });
          }
        } else if (isVisibleOpen && (desktopApp || hasExplicitExe)) {
          const appName = desktopApp ? desktopApp.displayName : explicitExeMatch![1];
          const appId = desktopApp ? desktopApp.id : appName;
          candidates.push({
            executorId: 'desktop',
            matched: true,
            confidence: 0.98,
            reason: desktopApp ? `canonical desktop application: ${desktopApp.displayName}` : `executable desktop application: ${appName}`,
            plan: {
              goalId,
              goalDescription: part,
              steps: [{
                stepId,
                capabilityId: 'desktop',
                executorId: 'desktop',
                action: 'open_app',
                parameters: { app: appId, displayName: appName },
                description: `Open ${appName} window`,
              }],
              estimatedRisk: 'read',
              requiresApproval: false,
              confidence: 0.98,
            },
          });
        } else if (/\b(?:locate|find|where\s+is|show\s+me)\b/i.test(part) || isExplicitDesktopRequest) {
          let targetApp = part
            .replace(/^jarvis[,.\s]*/i, '')
            .replace(/^[.!?\s]+/, '')
            .replace(/[.!?\s]+$/, '')
            .replace(/^(?:locate|find)\s*,\s*(?:locate|find)\s*,\s*/i, '')
            .replace(/^(?:can\s+you\s+|could\s+you\s+|please\s+)?(?:locate|find|where\s+is|show\s+me)\s+/i, '')
            .replace(/^(?:inside|in|on)\s+(?:my\s+)?(?:desktop|computer|pc)\s*[,:]?\s*/i, '')
            .replace(/\s+(?:inside|in|on)\s+(?:my\s+)?(?:desktop|computer|pc)$/i, '')
            .replace(/^(?:the\s+)/i, '')
            .replace(/\s+(?:program|app|application)$/i, '')
            .replace(/['"„“”‘’]/g, '')
            .trim();

          candidates.push({
            executorId: 'desktop',
            matched: true,
            confidence: 0.98,
            reason: `locate desktop application: ${targetApp || 'desktop item'}`,
            plan: {
              goalId,
              goalDescription: part,
              steps: [{
                stepId,
                capabilityId: 'desktop',
                executorId: 'desktop',
                action: 'locate_and_activate',
                parameters: { app: targetApp, target: targetApp },
                description: `Locate ${targetApp || 'desktop item'} on computer`,
              }],
              estimatedRisk: 'read',
              requiresApproval: false,
              confidence: 0.98,
            },
          });
        } else {
          candidates.push({ executorId: 'desktop', matched: false, confidence: 0.0, reason: 'no desktop app match' });
        }
      }
    }

    // ── 3. GIT CANDIDATE ──────────────────────────────────────────────────
    const isGit =
      /^\s*git\b/i.test(part) ||
      /\b(git status|git pull|git push|git clone|git checkout|git diff|git log)\b/i.test(part) ||
      /\b(pull\s+(?:the\s+)?latest(?:\s+changes)?|clone\s+(?:this\s+)?repo(?:sitory)?|checkout\s+(?:branch\s+)?|git\s+branch)\b/i.test(part);

    if (isGit && !hasCanonicalKeyword) {
      let action = 'status';
      let args = '';
      let repoUrl = '';
      let targetCwd = context?.workspacePath || process.cwd();

      const inDirMatch = part.match(/\bin\s+([a-zA-Z]:\\[^\s,]+|\/[^\s,]+)/i);
      if (inDirMatch) targetCwd = inDirMatch[1];

      let risk: CapabilityRisk = 'read';
      if (/\bclone\b/i.test(part)) {
        action = 'clone';
        const urlMatch = part.match(/(https?:\/\/[^\s]+|git@[^\s]+)/i);
        if (urlMatch) repoUrl = urlMatch[1];
        risk = 'local_write';
      } else if (/\bpull\b/i.test(part)) {
        action = 'pull';
        risk = 'local_write';
      } else if (/\bcheckout\b/i.test(part)) {
        action = 'checkout';
        const branchMatch = part.match(/\bcheckout\s+(?:branch\s+)?([^\s]+)/i);
        if (branchMatch) args = branchMatch[1];
      } else if (/\bdiff\b/i.test(part)) {
        action = 'diff';
      } else if (/\blog\b/i.test(part)) {
        action = 'log';
      }

      const isMutation = action === 'clone' || action === 'pull' || action === 'checkout';
      const effectiveRisk = isMutation ? 'destructive' : risk;

      candidates.push({
        executorId: 'git',
        matched: true,
        confidence: 0.96,
        reason: `explicit git operation: ${action}`,
        plan: {
          goalId,
          goalDescription: part,
          steps: [{
            stepId,
            capabilityId: 'git',
            executorId: 'git',
            action,
            parameters: { cwd: targetCwd, args, repoUrl },
            description: `Git ${action} in ${targetCwd}`,
          }],
          estimatedRisk: effectiveRisk,
          requiresApproval: isMutation,
          confidence: 0.96,
        },
      });
    } else {
      candidates.push({ executorId: 'git', matched: false, confidence: 0.0, reason: 'no git command' });
    }

    // ── 4. TERMINAL SHELL COMMAND CANDIDATE ──────────────────────────────
    // ABSOLUTE INVARIANT: Natural language (e.g. "open Google", "Can you open YouTube", "Ja, das habe ich dir gefragt")
    // must NEVER be treated as a terminal shell command.
    const isConversationalSpeech =
      /\b(?:ich|du|er|sie|es|wir|ihr|habe|hat|gefragt|bitte|danke|warum|wieso|kannst|könnte|dauert|brauche|hallo|guten|morgen|abend|antwort|frage)\b/i.test(part) ||
      /\b(?:tell me|explain|can you|could you|what is|how do|why did|please)\b/i.test(part);

    const isExplicitTerminalCommand = !isConversationalSpeech && (
      /^(?:run|exec|execute)\s+(?!\b(?:a\s+search|youtube|google|browser|the\s+web)\b)/i.test(part) ||
      /\b(?:npm\s+(?:test|run|install|start|build)|npx\s+[\w@\/\-]+|pip\s+install|pytest|cargo\s+(?:build|run|test|check)|curl\s+https?:\/\/)\b/i.test(part) ||
      /^(?:dir|ls|cls|clear)(?:\s+[\/\\a-zA-Z0-9_\-\.\*]+)?$/i.test(part.trim()) ||
      /^(?:powershell|cmd|bash)\s+-/i.test(part)
    );

    if (isExplicitTerminalCommand && !hasCanonicalKeyword) {
      let cmd = part.replace(/^(?:run|exec|execute)\s+/i, '').trim();
      let targetCwd = context?.workspacePath || process.cwd();

      const inDirMatch = part.match(/\bin\s+([a-zA-Z]:\\[^\s,]+|\/[^\s,]+)/i);
      if (inDirMatch) {
        targetCwd = inDirMatch[1];
        cmd = cmd.replace(inDirMatch[0], '').trim();
      }

      candidates.push({
        executorId: 'terminal',
        matched: true,
        confidence: 0.95,
        reason: `explicit CLI terminal command: ${cmd}`,
        plan: {
          goalId,
          goalDescription: part,
          steps: [{
            stepId,
            capabilityId: 'terminal',
            executorId: 'terminal',
            action: 'run_command',
            parameters: { command: cmd, cwd: targetCwd },
            description: `Befehl "${cmd}" im Ordner "${targetCwd}" ausführen`,
          }],
          estimatedRisk: 'destructive',
          requiresApproval: true,
          confidence: 0.95,
        },
      });
    } else {
      candidates.push({ executorId: 'terminal', matched: false, confidence: 0.0, reason: 'no explicit CLI syntax' });
    }

    // ── 5. INTERNAL AGENTICOS (Projects, Status & Revenue Operator) ───────
    // If canonical browser targets (Google, YouTube, LinkedIn, X) are present,
    // internal_agenticos must NEVER match.
    if (hasCanonicalKeyword) {
      candidates.push({ executorId: 'internal_agenticos', matched: false, confidence: 0.0, reason: 'browser canonical target takes absolute priority' });
    } else {
      const isStatusQuery =
        /\b(what are you doing|what's happening|what is happening|current status|what is the status|what'?s the status|status update|how is it going|what needs to be done|what should we do|what do we do next|what to do next|what is next|what's next|next step|next steps|next action|next actions|next unfinished task|next unfinished tasks|unfinished task|unfinished tasks|tell me the status|tell me what needs to be done|what is needed|what'?s needed|tell me what is needed|what do we need|what is required|what do you need|what is blocked|what's blocked|blockers|what are we waiting on|waiting on|waiting for|what's stopping us|what is stopping us|stopping us|where we are|where are we|how are we doing|what do you suggest|suggest we do|what do we do now|what should we do now|tell me what you see|what do you see|what you see|show me what is happening|what'?s going on(?: here)?|tell me about this|what is here|what'?s here|what do we see)\b/i.test(part);

      const isExplicitInternalProject =
        /\b(free cash|freecash|free cache|freecache|free-cache|shopify|tiktok shop|revenue operator|revenue workspace)\b/i.test(part) ||
        /\b(start working|continue working|operate|run project|work on)\b/i.test(part);

      // ── Continuation inheritance (compound goals only) ────────────────────
      // A fragment that cannot classify on its own may still refer back to an
      // entity an earlier step already resolved. Inheritance requires ALL of:
      //   1. a previous step that resolved a real internal_agenticos entity,
      //   2. no independent executor classification of this fragment,
      //   3. no explicit project keyword of its own,
      //   4. continuation language ("it", "its", "status", "state", ...).
      // The 0.70/0.80 confidence gates are NOT lowered — this only rescues a
      // fragment that would otherwise fail classification outright.
      const inheritedProject = this.hasExplicitProjectKeyword(part) ? null : this.inheritedProjectFrom(priorStep);
      const independentlyClassified = candidates.some((c) => c.matched && c.confidence >= 0.70);
      const inheritEntity = inheritedProject !== null && !independentlyClassified;

      if (isStatusQuery) {
        // A status fragment without its own project keyword refers to the
        // entity resolved by the previous step, not to the active/first project.
        const targetProj = (inheritEntity ? inheritedProject : null) ?? this.resolveInternalProject(part, effectiveContext);
        if (targetProj && targetProj.id && targetProj.name) {
          const isNextTask = /\b(?:next\s+(?:unfinished\s+)?task|unfinished\s+tasks?|what'?s\s+next\s+task)\b/i.test(part);
          candidates.push({
            executorId: 'internal_agenticos',
            matched: true,
            confidence: 0.98,
            reason: 'internal status query',
            plan: {
              goalId,
              goalDescription: part,
              steps: [{
                stepId,
                capabilityId: 'internal_agenticos',
                executorId: 'internal_agenticos',
                action: 'query_status',
                parameters: {
                  entityId: targetProj.id,
                  entityName: targetProj.name,
                  query: part,
                  executionAllowed: false,
                  subquery: isNextTask ? 'next_unfinished_task' : 'status',
                },
                description: `Query running status for ${targetProj.name}`,
              }],
              estimatedRisk: 'read',
              requiresApproval: false,
              confidence: 0.98,
            },
          });
        }
      } else if (isExplicitInternalProject) {
        const resolvedProject = this.resolveInternalProject(part, effectiveContext);
        if (resolvedProject && resolvedProject.id && resolvedProject.name) {
          const isOpenOnly = /\b(open|show|display|view|see|take me to|go to|go back to|back to|switch to|return to)\b/i.test(part) && !/\b(continue|work|start|operate|stop|pause|halt|cancel)\b/i.test(part);
          const isStop = /\b(stop|pause|halt|cancel)\b/i.test(part);
          const isNegativeExecution = /\b(?:don'?t|do\s+not|never)\s+(?:execute|start|run|do|modify|change|touch)\b/i.test(part) || /\bwithout\s+execut/i.test(part);
          const isCheckOrStatusOnly = (/\b(?:check|inspect|tell me|what is|query|look at|status)\b/i.test(part) || isNegativeExecution) && !/\b(start working|continue working|run project)\b/i.test(part);
          const isNextTask = /\b(?:next\s+(?:unfinished\s+)?task|unfinished\s+tasks?|what'?s\s+next\s+task)\b/i.test(part);

          const action = (isCheckOrStatusOnly || isNextTask) ? 'query_status' : (isOpenOnly ? 'navigate_ui' : 'operate_project');
          const parameters = action === 'query_status'
            ? {
                entityId: resolvedProject.id,
                entityName: resolvedProject.name,
                query: part,
                executionAllowed: !isNegativeExecution,
                subquery: isNextTask ? 'next_unfinished_task' : 'status',
              }
            : (isOpenOnly
              ? { entityId: resolvedProject.id, entityName: resolvedProject.name, entityType: 'project' }
              : {
                  entityId: resolvedProject.id,
                  entityName: resolvedProject.name,
                  continueOnly: /\b(continue|proceed|resume)\b/i.test(part),
                  stopOnly: isStop,
                  action: isStop ? 'stop' : undefined,
                });

          candidates.push({
            executorId: 'internal_agenticos',
            matched: true,
            confidence: action === 'query_status' ? 0.98 : 0.95,
            reason: `internal project ${action}: ${resolvedProject.name}`,
            plan: {
              goalId,
              goalDescription: part,
              steps: [{
                stepId,
                capabilityId: 'internal_agenticos',
                executorId: 'internal_agenticos',
                action,
                parameters,
                description: `${action === 'query_status' ? 'Query status for' : (isOpenOnly ? 'Navigate UI to' : 'Operate project')} ${resolvedProject.name}`,
              }],
              estimatedRisk: action === 'operate_project' ? 'local_write' : 'read',
              requiresApproval: false,
              confidence: action === 'query_status' ? 0.98 : 0.95,
            },
          });
        }
      } else if (inheritEntity && this.hasContinuationReference(part)) {
        // Legitimate continuation of a project resolved by the previous step
        // (e.g. "Inspect Free Cash and tell me its current project insight").
        candidates.push({
          executorId: 'internal_agenticos',
          matched: true,
          confidence: 0.93,
          reason: `internal project continuation: ${inheritedProject!.name}`,
          plan: {
            goalId,
            goalDescription: part,
            steps: [{
              stepId,
              capabilityId: 'internal_agenticos',
              executorId: 'internal_agenticos',
              action: 'query_status',
              parameters: {
                entityId: inheritedProject!.id,
                entityName: inheritedProject!.name,
                query: part,
                inheritedFromPreviousStep: true,
              },
              description: `Query current project insight for ${inheritedProject!.name} (continuation of previous step)`,
            }],
            estimatedRisk: 'read',
            requiresApproval: false,
            confidence: 0.93,
          },
        });
      } else {
        candidates.push({ executorId: 'internal_agenticos', matched: false, confidence: 0.0, reason: 'no internal project match' });
      }
    }

    // ── 6. REPOSITORY & ENGINEERING WORK ──────────────────────────────────
    const isEngineering =
      /\b(inspect|fix|debug|refactor|analyze code|why did the tests fail|fix the errors)\b/i.test(part);

    if (isEngineering && !hasCanonicalKeyword) {
      const action = /\bfix\b/i.test(part) ? 'fix' : 'inspect';
      candidates.push({
        executorId: 'engineering',
        matched: true,
        confidence: 0.95,
        reason: `engineering workflow: ${action}`,
        plan: {
          goalId,
          goalDescription: part,
          steps: [{
            stepId,
            capabilityId: 'engineering',
            executorId: 'engineering',
            action,
            parameters: { goal: part },
            description: `Engineering execution: ${part}`,
          }],
          estimatedRisk: action === 'fix' ? 'local_write' : 'read',
          requiresApproval: false,
          confidence: 0.95,
        },
      });
    } else {
      candidates.push({ executorId: 'engineering', matched: false, confidence: 0.0, reason: 'no engineering keyword' });
    }

    return candidates;
  }

  private splitCompoundGoal(text: string): string[] {
    const withoutWake = text.replace(/^(?:jarvis|hey jarvis|ok jarvis|hi jarvis)[,\s]+/i, '').trim();
    const sourceText = withoutWake.length > 0 ? withoutWake : text;

    // Mid-sentence conversational self-correction (e.g. "do X, scratch that, do Y", "do X, no wait, do Y", "do X, actually no, do Y")
    // Do NOT match ordinary uses of "actually" ("what work is actually running?") or negation ("there is no project").
    const selfCorrectionMatch = sourceText.match(
      /(?:^|[,;]\s*|\s+--\s+|\s+-\s+)(?:scratch\s+that|no\s+wait|correction|i\s+mean|actually\s+no|no[,\s]+actually|actually[,\s]+wait)\s*[,:]?\s+(.+)$/i
    );
    const targetSource = selfCorrectionMatch && selfCorrectionMatch[1].trim().length > 3 ? selfCorrectionMatch[1].trim() : sourceText;

    // Do NOT split unified platform search/open operations like:
    // - "open YouTube and find SEE Adler TV"
    // - "find Julian Goldie SEO on YouTube and open the channel"
    // - "search YouTube for Julian Goldie SEO and open his channel"
    // - "go to YouTube, search for Julian Goldie SEO, then open his channel"
    // - "search in Julian Goldy CEO, the latest video, not short, and open it"
    // - "find Julian Goldie SEO's latest video, not a Short, and open it"
    // - "Find [channel name] and open the latest video that is not a Short"
    if (/\b(?:youtube|google)\b/i.test(targetSource) && /\b(?:search|find|locate|look\s*up|open|watch|play|show)\b/i.test(targetSource)) {
      if (
        /^(?:open|go\s+to|visit)\s+(?:you\s?tube|youtube|google)(?:[,.\s]+(?:and\s+|then\s+)?(?:find|search|locate|look\s*up|open)\s+.+)?/i.test(targetSource) ||
        /^.+?\s+(?:on|in|at)\s+(?:you\s?tube|youtube|google)(?:\s+(?:and|,?\s*then)\s+(?:open|play|start|watch|show)\s+.+)?/i.test(targetSource) ||
        /^(?:please\s+)?(?:search|look\s*up)(?:\s+on|\s+in)?\s+(?:you\s?tube|youtube|google)\s+for\s+.+/i.test(targetSource)
      ) {
        return [targetSource];
      }
    }

    const hasVideoOrShort = /\b(?:videos?|shorts?)\b/i.test(targetSource);
    const hasSearchOrOpen = /\b(?:search|find|locate|look\s*up|open|watch|play|show)\b/i.test(targetSource);
    if (hasVideoOrShort && hasSearchOrOpen) {
      if (
        /\b(?:latest|newest|recent|not\s+a?\s*shorts?|excluding\s+shorts?|no\s+shorts?|that\s+is\s+not\s+a?\s*short)\b/i.test(targetSource) ||
        /\b(?:search\s+(?:in|for)?|find|open)\s+.+?\s+(?:video|short)/i.test(targetSource)
      ) {
        return [targetSource];
      }
    }

    const cleaned = targetSource.replace(/,\s*(?:and\s+then|and|then|also|plus|after that)\s+/gi, ' and ');
    const splitRegex = /\s+(?:and then|and|then|followed by|also|plus|after that)\s+/i;
    const initialTokens = cleaned.split(splitRegex).map((t) => t.trim()).filter((t) => t.length > 0);

    const tokens: string[] = [];
    for (const token of initialTokens) {
      if (token.includes(',')) {
        const subParts = token.split(',').map((s) => s.trim()).filter(Boolean);
        if (
          subParts.length > 1 &&
          subParts.every((p) => p.length > 3 && !/^(?:jarvis|please)$/i.test(p)) &&
          subParts.some((p) => /\b(status|blocker|blockers|next|what|tasks?|stages?|insight|open|search|find|navigate|click|type|start|play|inspect)\b/i.test(p))
        ) {
          tokens.push(...subParts);
          continue;
        }
      }
      tokens.push(token);
    }
    return tokens.length > 0 ? tokens : [text];
  }

  private resolveInternalProject(text: string, context: TurnContext): { id: string; name: string } {
    const normalized = normalizeProjectEntityName(text);
    const lower = normalized.toLowerCase();
    if (lower.includes('free cash') || lower.includes('freecash') || lower.includes('free cache') || lower.includes('freecache')) {
      return { id: 'proj-free-cash', name: 'Free Cash' };
    }
    if (lower.includes('shopify') || lower.includes('sharpify')) {
      return { id: 'proj-shopify', name: 'Shopify' };
    }
    if (lower.includes('tiktok shop') || lower.includes('tik tok shop')) {
      return { id: 'proj-tiktok-shop', name: 'TikTok Shop' };
    }
    if (lower.includes('revenue operator')) {
      return { id: 'revenue-operator', name: 'Revenue Operator' };
    }

    if (context?.activeProjectId && context?.activeProjectName && context.activeProjectName !== 'none') {
      return { id: context.activeProjectId, name: context.activeProjectName };
    }

    return { id: '', name: '' };
  }

  /**
   * Explicit project keywords. A fragment containing one is self-contained and
   * must never inherit an entity from a previous step.
   * Keep in sync with resolveInternalProject().
   */
  private hasExplicitProjectKeyword(part: string): boolean {
    const lower = normalizeProjectEntityName(part).toLowerCase();
    return /\b(free cash|freecash|free cache|freecache|shopify|sharpify|tiktok shop|tik tok shop|revenue operator|revenue workspace)\b/i.test(lower);
  }

  /**
   * Continuation language that refers back to an entity resolved by an earlier
   * step. Deliberately narrow: only recognised references, never free text.
   */
  private hasContinuationReference(part: string): boolean {
    return /\b(it|its|it's|that|this|them|they|there|status|state|current state|project insight|what is happening|what's happening|done|needs to be done|what to do|next|next step|next action|blocked|blocker|blockers|waiting on|waiting for|stopping us|where we are|where are we|tasks|task|what you see|what do you see|see|here|going on|suggest)\b/i.test(part);
  }

  /**
   * The project entity a previous compound-goal step resolved, if that step was
   * a real internal_agenticos project action. Returns null otherwise, which is
   * what keeps unmatched fragments from becoming executable.
   */
  private inheritedProjectFrom(priorStep?: ActionPlanStep): { id: string; name: string } | null {
    if (!priorStep || priorStep.executorId !== 'internal_agenticos') return null;

    const entityId = priorStep.parameters?.entityId;
    if (typeof entityId !== 'string' || !entityId.trim()) return null;

    const entityName = priorStep.parameters?.entityName;
    return {
      id: entityId,
      name: typeof entityName === 'string' && entityName.trim() ? entityName : entityId,
    };
  }

  /**
   * Extract YouTube video/channel intent from natural language,
   * inferring YouTube platform from video/channel/Shorts concepts.
   */
  public extractYouTubeVideoIntent(text: string): {
    entityQuery: string;
    ordering: 'newest' | 'default';
    excludeShorts: boolean;
    contentType: 'video';
  } | null {
    const clean = text
      .replace(/^(?:jarvis|hey jarvis|ok jarvis|hi jarvis)[,\s]+/i, '')
      .replace(/[.!?]+$/, '')
      .trim();

    const hasVideoOrShort = /\b(?:videos?|shorts?)\b/i.test(clean);
    const hasAction = /\b(?:search|find|locate|open|watch|play|look\s*up)\b/i.test(clean);
    if (!hasVideoOrShort || !hasAction) return null;

    const ordering = /\b(?:latest|newest|recent)\b/i.test(clean) ? 'newest' : 'default';
    const excludeShorts = /\b(?:not\s+a?\s*shorts?|no\s+shorts?|excluding\s+shorts?|exclude\s+shorts?|without\s+shorts?|that\s+is\s+not\s+a?\s*shorts?)\b/i.test(clean);

    let q = clean.replace(/^(?:please\s+)?(?:search\s+in|search\s+for|search|find|locate|open|watch|play|look\s*up)\s+/i, '');
    q = q.replace(/,\s*(?:the\s+)?(?:latest|newest|recent)?\s*videos?.*$/i, '');
    q = q.replace(/['’]s\s+(?:the\s+)?(?:latest|newest|recent)?\s*videos?.*$/i, '');
    q = q.replace(/\s+and\s+(?:open|watch|play)\s+(?:the\s+)?(?:latest|newest|recent)?\s*videos?.*$/i, '');
    q = q.replace(/,\s*(?:not\s+a?\s*shorts?|no\s+shorts?|excluding\s+shorts?|exclude\s+shorts?|without\s+shorts?).*$/i, '');
    q = q.replace(/\s+(?:that\s+is\s+|which\s+is\s+)?(?:not\s+a?\s*shorts?|no\s+shorts?).*$/i, '');
    q = q.replace(/\s+(?:the\s+)?(?:latest|newest|recent)\s+videos?.*$/i, '');
    q = q.replace(/\s+on\s+you\s?tube.*$/i, '');
    q = q.replace(/\s+(?:channel|the\s+channel)$/i, '');
    q = q.replace(/^(?:the\s+channel\s+|channel\s+)/i, '');
    q = q.replace(/[,\s]+$/, '').trim();

    if (!q || q.length < 2) return null;

    return {
      entityQuery: q,
      ordering,
      excludeShorts,
      contentType: 'video',
    };
  }
}

export const semanticGoalParser = new SemanticGoalParser();
