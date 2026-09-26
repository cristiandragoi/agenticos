/**
 * voiceTurnAuditStore.ts
 *
 * In-memory audit store tracking voice turn ownership, input channel isolation,
 * browser authorization state, and browser mutations.
 */

import { logger } from '../../../utils/logger.js';
import type { VoiceTurnTrace } from './types.js';

export interface BrowserTypingAttempt {
  turnId?: string;
  voiceEventId?: string;
  targetElement: string;
  textToType: string;
  authorized: boolean;
  reason?: string;
  timestamp: number;
  outcome: 'PERFORMED' | 'REJECTED_UNAUTHORIZED' | 'FAILED';
}

export interface BrowserMutationRecord {
  turnId?: string;
  voiceEventId?: string;
  mutationType: 'TYPE' | 'CLICK' | 'NAVIGATE' | 'SCROLL' | 'SEARCH';
  detail: string;
  authorized: boolean;
  timestamp: number;
}

export class VoiceTurnAuditStore {
  private traces: VoiceTurnTrace[] = [];
  private typingAttempts: BrowserTypingAttempt[] = [];
  private mutations: BrowserMutationRecord[] = [];

  public recordTurnTrace(trace: VoiceTurnTrace): void {
    this.traces.push(trace);
    if (this.traces.length > 500) {
      this.traces.shift();
    }
  }

  public recordTypingAttempt(attempt: BrowserTypingAttempt): void {
    this.typingAttempts.push(attempt);
    if (this.typingAttempts.length > 500) {
      this.typingAttempts.shift();
    }
  }

  public recordMutation(mutation: BrowserMutationRecord): void {
    this.mutations.push(mutation);
    if (this.mutations.length > 500) {
      this.mutations.shift();
    }
  }

  public getLatestTrace(): VoiceTurnTrace | null {
    return this.traces.length > 0 ? this.traces[this.traces.length - 1] : null;
  }

  public getTraces(limit = 50): VoiceTurnTrace[] {
    return this.traces.slice(-limit);
  }

  public getTraceForTurn(turnId: string): VoiceTurnTrace | null {
    return this.traces.find((t) => t.turnId === turnId) || null;
  }

  public getTypingAttempts(limit = 50): BrowserTypingAttempt[] {
    return this.typingAttempts.slice(-limit);
  }

  public getMutations(limit = 50): BrowserMutationRecord[] {
    return this.mutations.slice(-limit);
  }

  public getMutationsSince(timestamp: number): BrowserMutationRecord[] {
    return this.mutations.filter((m) => m.timestamp >= timestamp);
  }

  public getTypingAttemptsSince(timestamp: number): BrowserTypingAttempt[] {
    return this.typingAttempts.filter((a) => a.timestamp >= timestamp);
  }

  public clear(): void {
    this.traces = [];
    this.typingAttempts = [];
    this.mutations = [];
  }
}

export const voiceTurnAuditStore = new VoiceTurnAuditStore();
