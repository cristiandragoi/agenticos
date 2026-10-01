/**
 * instructions.ts — Deterministic Instruction Set Ingestion and Persistence for Jarvis V2.
 *
 * Implements strict parsing, storage, and retrieval of entity instruction sets.
 * Stored structurally in `state.instructionSets[targetId]` and never inferred from prose.
 */

import type { JarvisV2State, StoredInstructionSet } from './state.js';

export interface ParsedInstructions {
  instructions: string[];
  rawText: string;
}

/**
 * Parses user input into a discrete list of instructions/rules.
 * Handles:
 * 1. Numbered lists (1. ... 2. ...)
 * 2. Bulleted lists (- ... * ...)
 * 3. Line-by-line rules
 * 4. Spoken multi-sentence rules in a single paragraph:
 *    e.g. "For Free Cash, don't perform earning actions automatically. Check the status once a day. Tell me if earnings or account status changes. Ask me before any external action."
 */
export function parseInstructions(text: string): ParsedInstructions {
  const trimmed = text.trim();
  const instructions: string[] = [];

  // Check if numbered items exist (e.g. "1. ... 2. ...")
  if (/\b1[\.\)]\s+/.test(trimmed)) {
    const parts = trimmed.split(/(?=\b\d+[\.\)]\s+)/);
    for (const part of parts) {
      const match = part.match(/^\d+[\.\)]\s*(.+)$/s);
      if (match?.[1]) {
        instructions.push(match[1].trim().replace(/[\r\n]+/g, ' '));
      }
    }
    if (instructions.length > 0) {
      return { instructions, rawText: trimmed };
    }
  }

  // Check if newline-separated
  const lines = trimmed.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length > 1) {
    for (const line of lines) {
      const numberedMatch = line.match(/^\d+[\.\)]\s*(.+)$/);
      if (numberedMatch?.[1]) {
        instructions.push(numberedMatch[1].trim());
        continue;
      }
      const bulletMatch = line.match(/^[\-\*•]\s*(.+)$/);
      if (bulletMatch?.[1]) {
        instructions.push(bulletMatch[1].trim());
        continue;
      }
      if (!line.toLowerCase().startsWith('here are') && !line.toLowerCase().endsWith(':') && line.length > 5) {
        instructions.push(line.trim());
      }
    }
    if (instructions.length > 0) {
      return { instructions, rawText: trimmed };
    }
  }

  // Single-paragraph spoken sentence splitting
  // Remove preamble like "For Free Cash, " or "Here are the rules: "
  let content = trimmed.replace(/^(?:for\s+free\s+cash(?:[:,]|\s+-)?\s*)/i, '');
  content = content.replace(/^(?:here\s+are\s+the\s+rules(?:[:,]|\s+-)?\s*)/i, '');

  const sentences = content
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim().replace(/[.!?]+$/, ''))
    .filter(s => s.length > 3);

  for (const sentence of sentences) {
    // Clean leading bullets/numbers if any
    const clean = sentence.replace(/^\d+[\.\)]\s*/, '').replace(/^[\-\*•]\s*/, '').trim();
    if (clean.length > 3) {
      // Capitalize first letter and add period for consistency
      const formatted = clean.charAt(0).toUpperCase() + clean.slice(1) + '.';
      instructions.push(formatted);
    }
  }

  return {
    instructions,
    rawText: trimmed
  };
}

/**
 * Stores parsed instructions for a given entity in state.
 */
export function storeInstructions(
  state: JarvisV2State,
  targetId: string,
  targetName: string,
  instructions: string[],
  rawText: string
): StoredInstructionSet {
  const now = new Date().toISOString();
  const existing = state.instructionSets[targetId];

  const set: StoredInstructionSet = {
    targetId,
    targetName,
    instructions,
    rawText,
    createdAt: existing?.createdAt || now,
    updatedAt: now
  };

  state.instructionSets[targetId] = set;

  // Sync to state active constraints if targeting activeEntity
  if (state.activeEntity?.id === targetId || !state.activeEntity) {
    state.constraints = [...instructions];
  }

  // Clear expectedInput if we were waiting for instruction_set
  if (state.expectedInput?.type === 'instruction_set') {
    state.expectedInput = null;
  }

  return set;
}

/**
 * Retrieves stored instructions for an entity.
 */
export function getStoredInstructions(state: JarvisV2State, targetId: string): StoredInstructionSet | null {
  return state.instructionSets[targetId] || null;
}

/**
 * Formats a stored instruction set for display.
 */
export function formatInstructionsSummary(set: StoredInstructionSet): string {
  if (!set || !set.instructions || set.instructions.length === 0) {
    return `No instructions recorded for ${set?.targetName || 'this entity'}.`;
  }

  const lines = set.instructions.map((inst, idx) => `${idx + 1}. ${inst}`);
  return `I have ${set.instructions.length} instructions recorded for ${set.targetName}:\n${lines.join('\n')}`;
}
