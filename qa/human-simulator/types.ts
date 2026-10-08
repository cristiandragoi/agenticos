/**
 * qa/human-simulator/types.ts
 *
 * Types for the AgenticOS Human Simulator independent QA operator.
 */

export type ScenarioVerdict = 'PASS' | 'FAIL' | 'BLOCKED' | 'UNVERIFIED';

export interface SpokenUtterance {
  text: string;
  language: 'de' | 'en';
  voice?: string;
  preRollSilenceMs?: number;
  postRollSilenceMs?: number;
}

export interface AudioResponseCapture {
  heardAudio: boolean;
  durationMs: number;
  maxRms: number;
  audioBytesBase64?: string;
  transcript?: string;
  ttsVoice?: string;
}

export interface DesktopObservation {
  foregroundWindowTitle: string;
  foregroundProcessName: string;
  runningProcesses: string[];
  browserUrl?: string;
  browserDomState?: {
    hasComposeWindow?: boolean;
    recipientValue?: string;
    subjectValue?: string;
    bodyValue?: string;
  };
  screenshotPath?: string;
  observedAt: string;
}

export interface TurnExecutionTrace {
  turnId?: number | string;
  userSpeechStartTs?: number;
  speechEndTs?: number;
  rawPcmBytes?: number;
  vadDurationMs?: number;
  whisperFinalTranscript?: string;
  normalizedTranscript?: string;
  routerAction?: string;
  route?: string;
  executionDispatchedTs?: number;
  executionVerifiedTs?: number;
  commandToActionLatencyMs?: number;
  commandToResponseLatencyMs?: number;
  ttsPlayoutStartTs?: number;
  ttsCompletedTs?: number;
  fullAssistantText?: string;
  lifecycleOutcome?: string;
  lifecycleReason?: string;
}

export interface StepEvidence {
  stepIndex: number;
  description: string;
  spokenCommand: SpokenUtterance;
  audioCapture: AudioResponseCapture;
  desktopObservation: DesktopObservation;
  trace: TurnExecutionTrace;
  verdict: ScenarioVerdict;
  notes: string[];
  failureStage?: string;
}

export interface ScenarioResult {
  scenarioId: 'A' | 'B' | 'C' | 'D' | 'E';
  name: string;
  description: string;
  startedAt: string;
  completedAt: string;
  steps: StepEvidence[];
  overallVerdict: ScenarioVerdict;
  defectSummary?: string;
}
