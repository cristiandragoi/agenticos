/**
 * sessionWorkingState.ts — Working Directory and Local Execution Continuity State.
 *
 * Maintains:
 * - Current and recent working directories (e.g. "D:\AgenticOS") across conversational turns.
 * - Resolves deictic locative referents ("there", "in that folder", "that directory", "the repo").
 * - Tracks last executed commands, outputs, exit codes, and process IDs.
 */

import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

export interface SessionLocalState {
  conversationId: string;
  lastWorkingDir: string;
  lastFilesystemPath?: string;
  lastCommand?: string;
  lastExitCode?: number;
  lastStdout?: string;
  lastStderr?: string;
  lastAppName?: string;
  lastPort?: number;
  lastProcessId?: number;
  lastWorkerTaskId?: string;
  timestamp: number;
}

class SessionWorkingStateManager {
  private states = new Map<string, SessionLocalState>();
  private defaultWorkspace: string = 'D:\\AgenticOS';

  constructor() {
    if (fs.existsSync('D:\\AgenticOS')) {
      this.defaultWorkspace = 'D:\\AgenticOS';
    } else {
      this.defaultWorkspace = process.cwd();
    }
  }

  public get(conversationId: string): SessionLocalState {
    const existing = this.states.get(conversationId);
    if (existing) return existing;

    const initial: SessionLocalState = {
      conversationId,
      lastWorkingDir: this.defaultWorkspace,
      timestamp: Date.now(),
    };
    this.states.set(conversationId, initial);
    return initial;
  }

  public update(conversationId: string, partial: Partial<SessionLocalState>): SessionLocalState {
    const current = this.get(conversationId);
    const updated = {
      ...current,
      ...partial,
      timestamp: Date.now(),
    };
    this.states.set(conversationId, updated);
    return updated;
  }

  public setWorkingDir(conversationId: string, workingDir: string): void {
    const resolved = path.resolve(workingDir);
    this.update(conversationId, { lastWorkingDir: resolved });
  }

  public resolveLocationReferent(conversationId: string, text: string): string {
    const lower = text.toLowerCase();
    const state = this.get(conversationId);

    // Look for explicit paths first
    // Windows drive path like D:\AgenticOS or C:\Users\...
    const driveMatch = text.match(/\b([A-Za-z]:\\[^"'\r\n;]+?)(?=\s+(?:and|there|then|to|for|with)|[,.]|$)/i);
    if (driveMatch) {
      const p = driveMatch[1].trim();
      this.setWorkingDir(conversationId, p);
      return p;
    }

    // Look for Desktop
    if (/\b(?:on|in)\s+(?:my\s+)?desktop\b/i.test(lower)) {
      const desktop = path.join(os.homedir(), 'Desktop');
      return desktop;
    }

    // Look for Downloads
    if (/\b(?:in|from)\s+(?:my\s+)?downloads\b/i.test(lower)) {
      const downloads = path.join(os.homedir(), 'Downloads');
      return downloads;
    }

    // Look for Documents
    if (/\b(?:in|from)\s+(?:my\s+)?documents\b/i.test(lower)) {
      const documents = path.join(os.homedir(), 'Documents');
      return documents;
    }

    // Locative pronouns / anaphora: "there", "in that folder", "in that directory", "the repository"
    if (/\b(?:there|in\s+that\s+folder|in\s+that\s+directory|in\s+that\s+repo|in\s+the\s+repo|in\s+the\s+folder)\b/i.test(lower)) {
      return state.lastWorkingDir;
    }

    return state.lastWorkingDir;
  }
}

export const sessionWorkingState = new SessionWorkingStateManager();
