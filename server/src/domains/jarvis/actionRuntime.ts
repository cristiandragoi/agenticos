/**
 * JARVIS Action Runtime.
 *
 * Deterministic pipeline for:
 * 1. Action & Navigation Intent Detection
 * 2. Contextual Entity Resolution (Active Module > Scoped Entities > Global)
 * 3. Structured Jarvis Action Contract Generation
 * 4. Truthful Execution Tracking & Activity Evidence
 */

import { CAPABILITY_REGISTRY } from './capabilityRegistry.js';
import { listOpportunities } from '../../services/revenueOperator/opportunityService.js';
import { listMissions } from '../../services/revenueOperator/operatorService.js';
import { projectsStore } from '../../services/projectsStore.js';

export type JarvisActionType =
  | 'OPEN_MODULE'
  | 'OPEN_ENTITY'
  | 'OPEN_PROJECT'
  | 'OPEN_MISSION'
  | 'OPEN_OPPORTUNITY'
  | 'OPEN_RUN'
  | 'OPEN_ARTIFACT'
  | 'SHOW_RESULTS'
  | 'SHOW_EVIDENCE'
  | 'SHOW_ACTIVITY'
  | 'GO_BACK';

export type JarvisAction =
  | { type: 'OPEN_MODULE'; module: string; route: string; displayName: string }
  | { type: 'OPEN_ENTITY'; module?: string; entityType: string; entityId: string; displayName: string; destination: string }
  | { type: 'OPEN_PROJECT'; projectId: string; displayName: string; destination: string }
  | { type: 'OPEN_MISSION'; missionId: string; displayName: string; destination: string }
  | { type: 'OPEN_OPPORTUNITY'; opportunityId: string; displayName: string; destination: string }
  | { type: 'OPEN_RUN'; runId: string; destination: string }
  | { type: 'OPEN_ARTIFACT'; artifactId: string; destination: string }
  | { type: 'SHOW_RESULTS'; runId?: string }
  | { type: 'SHOW_EVIDENCE'; runId?: string }
  | { type: 'SHOW_ACTIVITY' }
  | { type: 'GO_BACK' };

export type ActionErrorCode =
  | 'COMMAND_NOT_RECOGNIZED'
  | 'TRANSCRIPT_EMPTY'
  | 'ENTITY_NOT_FOUND'
  | 'ENTITY_AMBIGUOUS'
  | 'ACTION_INVALID'
  | 'ACTION_DISPATCH_FAILED'
  | 'NAVIGATION_FAILED'
  | 'ENTITY_LOAD_FAILED';

export interface ActionEvidence {
  type: string;
  detail: string;
  timestamp: string;
}

export interface AgenticActionRecord {
  id: string;
  ownerAgent: 'jarvis' | string;
  module?: string;
  command?: string;
  actionType: string;
  entityType?: string;
  entityId?: string;
  displayName?: string;
  status: 'planned' | 'queued' | 'running' | 'completed' | 'failed' | 'blocked' | 'cancelled';
  startedAt: string;
  completedAt?: string;
  destination?: string;
  error?: string;
  errorCode?: ActionErrorCode;
  evidence?: ActionEvidence[];
}

export interface WorkspaceContextData {
  activeModule?: string;
  activeRoute?: string;
  activeMissionId?: string | null;
  activeProjectId?: string | null;
  activeEntityId?: string | null;
  activeEntityType?: string | null;
  availableLocalEntities?: Array<{
    entityType: string;
    entityId: string;
    displayName: string;
    aliases?: string[];
  }>;
  previousAction?: AgenticActionRecord | null;
  previousEntity?: {
    entityType: string;
    entityId: string;
    displayName: string;
  } | null;
  [key: string]: any;
}

export interface EntityCandidate {
  entityType: string;
  entityId: string;
  displayName: string;
  sourceModule: string;
  destination: string;
  score: number;
  matchType: 'exact' | 'alias' | 'token' | 'fuzzy';
}

