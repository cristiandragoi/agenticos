/**
 * turnLifecycle/understand.ts — UNDERSTAND stage.
 *
 * Produces a structured goal for ANY phrasing with one LLM call. There are no
 * phrase-specific patterns here: the planner returns a goal kind and, for
 * actions, a typed action. Only goal types with an observable postcondition
 * (launch_app, type_text, open_url) are executed natively by the lifecycle;
 * everything else is handed to the legacy handler chain and can at best end
 * EXECUTED_UNVERIFIED.
 */
import { llmChat } from '../../services/llmGateway.js';
import { logger } from '../../utils/logger.js';
import type { PreviousTurnSummary } from './store.js';
import type { ActionType, Postcondition, TurnGoal, TurnRequest } from './types.js';
import { hostOf } from './probes.js';

const PLANNER_SYSTEM_PROMPT = [
  'You convert ONE user request for a Windows desktop assistant into a JSON goal.',
  'You never answer or perform the request. Output ONLY a JSON object, no prose.',
  '',
  'Schema:',
  '{"kind":"answer|action|control","summary":"<one short sentence describing the goal>",',
  ' "continuesPrevious":true|false,',
  ' "action":{"type":"launch_app|type_text|open_url|other","app":"<application name or empty>",',
  '           "text":"<exact characters to type or empty>","url":"<absolute https URL or empty>"}}',
  '',
  'kind:',
  '- "action": the user wants something changed or done on the computer, in an app, in a browser,',
  '  or by another agent (open, start, launch, type, write, navigate, click, send, create, delete, delegate...).',
  '- "answer": questions, conversation, explanations, status/introspection requests. Nothing is changed.',
  '- "control": the user only wants the assistant to stop, cancel, pause or be quiet.',
  'action.type (only when kind is "action"):',
  '- "launch_app": ONLY open/start an installed desktop application; set "app".',
  '- "type_text": open/use a desktop application and type given text into it; set "app" and the exact "text".',
  '  Convert spoken symbols in the text to characters (e.g. "dash" -> "-"), keep letters/digits exactly as said.',
  '- "open_url": open a website or web address in the browser; set "url" to a full https URL',
  '  (spoken "example dot com" -> "https://example.com").',
  '- "other": any other action, including multi-step or ambiguous ones.',
  'Never invent an application, text or URL the user did not state.',
  'continuesPrevious: true ONLY if the request cannot be understood without the previous exchange',
  '(e.g. "it", "that one", "try again", "why not?", a reply to a question the assistant asked).',
  'An unrelated new request is false even if it arrives right after the previous one.',
].join('\n');

function extractJson(text: string): any | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

export function validateGoal(raw: any): TurnGoal | null {
  if (!raw || typeof raw !== 'object') return null;
  const kind = raw.kind === 'action' || raw.kind === 'control' || raw.kind === 'answer' ? raw.kind : null;
  if (!kind) return null;
  const goal: TurnGoal = {
    kind,
    summary: str(raw.summary) || (kind === 'answer' ? 'Answer the user' : 'Perform the requested action'),
    continuesPrevious: raw.continuesPrevious === true,
    understoodBy: 'llm_planner',
  };
  if (kind === 'action') {
    const a = raw.action && typeof raw.action === 'object' ? raw.action : {};
    let type: ActionType = (['launch_app', 'type_text', 'open_url', 'other'] as const).includes(a.type) ? a.type : 'other';
    const app = str(a.app);
    const text = typeof a.text === 'string' ? a.text : '';
    let url = str(a.url);
    // A typed action whose required parameters are missing is not executable natively.
    if (type === 'launch_app' && !app) type = 'other';
    if (type === 'type_text' && (!app || !text)) type = 'other';
    if (type === 'open_url') {
      if (url && !/^https?:\/\//i.test(url)) url = `https://${url}`;
      if (!url || !hostOf(url)) type = 'other';
    }
    goal.action = { type };
    if (app) goal.action.app = app;
    if (type === 'type_text') goal.action.text = text;
    if (type === 'open_url') goal.action.url = url;
  }
  return goal;
}

export async function understand(req: TurnRequest, previous: PreviousTurnSummary | null): Promise<TurnGoal> {
  const prevBlock = previous
    ? [
        'Previous exchange in this conversation:',
        `USER: ${previous.text.slice(0, 500)}`,
        `ASSISTANT: ${(previous.responseText || '').slice(0, 500)}`,
        `(${Math.round((Date.parse(req.receivedAt) - Date.parse(previous.receivedAt)) / 1000)} s ago)`,
      ].join('\n')
    : 'There is no previous exchange in this conversation.';
  const prompt = `${prevBlock}\n\nCurrent request:\n${req.text}\n\nReturn the JSON goal.`;

  try {
    const res = await llmChat({
      agentId: 'agent-jarvis',
      systemPrompt: PLANNER_SYSTEM_PROMPT,
      prompt,
      maxTokens: 400,
      timeoutMs: 20000,
      requestId: `plan-${req.requestId}`,
    });
    const goal = validateGoal(extractJson(res.reply || ''));
    if (goal) {
      if (!previous) goal.continuesPrevious = false;
      return goal;
    }
    return fallbackGoal(req, previous, `planner returned no valid goal (provider=${res.provider}${res.error ? `, error=${res.error}` : ''})`);
  } catch (err: any) {
    logger.warn('[TurnLifecycle] planner failed', { requestId: req.requestId, error: err?.message });
    return fallbackGoal(req, previous, `planner error: ${err?.message || err}`);
  }
}

/**
 * Planner unavailable: never guess an action. The request is treated as an
 * answer-class request for the legacy handler chain; anything that handler
 * does is reported at best EXECUTED_UNVERIFIED. Without a planner judgement
 * there is no evidence the request relates to the previous one, so previous
 * context is NOT attached (a fresh context is used).
 */
export function fallbackGoal(_req: TurnRequest, _previous: PreviousTurnSummary | null, reason: string): TurnGoal {
  return {
    kind: 'answer',
    summary: 'Respond to the user (planner unavailable)',
    continuesPrevious: false,
    understoodBy: 'fallback',
    plannerError: reason,
  };
}

/** Postcondition derived from the goal BEFORE execution. */
export function definePostcondition(goal: TurnGoal): Postcondition {
  if (goal.kind === 'control') {
    return { kind: 'none_control', description: 'Transport-level control; nothing to change.', expected: {} };
  }
  if (goal.kind === 'answer') {
    return {
      kind: 'answer_delivered',
      description: 'A response is produced and no side effect is performed or claimed.',
      expected: { sideEffects: 0 },
    };
  }
  const a = goal.action!;
  switch (a.type) {
    case 'launch_app':
      return {
        kind: 'window_of_app_newly_present_or_foregrounded',
        description: `A window of "${a.app}" appears that did not exist before, or an existing one becomes the foreground window.`,
        expected: { app: a.app },
      };
    case 'type_text':
      return {
        kind: 'text_present_in_new_or_target_window',
        description: `The exact text "${a.text}" is readable in a "${a.app}" window and was not present there before.`,
        expected: { app: a.app, text: a.text },
      };
    case 'open_url':
      return {
        kind: 'browser_tab_at_host_after_navigation',
        description: `A browser tab shows a page on ${hostOf(a.url!)} that was not showing before the action.`,
        expected: { url: a.url, host: hostOf(a.url!) },
      };
    default:
      return {
        kind: 'legacy_unverifiable',
        description: 'Executed by a legacy handler; no independent postcondition is available yet.',
        expected: {},
      };
  }
}
