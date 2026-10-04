/**
 * IComputerUseProvider.ts — Generic Computer Use Provider Interface
 *
 * PHASE 6B ARCHITECTURAL COMPONENT
 *
 * Subordinate interface for autonomous GUI navigation engines (Agent-S, etc.).
 *
 * Invariants:
 * 1. AgenticOS remains the single supervisory control authority.
 * 2. ComputerUseProvider is responsible only for:
 *    OBSERVE SCREEN -> UNDERSTAND GUI -> PLAN GUI STEP -> ACTION -> OBSERVE AGAIN -> UNTIL SUBGOAL.
 * 3. ComputerUseProvider output is a PROPOSAL — it never declares final success.
 * 4. SourceOutcomeVerifier independently verifies resulting state.
 */

export interface ComputerUseGoalRequest {
  readonly application: string;
  readonly target?: string;
  readonly goal: string;
  readonly currentContext?: Record<string, unknown>;
  readonly timeoutMs?: number;
  readonly maxSteps?: number;
  readonly windowHandle?: number | null;
  readonly windowBounds?: { x: number; y: number; width: number; height: number };
}

export interface ComputerUseObservation {
  readonly step: number;
  readonly windowTitle?: string;
  readonly hwnd?: number | null;
  readonly pid?: number | null;
  readonly visualTargetFound?: boolean;
  readonly boundingCoordinates?: {
    x: number;
    y: number;
    width?: number;
    height?: number;
  };
  readonly actionProposed?: string;
  readonly confidence?: number;
  readonly timestamp: number;
}

export interface ComputerUseGoalResult {
  readonly status: 'SUCCESS' | 'FAILED' | 'STOPPED' | 'TIMEOUT' | 'UNVERIFIED';
  readonly observations: readonly ComputerUseObservation[];
  readonly actions: readonly string[];
  readonly finalScreenshot?: string;
  readonly finalWindow?: string;
  readonly finalHwnd?: number | null;
  readonly claimedTarget?: string;
  readonly evidence: Record<string, unknown>;
  readonly durationMs: number;
  readonly stepCount: number;
  readonly error?: string;
}

export interface TargetIdentity {
  readonly targetId: string;
  readonly application: string;
  readonly process?: string;
  readonly processName?: string;
  readonly hwnd: number;
  readonly pid?: number;
  readonly title?: string;
  readonly targetHint?: string;
  readonly bounds?: {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width?: number;
    height?: number;
  };
  readonly subTarget?: string;
  matchesRequestedApp?(appName: string): boolean;
}

export interface VisualReadQuery {
  readonly contentType: 'WINDOW_TEXT' | 'CHAT_MESSAGES' | 'DOCUMENT_PARAGRAPHS' | 'ORDINAL_POINT';
  readonly count?: number;
  readonly ordinal?: number;
  readonly queryPrompt?: string;
  readonly activateIfHidden?: boolean;
  readonly query?: string;
  readonly type?: string;
}

export interface ExtractedChatMessage {
  readonly index?: number;
  readonly sender?: string;
  readonly text: string;
  readonly timestamp?: string;
  readonly time?: string;
}

export interface VisualReadEvidenceArtifact {
  readonly screenshotPath: string;
  readonly hwnd: number;
  readonly pid?: number;
  readonly processName?: string;
  readonly bounds?: {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width?: number;
    height?: number;
  };
  readonly timestamp: number;
  readonly readQuery: VisualReadQuery;
  readonly model: string;
  readonly rawOutput?: string;
}

export interface AcquiredVisualContent {
  readonly success: boolean;
  readonly sourceTarget: TargetIdentity;
  readonly methodUsed: 'UI_TARS_VISION' | 'UIA';
  readonly method?: string;
  readonly verified?: boolean;
  readonly content?: { text?: string } | any;
  readonly text?: string;
  readonly items?: readonly string[];
  readonly chatMessages?: readonly ExtractedChatMessage[];
  readonly confidence: number;
  readonly evidenceArtifact?: VisualReadEvidenceArtifact;
  readonly timestamp: number;
  readonly error?: string;
  readonly durationMs?: number;
}

export interface IComputerUseProvider {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly supportedPlatforms: readonly string[];

  isAvailable(): Promise<boolean>;
  executeGoal(request: ComputerUseGoalRequest): Promise<ComputerUseGoalResult>;
  read?(target: TargetIdentity, query: VisualReadQuery): Promise<AcquiredVisualContent>;
}