export type EntityResolutionResult =
  | {
      status: 'resolved';
      entityType: string;
      entityId: string;
      displayName: string;
      sourceModule: string;
      destination: string;
    }
  | {
      status: 'ambiguous';
      code: 'ENTITY_AMBIGUOUS';
      query: string;
      candidates: EntityCandidate[];
      message: string;
    }
  | {
      status: 'failed';
      code: 'ENTITY_NOT_FOUND';
      query: string;
      message: string;
    };

export type ActionParseResult =
  | {
      isAction: true;
      action: JarvisAction;
      resolution?: EntityResolutionResult;
      explanation: string;
    }
  | {
      isAction: true;
      failure: {
        code: ActionErrorCode;
        message: string;
        candidates?: EntityCandidate[];
      };
      explanation: string;
    }
  | {
      isAction: false;
    };

// In-memory store for recent action records
const recentActionStore: AgenticActionRecord[] = [];

export function recordAction(record: AgenticActionRecord): void {
  recentActionStore.unshift(record);
  if (recentActionStore.length > 50) {
    recentActionStore.pop();
  }
}

export function getLatestAction(): AgenticActionRecord | null {
  return recentActionStore[0] || null;
}

export function getActionHistory(): AgenticActionRecord[] {
  return [...recentActionStore];
}

export function updateActionRecord(id: string, patch: Partial<AgenticActionRecord>): AgenticActionRecord | null {
  const rec = recentActionStore.find(a => a.id === id);
  if (rec) {
    Object.assign(rec, patch);
    return rec;
  }
  return null;
}

// Helper: Normalize strings for token & phrase matching
export function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .replace(/\ba genetic\b/g, 'agentic')
    .replace(/\bagenetic\b/g, 'agentic')
    .replace(/\bidentic\b/g, 'agentic')
    .replace(/\ba gented\b/g, 'agentic')
    .replace(/\bagented\b/g, 'agentic')
    .replace(/\ba gentic\b/g, 'agentic')
    .replace(/[&]/g, ' and ')
    .replace(/[+]/g, ' and ')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Words to strip when extracting target entity from command
