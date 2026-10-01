/**
 * turnClassifier.ts — Deterministic Turn Intent Classifier for Jarvis V2.
 *
 * Evaluates the user's message against the authoritative session state.
 * Never relies on ungrounded heuristic guessing; leverages state flags
 * like expectedInput and pendingAction for disambiguation.
 */

import type { JarvisV2State } from './state.js';

export type TurnIntentType =
  | 'ENTITY_ACTIVATION'
  | 'ENTITY_RECALL'
  | 'PRIORITIES_QUERY'
  | 'PREPARE_INSTRUCTIONS'
  | 'CHECK_READY'
  | 'CONTINUE_UNSUPPLIED'
  | 'SUPPLY_INSTRUCTIONS'
  | 'VERIFY_INSTRUCTIONS'
  | 'RECOMMEND_NEXT'
  | 'DELEGATE_WORKER'
  | 'CONFIRM_ACTION'
  | 'CANCEL_ACTION'
  | 'STOP_COMMAND'
  | 'CURRENT_STATUS'
  | 'FALSE_RULE_COUNT_CLAIM'
  | 'WORKER_HEALTH_QUERY'
  | 'SYSTEM_INTROSPECTION'
  | 'FRAGMENTED_PREAMBLE'
  | 'CAPABILITY_QUERY'
  | 'GENERAL_QUERY';

export interface ClassifiedTurn {
  intent: TurnIntentType;
  targetWorker?: string;
  targetEntityName?: string;
  claimedRuleCount?: number;
  parsedRules?: string[];
  rawText: string;
}

