import type { AuditEntry } from './types.js';
import { logger } from '../../utils/logger.js';
import fs from 'node:fs';
import path from 'node:path';

export class AuditLog {
  private entries: AuditEntry[] = [];
  private jsonlPath: string;

  constructor(jsonlPath: string = 'D:\\AgenticOS\\data\\selfheal-audit.jsonl') {
    this.jsonlPath = jsonlPath;
    try {
      if (fs.existsSync(this.jsonlPath)) {
        const content = fs.readFileSync(this.jsonlPath, 'utf-8');
        const lines = content.split('\n').filter(line => line.trim().length > 0);
        for (const line of lines) {
          try {
            const entry = JSON.parse(line) as AuditEntry;
            this.entries.push(entry);
          } catch {
            // Ignore malformed JSON lines
          }
        }
      }
    } catch (err) {
      logger.warn(`[SelfHeal:Audit] Failed to load existing audit log entries:`, err);
    }
  }

  appendEntry(entry: AuditEntry): void {
    this.entries.push(entry);
    try {
      const dir = path.dirname(this.jsonlPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.appendFileSync(this.jsonlPath, JSON.stringify(entry) + '\n', 'utf-8');
    } catch (error) {
      logger.error(`[SelfHeal:Audit] Failed to append entry to ${this.jsonlPath}:`, error);
    }
    logger.info(`[SelfHeal:Audit] ${entry.incidentId} ${entry.fromState} → ${entry.toState} (${entry.actor}: ${entry.reason})`);
  }

  getEntries(incidentId: string): AuditEntry[] {
    return this.entries.filter(entry => entry.incidentId === incidentId);
  }

  getAllEntries(): AuditEntry[] {
    return [...this.entries];
  }
}

export const auditLog = new AuditLog();