const STOP_PREFIXES = /^(?:can you\s+|could you\s+|please\s+|i would like to\s+|i want to\s+|i'd like to\s+|let me\s+|can i\s+)*(open|go to|take me to|navigate to|show me the|show me|show|switch to|view|load|see|bring up)\s+(the\s+|a\s+|an\s+)?/i;

export function extractEntityQuery(prompt: string): string | null {
  const p = prompt.trim();
  if (!STOP_PREFIXES.test(p)) return null;
  let raw = p.replace(STOP_PREFIXES, '').trim();
  raw = raw.replace(/\s*(?:so\s+)?(?:that\s+)?(?:i\s+can\s+see\s+it|please)\s*$/i, '').trim();
  return raw.length > 0 ? raw : null;
}

/**
 * FIX 1 — Bare Module Alias Fallback (JARVIS-LIVE-RUNTIME-FIX-003).
 *
 * When Deepgram drops the navigation verb (e.g. "Revenue Operator" instead
 * of "Open Revenue Operator"), STOP_PREFIXES rejects the prompt before the
 * CAPABILITY_REGISTRY is ever consulted. This function performs a narrow,
 * exact-match check of the FULL normalized prompt against every registered
 * capability alias BEFORE the verb-prefix guard.
 *
 * Safety: only exact alias matches fire this path — arbitrary nouns do not
 * become navigation commands.
 */
export function matchBareCapabilityAlias(
  prompt: string
): import('./capabilityRegistry.js').Capability | null {
  const norm = normalizeText(prompt);
  // Strip leading articles that Deepgram may leave in ("the revenue operator")
  const normStripped = norm.replace(/^(the|a|an)\s+/, '');
  for (const cap of CAPABILITY_REGISTRY) {
    for (const alias of cap.aliases) {
      const aNorm = normalizeText(alias);
      if (aNorm === norm || aNorm === normStripped) {
        return cap;
      }
    }
  }
  return null;
}

/**
 * Check if the prompt is asking to show what was done
 */
export function isShowMeWhatYouDid(prompt: string): boolean {
  const p = normalizeText(prompt);
  return (
    /\b(show me what you did|what did you do|show what you did|show me what was done|show activity|show my recent action|what was the last action|show recent actions|show recent activity)\b/.test(p)
  );
}

/**
 * Check if the prompt is asking to go back
 */
export function isGoBack(prompt: string): boolean {
  const p = normalizeText(prompt);
  return /^(go back|back|return|previous page|previous view)$/.test(p);
}

/**
 * Resolve an entity query using contextual multi-tier priority
 */
export async function resolveContextualEntity(
  rawQuery: string,
  context?: WorkspaceContextData
): Promise<EntityResolutionResult> {
  const query = normalizeText(rawQuery);
  const queryTokens = new Set(query.split(' ').filter(t => t.length > 2));
  const activeModule = context?.activeModule || '';

  // Gather entities to search against
  const candidates: Array<{
    entityType: string;
    entityId: string;
    displayName: string;
    sourceModule: string;
    destination: string;
    aliases: string[];
  }> = [];

  // 1. Revenue Operator Entities (Opportunities, Missions)
  try {
    const opps = await listOpportunities();
    for (const opp of opps) {
      const aliases = [
        opp.title,
        ...(opp.category === 'digital_products' ? ['digital product', 'template', 'workflow template'] : []),
      ];
      // Special aliases for Notion template
      if (/notion/i.test(opp.title)) {
        aliases.push(
          'notion template',
          'notion agentic template',
          'notion workflow template',
          'the notion template',
          'notion and agentic workflow template'
        );
      }
      candidates.push({
        entityType: 'opportunity',
        entityId: opp.id,
        displayName: opp.title,
        sourceModule: 'revenue-operator',
        destination: `/revenue-operator?opportunity=${opp.id}`,
        aliases
      });
    }

    const missions = await listMissions();
    for (const m of missions) {
      candidates.push({
        entityType: 'mission',
        entityId: m.id,
        displayName: m.title,
        sourceModule: 'revenue-operator',
        destination: `/revenue-operator?mission=${m.id}`,
        aliases: [m.title, `mission ${m.id}`, `mission ${m.title}`]
      });
    }
  } catch (err) {
    // ignore query fetch failures
  }

  // 1b. Saved projects from projectsStore
  try {
    const projs = projectsStore.listProjects();
    for (const p of projs) {
      candidates.push({
        entityType: 'project',
        entityId: p.id,
        displayName: p.name,
        sourceModule: 'projects',
        destination: `/projects?project=${encodeURIComponent(p.id)}`,
        aliases: [p.name, `${p.name} project`, `project ${p.name}`]
      });
    }
  } catch (err) {
    // ignore project listing errors
  }

  // 2. Add any local entities provided in context
  if (context?.availableLocalEntities) {
    for (const le of context.availableLocalEntities) {
      candidates.push({
        entityType: le.entityType,
        entityId: le.entityId,
        displayName: le.displayName,
        sourceModule: activeModule || 'workspace',
        destination: `/${activeModule || 'projects'}?${le.entityType}=${le.entityId}`,
        aliases: [le.displayName, ...(le.aliases || [])]
      });
    }
  }

  const queryHasProject = /\b(?:projects?|workspace)\b/i.test(rawQuery);

  // Score each candidate
  const scored: EntityCandidate[] = [];

  for (const c of candidates) {
    const cNormTitle = normalizeText(c.displayName);
    const inActiveModule = activeModule && c.sourceModule === activeModule;
    let score = 0;
    let matchType: EntityCandidate['matchType'] = 'fuzzy';

    // Boost score if entity belongs to currently active module
    const moduleBonus = inActiveModule ? 20 : 0;
    const projectBonus = (queryHasProject && c.entityType === 'project') ? 100 : 0;

    // Check exact normalized title
    if (cNormTitle === query) {
      score = 100 + moduleBonus + projectBonus;
      matchType = 'exact';
    } else {
      // Check aliases
      let aliasMatched = false;
      for (const a of c.aliases) {
        const aNorm = normalizeText(a);
        if (aNorm === query) {
          score = 95 + moduleBonus;
          matchType = 'alias';
          aliasMatched = true;
          break;
        } else if (aNorm.includes(query) || query.includes(aNorm)) {
          // More specific (longer) alias matches score higher than short generic keywords
          const specificityBonus = Math.min(Math.floor(aNorm.length / 2), 15);
          score = Math.max(score, 85 + moduleBonus + specificityBonus);
          matchType = 'alias';
          aliasMatched = true;
        }
      }

      if (!aliasMatched) {
        // Token match
        const cTokens = new Set(cNormTitle.split(' ').filter(t => t.length > 2));
        let tokenMatches = 0;
        for (const qt of queryTokens) {
          if (cTokens.has(qt)) tokenMatches++;
        }
        if (queryTokens.size > 0 && tokenMatches === queryTokens.size) {
          score = 80 + moduleBonus;
          matchType = 'token';
        } else if (tokenMatches > 0) {
          score = (tokenMatches / Math.max(queryTokens.size, 1)) * 60 + moduleBonus;
          matchType = 'token';
        } else if (cNormTitle.includes(query) || query.includes(cNormTitle)) {
          score = 70 + moduleBonus;
          matchType = 'fuzzy';
        }
      }
    }

    if (score >= 50) {
      scored.push({
        entityType: c.entityType,
        entityId: c.entityId,
        displayName: c.displayName,
        sourceModule: c.sourceModule,
        destination: c.destination,
        score,
        matchType
      });
    }
  }

  scored.sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    return {
      status: 'failed',
      code: 'ENTITY_NOT_FOUND',
      query: rawQuery,
      message: `No matching entity found for "${rawQuery}"${activeModule ? ` inside ${activeModule}` : ''}.`
    };
  }

  // Ambiguity check: if top candidate score is close to second candidate score
  if (scored.length > 1) {
    const [top1, top2] = scored;
    if (top1.score === top2.score && top1.entityId !== top2.entityId) {
      return {
        status: 'ambiguous',
        code: 'ENTITY_AMBIGUOUS',
        query: rawQuery,
        candidates: scored.slice(0, 3),
        message: `I found multiple matching entities for "${rawQuery}". Please specify which one you want.`
      };
    }
  }

  const best = scored[0];
  return {
    status: 'resolved',
    entityType: best.entityType,
    entityId: best.entityId,
    displayName: best.displayName,
    sourceModule: best.sourceModule,
    destination: best.destination
  };
}

