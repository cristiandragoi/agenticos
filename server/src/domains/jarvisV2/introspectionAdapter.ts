/**
 * introspectionAdapter.ts — Minimal Deterministic V2 System Introspection Adapter.
 *
 * Answers queries about system state and active focus directly from authoritative
 * AgenticOS routing telemetry and V2 state without using an LLM or falling back to V1.
 */

import { getAuthoritativeRoutingInfo } from '../jarvis/systemIntrospection.js';
import type { JarvisV2State } from './state.js';

export interface IntrospectionAnswer {
  subject: 'MODEL' | 'CURRENT_WORK' | 'CAPABILITY';
  text: string;
}

export async function answerIntrospectionQuery(
  userText: string,
  state: JarvisV2State
): Promise<IntrospectionAnswer | null> {
  const lower = userText.toLowerCase().trim();

  // 1. Model / LLM query: "What AI model are you using right now?", "what model are you using?"
  if (
    /\b(?:what|which)\s+(?:ai\s+|language\s+)?(?:model|llm|checkpoint)\b/i.test(lower) ||
    /\b(?:what\s+model\s+are\s+you\s+using)\b/i.test(lower)
  ) {
    try {
      const routing = await getAuthoritativeRoutingInfo(state.conversationId);
      const model = routing.lastResolvedModel || routing.configuredPrimaryModel || 'gpt-6-astra';
      const provider = routing.lastActualProvider || routing.configuredPrimaryProvider || 'codex';
      return {
        subject: 'MODEL',
        text: `I am currently using model ${model} via ${provider}. Routing state is ${routing.routingState || 'NORMAL'}.`
      };
    } catch {
      return {
        subject: 'MODEL',
        text: `I am currently operating through the configured primary route codex:gpt-6-astra.`
      };
    }
  }

  // 2. Current focus / working on: "What are we working on?", "what are you working on right now?"
  if (
    /\bwhat\s+(?:are\s+we|are\s+you)\s+(?:currently\s+)?working\s+on\b/i.test(lower) ||
    /\bwhat\s+is\s+(?:our|the)\s+(?:current\s+)?focus\b/i.test(lower)
  ) {
    if (state.activeEntity) {
      const priority = state.activeProject?.priority ?? 1;
      return {
        subject: 'CURRENT_WORK',
        text: `We are currently working on ${state.activeEntity.name} (Priority ${priority}).`
      };
    } else {
      return {
        subject: 'CURRENT_WORK',
        text: `There is no active project or entity selected yet. What would you like to work on?`
      };
    }
  }

  return null;
}
