/**
 * qa/human-simulator/selfHealFeedback.ts
 *
 * Connects the Human Simulator QA operator to the Cortex & Hindsight self-healing loop.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { ScenarioResult, StepEvidence } from './types.js';

export interface DefectReport {
  defectId: string;
  scenarioId: string;
  stepIndex: number;
  description: string;
  expected: string;
  actual: string;
  failureStage: string;
  traceEvidence: any;
  cortexContext?: any;
  hindsightLessons?: string[];
  createdAt: string;
}

export class SelfHealFeedback {
  private reportsDir: string;
  private hindsightMemoryPath: string;

  constructor(
    reportsDir = 'D:\\AgenticOS\\qa\\evidence\\defects',
    hindsightMemoryPath = 'D:\\AgenticOS\\docs\\lessons\\MEMORY.md'
  ) {
    this.reportsDir = reportsDir;
    this.hindsightMemoryPath = hindsightMemoryPath;
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true });
    }
  }

  /**
   * Search Hindsight memory for relevant lessons.
   */
  searchHindsight(query: string): string[] {
    if (!fs.existsSync(this.hindsightMemoryPath)) return [];
    try {
      const content = fs.readFileSync(this.hindsightMemoryPath, 'utf8');
      const lines = content.split('\n');
      const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
      return lines.filter((l) => terms.some((t) => l.toLowerCase().includes(t))).slice(0, 5);
    } catch {
      return [];
    }
  }

  /**
   * Produce and persist a defect report from a failed step.
   */
  reportDefect(scenario: ScenarioResult, failedStep: StepEvidence): DefectReport {
    const defectId = `DEFECT-${scenario.scenarioId}-${failedStep.stepIndex}-${Date.now()}`;
    const lessons = this.searchHindsight(`${scenario.name} ${failedStep.description}`);

    const report: DefectReport = {
      defectId,
      scenarioId: scenario.scenarioId,
      stepIndex: failedStep.stepIndex,
      description: failedStep.description,
      expected: 'Spoken command executed, verified on desktop, and acknowledged with audible response',
      actual: failedStep.failureStage || 'Step verification returned FAIL',
      failureStage: failedStep.failureStage || 'VERIFICATION_FAILURE',
      traceEvidence: {
        spoken: failedStep.spokenCommand,
        audio: failedStep.audioCapture,
        desktop: failedStep.desktopObservation,
        trace: failedStep.trace,
      },
      hindsightLessons: lessons,
      createdAt: new Date().toISOString(),
    };

    const outPath = path.join(this.reportsDir, `${defectId}.json`);
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
    console.log(`[SelfHealFeedback] Persisted reproducible defect report: ${outPath}`);
    return report;
  }
}