/**
 * Main action runtime parser. Evaluates user prompt in current workspace context.
 */
export async function parseJarvisAction(
  prompt: string,
  context?: WorkspaceContextData
): Promise<ActionParseResult> {
  const rawText = prompt.trim();
  if (!rawText) {
    return {
      isAction: true,
      failure: {
        code: 'TRANSCRIPT_EMPTY',
        message: 'Empty command received.'
      },
      explanation: 'Empty command.'
    };
  }

  // 1. "Show me what you did"
  if (isShowMeWhatYouDid(rawText)) {
    const prev = getLatestAction();
    return {
      isAction: true,
      action: { type: 'SHOW_ACTIVITY' },
      explanation: prev
        ? `Last action: ${prev.command || prev.actionType} (${prev.status}) -> ${prev.destination || 'N/A'}`
        : 'No previous actions recorded in this session.'
    };
  }

  // 2. "Go back"
  if (isGoBack(rawText)) {
    return {
      isAction: true,
      action: { type: 'GO_BACK' },
      explanation: 'Navigating to previous view.'
    };
  }

  // 3a. FIX 1 — Bare Capability Alias Fallback (JARVIS-LIVE-RUNTIME-FIX-003)
  // Check BEFORE the STOP_PREFIXES guard: if the full prompt exactly matches a
  // registered module alias (e.g. "Revenue Operator" with no verb), treat it
  // as OPEN_MODULE without requiring a navigation verb.
  const bareAlias = matchBareCapabilityAlias(rawText);
  if (bareAlias) {
    const action: JarvisAction = {
      type: 'OPEN_MODULE',
      module: bareAlias.id,
      route: bareAlias.route,
      displayName: bareAlias.displayName
    };
    return {
      isAction: true,
      action,
      explanation: `Opening module ${bareAlias.displayName} (bare alias match — navigation verb was dropped by STT).`
    };
  }

  // 3b. Navigation / Open entity commands (requires a navigation verb)
  const entityQuery = extractEntityQuery(rawText);
  if (!entityQuery) {
    return { isAction: false };
  }

  const normQuery = normalizeText(entityQuery);

  // Check top-level capability/module navigation first:
  // e.g. "open revenue operator", "open hermes", "open codex", "open boards"
  for (const cap of CAPABILITY_REGISTRY) {
    if (cap.aliases.some(alias => normalizeText(alias) === normQuery || normQuery.includes(normalizeText(alias)))) {
      const action: JarvisAction = {
        type: 'OPEN_MODULE',
        module: cap.id,
        route: cap.route,
        displayName: cap.displayName
      };
      return {
        isAction: true,
        action,
        explanation: `Opening module ${cap.displayName}.`
      };
    }
  }

  // Saved projects are first-class navigation targets, not Revenue Operator
  // entities.  "Open the Free Cash project" previously fell through to the
  // entity resolver, which looked for the literal name "Free Cash project"
  // and emitted ENTITY_NOT_FOUND even though the project exists.
  const projectQuery = normQuery.replace(/\bprojects?\b/gi, '').trim();
  const matchingProject = projectsStore.listProjects().find((project: any) => {
    const projectName = normalizeText(String(project.name || ''));
    const compactProjectName = projectName.replace(/\s+/g, '');
    const compactQuery = projectQuery.replace(/\s+/g, '');
    return (
      projectName === normQuery ||
      projectName === projectQuery ||
      compactProjectName === compactQuery ||
      compactQuery.includes(compactProjectName) ||
      compactProjectName.includes(compactQuery)
    );
  });
  if (matchingProject) {
    const destination = `/projects?project=${encodeURIComponent(matchingProject.id)}`;
    const action: JarvisAction = {
      type: 'OPEN_ENTITY',
      module: 'projects',
      entityType: 'project',
      entityId: matchingProject.id,
      displayName: matchingProject.name,
      destination,
    };
    return {
      isAction: true,
      action,
      explanation: `Opening project ${matchingProject.name}.`
    };
  }

  // It's an entity query! (e.g. "the Notion and Agentic workflow template")
  const resolution = await resolveContextualEntity(entityQuery, context);

  if (resolution.status === 'resolved') {
    const action: JarvisAction = {
      type: 'OPEN_ENTITY',
      module: resolution.sourceModule,
      entityType: resolution.entityType,
      entityId: resolution.entityId,
      displayName: resolution.displayName,
      destination: resolution.destination
    };
    return {
      isAction: true,
      action,
      resolution,
      explanation: `Opening ${resolution.displayName} in ${resolution.sourceModule}.`
    };
  } else if (resolution.status === 'ambiguous') {
    return {
      isAction: true,
      failure: {
        code: 'ENTITY_AMBIGUOUS',
        message: resolution.message,
        candidates: resolution.candidates
      },
      explanation: resolution.message
    };
  } else {
    return {
      isAction: true,
      failure: {
        code: 'ENTITY_NOT_FOUND',
        message: resolution.message
      },
      explanation: resolution.message
    };
  }
}
