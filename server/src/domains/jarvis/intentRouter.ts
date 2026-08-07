export interface IntentResult {
  route: 'codex' | 'hermes' | 'memory' | 'direct' | 'clarification_required' | 'agent_teams' | 'investigate';
  category:
    | 'conversation'
    | 'repository_analysis'
    | 'repository_change'
    | 'codex_delegation'
    | 'agent_team_execution'
    | 'file_operation'
    | 'pipeline_operation'
    | 'research'
    | 'system_status'
    | 'approval_required'
    | 'investigation';
  mode: 'direct_conversation' | 'operational_execution';
  confidence: number;
  reason: string;
  requiresWorkspace?: boolean;
  requiresApproval?: boolean;
  selectedAgent?: 'Jarvis' | 'CodeX' | 'Agent Teams' | 'System';
  plan?: string[];
}

export interface DelegationSignals {
  explicitDelegationRequested: boolean;
  explicitNonDelegationRequested: boolean;
}

export function detectDelegationSignals(prompt: string): DelegationSignals {
  const p = prompt.toLowerCase().replace(/\s+/g, ' ').trim();
  return {
    explicitDelegationRequested: /\b(?:use|ask|have|delegate to)\s+codex\b/.test(p) ||
      /\bcodex\b/.test(p) && /\b(?:inspect|analy[sz]e|review|fix|change|modify|update|implement|create|build)\b/.test(p),
    explicitNonDelegationRequested: /\bdo not use\s+codex\b/.test(p) ||
      /\bdon't use\s+codex\b/.test(p) ||
      /\banswer directly\b/.test(p) ||
      /\bdo not delegate\b/.test(p) ||
      /\bdon't delegate\b/.test(p) ||
      /\bno\s+codex\s+goal\b/.test(p) ||
      /\bno\s+agent\b/.test(p)
  };
}

/**
 * Implicit bug-report detection for contextual AgenticOS statements.
 *
 * A statement about a malfunction, inconsistency, unexpected UI state,
 * incorrect value, failed operation, or broken behavior is treated as an
 * implicit operational request ("investigate this problem"), even without an
 * imperative verb. This is PATTERN-based (problem signals + contextual
 * references) — NOT a hardcoded list of example phrases.
 *
 * Informational wh-questions are handled BEFORE this check (they stay direct),
 * so "Why does the provider badge exist?" remains direct conversation.
 */
const APOSTROPHE = `['\u2019]`;
const BUG_SIGNAL_PATTERNS: RegExp[] = [
  // Explicit incorrectness / inconsistency
  /\b(wrong|incorrect|mismatch|out of sync|outdated|stale)\b/,
  /\b(broken|broke|not working|not functioning)\b/,
  // Negated capability about an app artifact ("button doesn't work",
  // "not showing", "won't switch", "can't see")
  new RegExp(`\\b(doesn${APOSTROPHE}?t|doesnt|don${APOSTROPHE}?t|dont|won${APOSTROPHE}?t|wont|can${APOSTROPHE}?t|cant|isn${APOSTROPHE}?t|isnt|aren${APOSTROPHE}?t|arent|didn${APOSTROPHE}?t|didnt)\\s+(work|working|show|showing|update|updating|display|displaying|switch|switching|load|loading|respond|responding|start|stop|open|close|appear|appearing|change|changing|connect|connecting)\\b`),
  /\bnot\s+(work|working|show|showing|update|updating|display|displaying|switch|switching|load|loading|respond|responding|correct|right|there|found|available)\b/,
  // Failure / stuck / missing states
  /\b(stuck|failed|failing|error|errors|missing|gone|nothing happens|no longer|still shows|still says|still stuck|weird|strange)\b/,
  // Deictic + state copula ("It is wrong", "That's broken", "This is stuck")
  /\b(it|this|that|these|those)\s+(is|are|was|were|did|does)\s+(wrong|broken|stuck|failed|missing|incorrect|not)\b/,
  new RegExp(`\\b(that${APOSTROPHE}?s|thats|this is|its|it${APOSTROPHE}?s)\\s+(wrong|broken|stuck|failed|not|showing|updating|displaying)\\b`),
  // Repeat/failure context: "It failed again", "still not", "again"
  /\b(failed|fail|broken|wrong|stuck)\s+again\b/,
];

export function isBugReportStatement(prompt: string): boolean {
  const p = prompt.toLowerCase().replace(/\s+/g, ' ').trim();
  return BUG_SIGNAL_PATTERNS.some((re) => re.test(p));
}