export function classifyTurn(userText: string, state: JarvisV2State): ClassifiedTurn {
  let text = userText.trim();

  // If previous turn was a fragmented preamble (e.g. "I want to give you...") and current turn continues it ("...some instructions for Free Cash.")
  if (state.expectedInput?.type === 'clarification' && state.lastUserTurn && text.startsWith('...')) {
    text = `${state.lastUserTurn.replace(/\.+$/, '')} ${text.replace(/^\.+/, '')}`.trim();
  }

  const lower = text.toLowerCase();

  // 1. Immediate barge-in Stop command: "Stop.", "Halt.", "Stop speaking"
  if (/^(?:stop|halt|stop speaking|quiet|hush|pause)[.!]?$/i.test(lower)) {
    return {
      intent: 'STOP_COMMAND',
      rawText: text
    };
  }

  // 2. Incomplete fragmented utterance: "I want to give you..."
  if (
    /^(?:i want to give you|let's|i'd like to|we should)\s*\.{2,}$/i.test(text) ||
    lower === 'i want to give you...'
  ) {
    return {
      intent: 'FRAGMENTED_PREAMBLE',
      rawText: text
    };
  }

  // 3. System Introspection: "What AI model are you using right now?", "What are we working on?"
  if (
    /\b(?:what|which)\s+(?:ai\s+|language\s+)?(?:model|llm|checkpoint)\b/i.test(lower) ||
    /\bwhat\s+model\s+are\s+you\s+using\b/i.test(lower) ||
    /\bwhat\s+(?:are\s+we|are\s+you)\s+(?:currently\s+)?working\s+on\b/i.test(lower)
  ) {
    return {
      intent: 'SYSTEM_INTROSPECTION',
      rawText: text
    };
  }

  // 4. Instruction ingestion: numbered or bulleted rules
  const hasNumberedList = /^\s*(?:1[\.\)]|\-|\*)\s+.+/m.test(text);
  const mentionsRules = lower.includes('here are the rules') || lower.includes('for free cash:') || lower.includes('for free cash,') || lower.includes('here are the instructions');
  if (hasNumberedList && (mentionsRules || state.expectedInput?.type === 'instruction_set')) {
    return {
      intent: 'SUPPLY_INSTRUCTIONS',
      rawText: text
    };
  }

  // Also support comma-separated or period-separated inline spoken rules if starting with "For Free Cash"
  // Example: "For Free Cash, don't perform earning actions automatically. Check the status once a day. Tell me if earnings or account status changes. Ask me before any external action."
  if (
    (lower.startsWith('for free cash') || lower.startsWith('for freecash')) &&
    (lower.includes("don't perform earning actions") || lower.includes('no earning action') || lower.includes('check status') || lower.includes('check the status'))
  ) {
    return {
      intent: 'SUPPLY_INSTRUCTIONS',
      rawText: text
    };
  }

  // 5. False memory / count challenge: "Didn't I already give you five rules?", "didn't I give you 5 rules"
  const falseCountMatch = lower.match(/didn'?t i (?:already )?(?:give you|tell you) (\w+|\d+) (?:rules|instructions)/i);
  if (falseCountMatch) {
    let count = parseInt(falseCountMatch[1], 10);
    if (isNaN(count)) {
      if (falseCountMatch[1] === 'five') count = 5;
      else if (falseCountMatch[1] === 'four') count = 4;
      else if (falseCountMatch[1] === 'three') count = 3;
    }
    return {
      intent: 'FALSE_RULE_COUNT_CLAIM',
      claimedRuleCount: count,
      rawText: text
    };
  }

  // 6. Worker health queries: "Is Hermes still offline?", "is Hermes offline?", "is Hermes online?"
  if (/is hermes (?:still )?(?:offline|online|available|down|healthy|unhealthy)/i.test(lower)) {
    return {
      intent: 'WORKER_HEALTH_QUERY',
      targetWorker: 'hermes',
      rawText: text
    };
  }
  if (/is codex (?:still )?(?:offline|online|available|down|healthy|unhealthy)/i.test(lower)) {
    return {
      intent: 'WORKER_HEALTH_QUERY',
      targetWorker: 'codex',
      rawText: text
    };
  }

  // 7. Action Confirmation: "yes", "proceed", "yes, proceed", "do it", "confirm", "do that", "yes, do it", "go ahead"
  if (/^(?:yes|proceed|yes[, ]+proceed|do it|confirm|approved?|go ahead|do that|yes[, ]+do it)[.!]?$/i.test(lower)) {
    return {
      intent: 'CONFIRM_ACTION',
      rawText: text
    };
  }

  // 8. Action Cancellation: "no", "cancel", "stop", "abort", "don't do that"
  if (/^(?:no|cancel|abort|don'?t do that|decline)[.!]?$/i.test(lower)) {
    return {
      intent: 'CANCEL_ACTION',
      rawText: text
    };
  }

  // 9. Current Status: "what are you doing right now?", "what is it doing now?", "what is running?", "current status"
  if (
    lower.includes('what are you doing right now') ||
    lower.includes('what are you doing now') ||
    lower.includes('what is it doing now') ||
    lower.includes('what is running') ||
    lower.includes('current status') ||
    lower.includes('what is the status')
  ) {
    return {
      intent: 'CURRENT_STATUS',
      rawText: text
    };
  }

  // 10. Check Ready: "are you ready", "ready?", "ready to receive"
  if (/^(?:are you ready|ready\??|ready to receive\??)[.?!]*$/i.test(lower)) {
    return {
      intent: 'CHECK_READY',
      rawText: text
    };
  }

  // 11. Continue them / proceed when expectedInput is waiting for instructions
  if (
    lower.includes('continue them') ||
    lower.includes('continue with them') ||
    lower.includes('proceed with them') ||
    (lower === 'continue' && state.expectedInput?.type === 'instruction_set')
  ) {
    return {
      intent: 'CONTINUE_UNSUPPLIED',
      rawText: text
    };
  }

  // 12. Verify Instructions: "do you have them?", "did you get them?", "what instructions do you have"
  if (
    lower.includes('do you have them') ||
    lower.includes('did you get them') ||
    lower.includes('do you remember the instructions') ||
    lower.includes('what are the instructions') ||
    lower.includes('what are the rules')
  ) {
    return {
      intent: 'VERIFY_INSTRUCTIONS',
      rawText: text
    };
  }

  // 13. Entity Recall / Pronoun Reference: "What do you remember about it?", "what do you remember about that?", "what do you know about it?"
  if (
    /what do you (?:remember|know) about (?:it|that|this)[?.!]*$/i.test(lower) ||
    lower === 'what do you remember about it?' ||
    lower === 'what do you remember about that?'
  ) {
    return {
      intent: 'ENTITY_RECALL',
      rawText: text
    };
  }

  // 14. Entity Activation: "Let's work on Free Cash.", "work on FreeCash", "let's continue Free Cash"
  if (
    lower.includes('work on free cash') ||
    lower.includes('work on freecash') ||
    lower.includes('continue free cash') ||
    lower.includes('continue freecash') ||
    lower.includes('switch to free cash') ||
    lower.includes('focus on free cash')
  ) {
    return {
      intent: 'ENTITY_ACTIVATION',
      targetEntityName: 'Free Cash',
      rawText: text
    };
  }

  // 15. Prepare Instructions: "I want to give you a set of instructions you should follow for Free Cash", "I want to give you some instructions that you should follow"
  if (
    lower.includes('set of instructions') ||
    lower.includes('some instructions that you should follow') ||
    lower.includes('instructions you should follow') ||
    lower.includes('give you instructions') ||
    lower.includes('give you some instructions') ||
    lower.includes('give you rules')
  ) {
    return {
      intent: 'PREPARE_INSTRUCTIONS',
      targetEntityName: lower.includes('free cash') || lower.includes('freecash') || state.activeEntity?.name.toLowerCase().includes('free cash') ? 'Free Cash' : undefined,
      rawText: text
    };
  }

  // 16. Recommend Next: "what should we do next?", "what next?", "next step"
  if (
    lower.includes('what should we do next') ||
    lower.includes('what next') ||
    lower.includes('what is the next step') ||
    lower.includes('what do you recommend')
  ) {
    return {
      intent: 'RECOMMEND_NEXT',
      rawText: text
    };
  }

  // 17. Delegate to worker: "give that to hermes", "delegate to hermes", "assign to hermes", "have codex do that"
  if (lower.includes('hermes') && (lower.includes('give that to') || lower.includes('delegate') || lower.includes('assign') || lower.includes('give this to') || lower.includes('send to') || lower.includes('hand to') || lower.includes('have hermes'))) {
    return {
      intent: 'DELEGATE_WORKER',
      targetWorker: 'hermes',
      rawText: text
    };
  }
  if (lower.includes('codex') && (lower.includes('give that to') || lower.includes('delegate') || lower.includes('assign') || lower.includes('have codex'))) {
    return {
      intent: 'DELEGATE_WORKER',
      targetWorker: 'codex',
      rawText: text
    };
  }

  // 18. Priorities Query: "what are my current priorities", "active projects", "priorities and active projects"
  if (
    lower.includes('priorities') ||
    lower.includes('active projects') ||
    lower.includes('top priority') ||
    lower.includes('current projects')
  ) {
    return {
      intent: 'PRIORITIES_QUERY',
      rawText: text
    };
  }

  // 19. Direct capability check: "is browser working?", "is terminal working?"
  if (lower.includes('browser') || lower.includes('terminal')) {
    return {
      intent: 'CAPABILITY_QUERY',
      rawText: text
    };
  }

  return {
    intent: 'GENERAL_QUERY',
    rawText: text
  };
}
