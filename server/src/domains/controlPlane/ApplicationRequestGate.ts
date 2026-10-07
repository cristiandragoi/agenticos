import { AuthoritativeIntentCompiler, type CompiledTurnPlan, type IntentCompilerContext } from './AuthoritativeIntentCompiler.js';
import { authoritativeInteractionContext as memory } from './AuthoritativeInteractionContext.js';
import { windowsApplicationResolver } from './WindowsApplicationResolver.js';
import { parseConcreteAppRequest } from './ConcreteVoiceRequests.js';

/** Resolves names before execution; questions never carry action verification. */
export async function resolveApplicationRequest(raw: string, ctx?: IntentCompilerContext): Promise<CompiledTurnPlan | null> {
  const conversationId = ctx?.conversationId;
  const state = conversationId ? memory.getContext(conversationId) : null;
  const pending = state?.pendingContext?.kind === 'target_clarification' ? state.pendingContext : null;
  const command = raw.match(/^(?:(?:okay|yes)[,.]?\s+)?(?:jarvis[, ]+)?(?:please\s+)?(?:(?:can|could|would)\s+you\s+)?(?:open|launch|start|bring\s+up)\s+(.+?)[.!?]*$/i);
  let query = command?.[1]?.trim();
  // Preserve an unresolved application across a location hint; never turn
  // "it's on my desktop" into a chat name inherited from an older task.
  if (!query && /\b(?:desktop|taskbar|bottom)\b/i.test(raw) &&
      (pending || state?.lastExecutionFailure?.action === 'OPEN_APPLICATION')) {
    const hint=raw.match(/^([\p{L}\p{N} ]+?)[,;]/u)?.[1]?.trim();
    query=hint && !/^(?:it|you|the)\b/i.test(hint) ? hint : pending?.target || state?.lastExecutionFailure?.target || state?.pendingTarget || undefined;
  }
  const locateApp = raw.match(/^(?:jarvis[, ]+)?(?:go\s+and\s+)?(?:locate|find)\s+(?:(?:on\s+)?(?:the\s+)?(?:bottom\s+of\s+)?(?:my|the)\s+(?:desktop|taskbar|computer)\s+)?(?:the\s+)?(?:desktop\s+)?(?:application|app|program)\s+(.+?)[.!?]*$/i);
  if (!query && locateApp) query = locateApp[1].trim();
  if (!query && /^(?:jarvis[, ]+)?(?:please\s+)?(?:open|launch|start)[.!?]*$/i.test(raw)) query = 'the application';
  let website = false;
  let remainingWork = '';
  if (!query && pending && /^[\p{L}\p{N}\s.:/_-]{1,100}[.!?]?$/u.test(raw) && !/\b(?:why|how|stop|cancel|never|don't|thanks)\b/i.test(raw)) {
    query = raw.replace(/[!?]$/, '').trim();
    website = pending.website === true;
    remainingWork = pending.remainingWork || '';
  }
  if (!query) return null;
  if (/^(?:microsoft\s+)?words?\s+document$/i.test(query)) query = 'Word';
  if (/^adobe\s+pdf$/i.test(query) || (/^pdf[.!?]*$/i.test(query) && pending?.names?.some((name: string) => /acrobat/i.test(name)))) query = 'Adobe Acrobat';
  if (/^(?:it|this|that)$/i.test(query)) return null;
  if (query.includes(',')) return null;
  const question = (text: string, names: string[] = []): CompiledTurnPlan => {
    if (conversationId) memory.setPendingAction(conversationId, { action: 'CLARIFY_TARGET', target: query, context: { kind: 'target_clarification', website, names, remainingWork } });
    const base = AuthoritativeIntentCompiler.compilePlan('Hello', ctx);
    return { ...base, rawPrompt: raw, normalizedPrompt: raw, isCompound: false, steps: [{ ...base.steps[0], action: 'CONVERSATIONAL', application: null, target: 'clarify_execution_target', contentRequest: text, rawPrompt: raw, normalizedPrompt: raw, reason: 'Unresolved execution target', isDirectCommand: false }] };
  };
  if (/^(?:the\s+)?(?:website|site|web\s*page)$/i.test(query)) {
    website = true;
    return question('Which website would you like me to open?');
  }
  if (/^(?:the\s+)?(?:app|application|program)$/i.test(query)) return question('Please repeat which application you want me to open.');
  if (website) {
    const plan = AuthoritativeIntentCompiler.compilePlan(`Open ${query}`, ctx);
    if (!['NAVIGATE_WEB', 'OPEN_URL'].includes(plan.steps[0]?.action)) return question('Please tell me the website name or its web address.');
    if (conversationId) memory.clearPendingAction(conversationId);
    return plan;
  }
  // Keep the requested work when a clarification supplies only the application name.
  const compound = query.match(/^(.+?)(\s+(?:and|then)\s+.+)$/i);
  if (compound) { query = compound[1]; remainingWork = compound[2]; }
  if (/\b(?:chat|conversation|document|file|folder|video|channel|camera)\b|https?:|www\.|\.[a-z]{2,}(?:\/|$)/i.test(query)) return null;
  const fallback = AuthoritativeIntentCompiler.compilePlan(raw, ctx);
  if (fallback.steps[0]?.reason === 'Bound chat follow-up') return null;
  if (['NAVIGATE_WEB', 'OPEN_URL', 'OPEN_CHAT', 'READ_MESSAGES'].includes(fallback.steps[0]?.action)) return null;
  query = parseConcreteAppRequest(`Open ${query}`) || query.replace(/\s+(?:app|application|program)$/i, '').replace(/\s+(?:inside|on)\s+(?:my|the)\s+(?:laptop|desktop|computer)$/i, '');
  const resolution = await windowsApplicationResolver.resolveWithConfidence(query, { actionType: 'open' });
  if (resolution.status !== 'resolved') {
    const names = resolution.candidates.map(candidate => candidate.name);
    return question(names.length ? `Which application do you mean: ${names.join(', ')}?` : 'Please repeat which application you want me to open. I could not match that name to an installed application.', names);
  }
  if (conversationId) memory.clearPendingAction(conversationId);
  const application = resolution.candidates[0].name;
  if (remainingWork) {
    const request = `Open ${application}${remainingWork}`;
    return { ...AuthoritativeIntentCompiler.compilePlan(request, ctx), rawPrompt: request, normalizedPrompt: request, isCompound: true };
  }
  return { ...fallback, isCompound: false, steps: [{ ...fallback.steps[0], action: 'OPEN_APPLICATION', targetType: 'APPLICATION_WINDOW', application, target: application, contentRequest: null, confidence: 1, isDirectCommand: true, delegationRequested: false, reason: 'Installed application resolved without ambiguity' }] };
}