/**
 * Context-aware investigation signals — vague statements that only read as
 * problem reports when recent conversation establishes AgenticOS-state talk
 * ("That value shouldn't be there anymore.", "Why is Laguna still there?",
 * "It changed back."). Requires `recentText` (recent Jarvis turns) to contain
 * a known AgenticOS entity / operation — never globally classifies vague
 * negatives.
 */
const CONTEXTUAL_SIGNAL_PATTERNS: RegExp[] = [
  new RegExp(`\\b(shouldn${APOSTROPHE}?t|should not)\\s+be\\s+(there|here|shown|displayed|visible)\\b`),
  new RegExp(`\\b(isn${APOSTROPHE}?t|is not|ain${APOSTROPHE}?t)\\s+what\\s+(we|i|you|it)\\s+(configured|selected|set|chose|picked|asked)\\b`),
  /\b(not|no longer)\s+what\s+(we|i|you)\s+(configured|selected|set|chose|picked|asked)\b/,
  /\bchanged\s+back\b/,
  /\bstill\s+(there|here|shown|displayed)\b/,
  /\b(the old one|it|that)\s+is\s+(there|back)\s+again\b/,
  new RegExp(`\\b(that${APOSTROPHE}?s|thats|this is)\\s+not\\s+what\\b`),
  /\b(why\s+the\s+hell|how\s+the\s+hell|what\s+the\s+hell|the\s+hell|why|how come)\s+(is|does|did)\s+([a-z0-9][a-z0-9 -]{0,30})\s+still\b/,
];

/** Known AgenticOS entities/state tokens used to establish app context. */
const APP_ENTITY_RE =
  /\b(model|provider|gateway|badge|runtime|agent|task|board|card|stream|operation|status|assignment|selection|config|setting|option|button|panel|orb|voice|mic|tts|stt|hermes|codex|jarvis|qwen|deepseek|laguna|openrouter|ollama|llama|poolside)\b/i;

export function isContextualInvestigationRequest(prompt: string, recentText?: string): boolean {
  const p = prompt.toLowerCase().replace(/\s+/g, ' ').trim();
  if (!CONTEXTUAL_SIGNAL_PATTERNS.some((re) => re.test(p))) return false;
  if (!recentText) return false; // no context — don't classify
  // The prompt itself or the recent turns must mention an AgenticOS entity.
  return APP_ENTITY_RE.test(p) || APP_ENTITY_RE.test(recentText);
}

