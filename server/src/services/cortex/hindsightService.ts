/**
 * hindsightService.ts — On-demand engineering review and durable lessons manager.
 *
 * Persists validated, shareable engineering lessons to D:\AgenticOS\docs\lessons\MEMORY.md.
 * Required schema:
 * - Failure signature and affected subsystem
 * - Confirmed root cause
 * - Relevant code references
 * - Repair and regression-test evidence
 * - Known limitations and recurrence prevention
 *
 * Enforces deduplication and separates verified repairs from unverified hypotheses.
 */

import fs from 'node:fs';
import path from 'node:path';
import { logger } from '../../utils/logger.js';

export interface HindsightLesson {
  signature: string;
  subsystem: string;
  rootCause: string;
  codeReferences: string[];
  repairEvidence: string;
  recurrencePrevention: string;
  limitations?: string;
  verified: boolean;
  date?: string;
}

export class HindsightService {
  private readonly memoryFilePath: string;

  constructor() {
    this.memoryFilePath = path.resolve('D:\\AgenticOS', 'docs', 'lessons', 'MEMORY.md');
  }

  /** Ensure docs/lessons/MEMORY.md exists with appropriate headers */
  private ensureMemoryFile(): void {
    const dir = path.dirname(this.memoryFilePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    if (!fs.existsSync(this.memoryFilePath)) {
      const header = `# AgenticOS Shared Engineering Lessons (Hindsight MEMORY.md)

This file contains durable, validated engineering lessons distilled from real-world failures, repairs, and regression evidence.

Rules:
1. Every lesson must trace to confirmed evidence and tests.
2. Speculative diagnoses must NEVER be recorded as settled facts.
3. Deduplicate in-place; do not append redundant duplicate entries.
4. Keep Ornith/Hermes (user/business memory), Cortex (code knowledge), and Hindsight (lessons) separate.

---
`;
      fs.writeFileSync(this.memoryFilePath, header, 'utf-8');
    }
  }

  /** Format a lesson as markdown conforming to the required schema */
  private formatLesson(lesson: HindsightLesson): string {
    const date = lesson.date || new Date().toISOString().split('T')[0];
    const status = lesson.verified ? 'VERIFIED' : 'HYPOTHESIS (UNVERIFIED)';
    const refs = lesson.codeReferences.map((r) => `  - \`${r}\``).join('\n');

    return `
### [${date}] ${lesson.signature} (${status})
- **Subsystem**: \`${lesson.subsystem}\`
- **Confirmed Root Cause**: ${lesson.rootCause}
- **Code References**:
${refs}
- **Repair & Regression Evidence**: ${lesson.repairEvidence}
- **Recurrence Prevention**: ${lesson.recurrencePrevention}
${lesson.limitations ? `- **Known Limitations**: ${lesson.limitations}\n` : ''}
`;
  }

  /**
   * Persists a lesson into MEMORY.md.
   * If an entry with the same signature already exists, updates it in place; otherwise appends it.
   */
  public recordLesson(lesson: HindsightLesson): { success: boolean; updated: boolean } {
    try {
      this.ensureMemoryFile();
      let content = fs.readFileSync(this.memoryFilePath, 'utf-8');

      const marker = `### [`;
      const signatureMarker = `] ${lesson.signature}`;
      const isExisting = content.includes(signatureMarker);

      if (isExisting) {
        // Replace existing section
        const lines = content.split('\n');
        let startIdx = -1;
        let endIdx = -1;

        for (let i = 0; i < lines.length; i++) {
          if (lines[i].includes(signatureMarker)) {
            startIdx = i;
            // Find next section header or EOF
            for (let j = i + 1; j < lines.length; j++) {
              if (lines[j].startsWith('### [') || lines[j].startsWith('## ')) {
                endIdx = j;
                break;
              }
            }
            if (endIdx === -1) endIdx = lines.length;
            break;
          }
        }

        if (startIdx !== -1) {
          const formatted = this.formatLesson(lesson).trim();
          lines.splice(startIdx, endIdx - startIdx, formatted);
          fs.writeFileSync(this.memoryFilePath, lines.join('\n'), 'utf-8');
          logger.info(`[Hindsight] Updated existing lesson in MEMORY.md: "${lesson.signature}"`);
          return { success: true, updated: true };
        }
      }

      // Append new entry
      const formatted = this.formatLesson(lesson);
      fs.appendFileSync(this.memoryFilePath, formatted, 'utf-8');
      logger.info(`[Hindsight] Recorded new lesson in MEMORY.md: "${lesson.signature}"`);
      return { success: true, updated: false };
    } catch (err: any) {
      logger.warn('[Hindsight] Failed to record lesson: ' + err?.message);
      return { success: false, updated: false };
    }
  }

  /** Read all existing lessons from MEMORY.md */
  public readLessons(): string {
    try {
      this.ensureMemoryFile();
      return fs.readFileSync(this.memoryFilePath, 'utf-8');
    } catch (err: any) {
      return '';
    }
  }
}

export const hindsightService = new HindsightService();