export class IntentRouter {
  /**
   * Fast, heuristic-based intent routing.
   * Promoted to an independent service layer for future ML replacement.
   */
  async routeIntent(prompt: string, context?: { recentText?: string }): Promise<IntentResult> {
    const p = prompt.toLowerCase().replace(/\s+/g, ' ').trim();
    const words = p.split(' ').filter(Boolean);
    const recentText = context?.recentText;

    const direct = (category: IntentResult['category'], confidence: number, reason: string, plan?: string[]): IntentResult => ({
      route: 'direct',
      category,
      mode: 'direct_conversation',
      confidence,
      reason,
      requiresWorkspace: false,
      requiresApproval: false,
      selectedAgent: 'Jarvis',
      plan
    });

    const operational = (
      route: IntentResult['route'],
      category: IntentResult['category'],
      confidence: number,
      reason: string,
      selectedAgent: IntentResult['selectedAgent'],
      plan: string[],
      requiresWorkspace = true,
      requiresApproval = false
    ): IntentResult => ({
      route,
      category,
      mode: 'operational_execution',
      confidence,
      reason,
      requiresWorkspace,
      requiresApproval,
      selectedAgent,
      plan
    });

    const hasAny = (...terms: string[]) => terms.some(term => p.includes(term));
    const hasWord = (...terms: string[]) => terms.some(term => new RegExp(`\\b${term}\\b`).test(p));
    const delegationSignals = detectDelegationSignals(prompt);
    const hasFileTarget = hasAny('.ts', '.tsx', '.js', '.json', '.md', 'file', 'component', 'router', 'implementation', 'workspace', 'repository', 'repo');
    const hasReadOnlyConstraint = hasAny(
      'do not modify',
      'do not change',
      'do not write',
      'without modifying',
      'without changing',
      'read-only',
      'readonly',
      'no file changes',
      'no changes'
    );
    const hasWriteVerb = hasAny('fix', 'change', 'modify', 'update', 'patch', 'refactor', 'delete', 'remove', 'write', 'create') || hasWord('add', 'implement');
    const effectiveHasWriteVerb = hasWriteVerb && !hasReadOnlyConstraint;
    const hasReadVerb = hasAny('inspect', 'find', 'trace', 'read', 'search in', 'look through', 'why', 'analyze', 'analyse', 'review');
    const isReadOnlyRepositoryRequest = hasReadOnlyConstraint || (hasReadVerb && !effectiveHasWriteVerb);

    if (delegationSignals.explicitNonDelegationRequested) {
      return direct(
        hasFileTarget || hasAny('branch', 'commit', 'repository', 'repo')
          ? 'repository_analysis'
          : 'conversation',
        0.99,
        'Explicit non-delegation instruction requires Jarvis direct handling'
      );
    }

    // 1. Memory checks
    if (p.includes('remember') || p.includes('what did i say') || p.includes('my preferences')) {
      return operational('memory', 'file_operation', 0.9, 'Explicit memory operation detected', 'Jarvis', ['Validate memory service availability', 'Route the request to memory tooling'], false, hasWriteVerb);
    }

    if (hasAny('what can you do', 'capabilities', 'available right now', 'which runtimes are online', 'what is currently running', 'system status')) {
      return direct('system_status', 0.92, 'Live Agentic OS capability/status request', ['Read registered agents', 'Read registered runtimes', 'Summarize available tools']);
    }

    if (hasAny('latest documentation', 'search the latest', 'research ', 'look up documentation', 'find current docs')) {
      return direct('research', 0.82, 'Research request that can be answered through Jarvis without workspace execution', ['Identify research target', 'Use available research/search capability if configured', 'Summarize findings with source constraints']);
    }

    // 2. Agent Teams checks (team, agents, multi-agent)
    const hasAgentKeyword = p.includes('team') || p.includes('agents') || p.includes('multi-agent') || p.includes('agent team');
    const hasExecutionVerb = p.includes('build') || p.includes('create') || p.includes('implement') || p.includes('investigate') || p.includes('execute') || p.includes('analyze') || p.includes('assemble') || p.includes('verify');
    const isConversational = p.includes('what is') || p.includes('explain') || p.includes('who') || p.includes('which') || p.includes('write a message to') || p.includes('what are');

    if (hasAgentKeyword && hasExecutionVerb && !isConversational) {
      return operational('agent_teams', 'agent_team_execution', 0.95, 'Request benefits from explicit multi-agent execution', 'Agent Teams', ['Design Team Sheet', 'Create role-specific plan', 'Request approval before execution'], true, true);
    }

    if (hasAny('builder and verifier', 'researcher and analyst', 'architect and implementer', 'implementer and reviewer')) {
      return operational('agent_teams', 'agent_team_execution', 0.92, 'Request names multiple execution roles', 'Agent Teams', ['Create role-based team', 'Prepare handoffs', 'Request approval before execution'], true, true);
    }

    if (hasAny('ask codex', 'have codex', 'delegate to codex')) {
      if (isReadOnlyRepositoryRequest) {
        return operational('codex', 'repository_analysis', 0.96, 'Explicit read-only CodeX delegation request', 'CodeX', ['Package read-only request for CodeX', 'Attach selected repository', 'Create CodeX inspection goal'], true, false);
      }
      return operational('codex', 'codex_delegation', 0.96, 'Explicit CodeX delegation request', 'CodeX', ['Package user request for CodeX', 'Attach selected repository', 'Create CodeX goal'], true, true);
    }

    if (hasAny('run the deployment pipeline', 'start deployment', 'trigger pipeline', 'run pipeline')) {
      return operational('hermes', 'pipeline_operation', 0.9, 'Pipeline operation requires an execution gate', 'Jarvis', ['Inspect pipeline registry', 'Request approval for side effects', 'Start pipeline if approved'], false, true);
    }

    if (hasAny('show pipeline status', 'pipeline status')) {
      return operational('hermes', 'pipeline_operation', 0.86, 'Pipeline status request', 'Jarvis', ['Inspect pipeline registry', 'Report current status'], false, false);
    }

    if (hasFileTarget && isReadOnlyRepositoryRequest) {
      return operational('codex', 'repository_analysis', 0.9, 'Read-only repository analysis request', 'CodeX', ['Confirm selected repository', 'Inspect relevant files', 'Report findings'], true, false);
    }

    if (hasFileTarget && effectiveHasWriteVerb) {
      const destructive = hasAny('delete', 'remove', 'overwrite');
      return operational(
        'codex',
        destructive ? 'approval_required' : 'repository_change',
        destructive ? 0.96 : 0.93,
        destructive ? 'Destructive repository operation requires approval' : 'Repository change request',
        'CodeX',
        ['Confirm selected repository', 'Prepare implementation plan', 'Request approval before file changes'],
        true,
        true
      );
    }

    // 3. CodeX checks (build, deploy, code, ui, app)
    if (
      p.includes('build a') ||
      p.includes('make a') ||
      p.includes('create a new') ||
      p.includes('deploy') ||
      p.includes('refactor') ||
      p.includes('fix the bug') ||
      (p.includes('code') && p.includes('write'))
    ) {
      return operational('codex', 'repository_change', 0.95, 'Explicit software engineering request', 'CodeX', ['Confirm selected repository', 'Create CodeX goal', 'Request approval before side effects'], true, true);
    }

    // 4. Hermes checks (projects, goals, plans, milestones, tasks, dependencies, execution tracking)
    if (
      p.includes('project') ||
      p.includes('goal') ||
      p.includes('milestone') ||
      p.includes('task') ||
      p.includes('dependency') ||
      p.includes('dependencies') ||
      p.includes('track execution') ||
      p.includes('status of the plan')
    ) {
      return operational('hermes', 'pipeline_operation', 0.90, 'Project/pipeline orchestration command detected', 'Jarvis', ['Check orchestration service availability', 'Route to project execution subsystem'], false, hasWriteVerb);
    }

    // 5. Ambiguous intent handling
    // Greetings are always direct conversation, never clarification
    const isGreeting = /^(hi|hello|hey|yo|sup|howdy|greetings|good\s+(morning|afternoon|evening))\b/.test(p);
    if (isGreeting) {
      return direct('conversation', 0.6, 'Greeting detected — direct conversation');
    }

    // Bare agent-name invocations ("Jarvis", "Hermes", ...) are direct conversation
    const agentNames = ['jarvis', 'hermes', 'codex', 'athena', 'sentinel', 'qwable', 'qwythos'];
    if (words.length === 1 && agentNames.includes(words[0])) {
      return direct('conversation', 0.6, 'Agent invocation — direct conversation');
    }

    // Context-aware investigation: vague statements that read as problem
    // reports ONLY when recent context establishes AgenticOS-state talk
    // ("Why is Laguna still there?", "That value shouldn't be there anymore.").
    // Runs before the question check so problem-questions route to
    // INVESTIGATE while informational questions stay direct.
    if (isContextualInvestigationRequest(prompt, recentText)) {
      return {
        route: 'investigate',
        category: 'investigation',
        mode: 'operational_execution',
        confidence: 0.8,
        reason: 'Contextual AgenticOS problem report (recent conversation context) — implicit investigation request',
        requiresWorkspace: false,
        requiresApproval: false,
        selectedAgent: 'Jarvis',
        plan: ['Resolve the referent from recent conversation context', 'Inspect active runtime/gateway/frontend state', 'Report evidence and resolve when safe'],
      };
    }

    // Questions (wh- words or auxiliary + subject) are direct conversation
    const isQuestion = /^(what|who|how|why|where|when|which)\b/.test(p) ||
      /^(do|does|did|can|could|will|would|is|are|am)\s+(you|i|we|they)\b/.test(p) ||
      p.endsWith('?');
    if (isQuestion) {
      return direct('conversation', 0.55, 'Question detected — direct conversation');
    }

    // ── 6. Implicit BUG_REPORT / INVESTIGATE (contextual operational requests) ──
    // Statements describing a malfunction, inconsistency, unexpected UI state,
    // incorrect value, failed operation, or broken AgenticOS behavior are
    // IMPLICIT operational requests — no imperative verb required. Jarvis is
    // running inside AgenticOS, so "it"/"this"/"that"/"the <subject>" resolve
    // against the application context. The INVESTIGATE path inspects runtime/
    // application state first and only asks the user when state cannot
    // resolve the ambiguity (inspect-before-question).
    if (isBugReportStatement(p)) {
      return {
        route: 'investigate',
        category: 'investigation',
        mode: 'operational_execution',
        confidence: 0.85,
        reason: 'Contextual AgenticOS problem report — implicit investigation request',
        requiresWorkspace: false,
        requiresApproval: false,
        selectedAgent: 'Jarvis',
        plan: ['Inspect active runtime/gateway state', 'Compare with displayed/expected state', 'Report evidence and resolve when safe'],
      };
    }

    // Short or vague prompts that aren't greetings, invocations, or questions need
    // clarification. They must not create a goal or silently default to conversation.
    if (words.length <= 3) {
      return {
        route: 'clarification_required',
        category: 'conversation',
        mode: 'direct_conversation',
        confidence: 0.3,
        reason: 'Ambiguous short prompt requires clarification',
        requiresWorkspace: false,
        requiresApproval: false,
        selectedAgent: 'Jarvis'
      };
    }

    // Fallback direct chat
    return direct('conversation', 0.55, 'No operational action requested');
  }
}

export const intentRouter = new IntentRouter();
