/**
 * types.ts — Universal Goal Run & Autonomous Control Plane Types
 *
 * Implements the universal GoalRun lifecycle, audit events, verification,
 * and recovery data structures for AgenticOS.
 */

export type GoalStatus =
  | 'RECEIVED'
  | 'ACKNOWLEDGED'
  | 'PLANNING'
  | 'DISCOVERING'
  | 'EXECUTING'
  | 'VERIFYING'
  | 'RECOVERING'
  | 'DIAGNOSING'
  | 'TRYING_ALTERNATIVE'
  | 'ENGINEERING_REPAIR'
  | 'TESTING_REPAIR'
  | 'DEPLOYING_REPAIR'
  | 'RETRYING_ORIGINAL_GOAL'
  | 'INDEPENDENT_VERIFICATION'
  | 'AWAITING_APPROVAL'
  | 'COMPLETED'
  | 'BLOCKED_EXTERNAL'
  | 'FAILED_EXHAUSTED'
  | 'RECOVERABLE'
  | 'CANCELLED';

export interface GoalEvidence {
  id: string;
  type: 'process' | 'window' | 'url' | 'dom' | 'db_state' | 'file' | 'stdout' | 'screenshot' | 'audit_log' | 'visual_frame' | 'location_coordinates' | 'machine_verification';
  label: string;
  value: any;
  source: string;
  timestamp: string;
  verified: boolean;
}

export interface GoalAttempt {
  attemptNumber: number;
  strategy: string;
  surface: string; // 'internal' | 'tool' | 'start_menu' | 'executable' | 'app_user_model_id' | 'process' | 'browser' | 'shell' | 'engineering'
  target: string;
  parameters?: Record<string, any>;
  startedAt: string;
  completedAt?: string;
  executed: boolean;
  verified: boolean;
  evidence: GoalEvidence[];
  error?: string;
}

export interface GoalFailure {
  attemptNumber: number;
  strategy: string;
  reason: string;
  failureDomain: 'operational' | 'environment' | 'target_not_found' | 'capability_missing' | 'code_defect' | 'timeout';
  rawError?: string;
  timestamp: string;
  evidence: GoalEvidence[];
}

export interface GoalVerification {
  verified: boolean;
  method: string;
  expectedState: any;
  actualState: any;
  evidence: GoalEvidence[];
  verifier: string; // e.g. 'UniversalVerifier' | 'Argus' | 'ProcessWatcher'
  timestamp: string;
  summary: string;
}

export interface LearnedResolution {
  target: string;
  goalType: string;
  successfulStrategy: string;
  surface: string;
  executablePath?: string;
  resolvedCommand?: string;
  url?: string;
  parameters?: Record<string, any>;
  verificationMethod: string;
  confidence: number;
  learnedAt: string;
}

export interface GoalTimelineEvent {
  timestamp: string;
  state: GoalStatus;
  actor: 'Jarvis' | 'Hermes' | 'ControlPlane' | 'UniversalVerifier' | 'RecoveryWatchdog' | 'Argus' | 'EngineeringWorker' | 'User' | 'UserCorrection';
  summary: string;
  detail?: any;
}

export interface GoalPlanStep {
  stepIndex: number;
  description: string;
  capability: string;
  target: string;
  parameters?: Record<string, any>;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped';
}

export interface GoalPlan {
  goalId: string;
  summary: string;
  steps: GoalPlanStep[];
  selectedSurface: string;
  estimatedEffort?: string;
  confidence: number;
}

export interface GoalRun {
  goalId: string;
  conversationId: string;
  turnId?: string;
  originalUserInput: string;
  normalizedGoal: string;
  target?: string;
  status: GoalStatus;
  state?: GoalStatus;
  plan?: GoalPlan;
  attempts: GoalAttempt[];
  currentAttempt: number;
  capabilitiesUsed: string[];
  evidence: GoalEvidence[];
  failures: GoalFailure[];
  recoveryIncidentId?: string;
  finalVerification?: GoalVerification;
  verification?: GoalVerification;
  learnedResolution?: LearnedResolution;
  timeline: GoalTimelineEvent[];
  acknowledgementText?: string;
  finalResponseText?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RepositoryAuthorityStatus {
  repositoryRoot: string;
  gitRoot: string;
  branch: string;
  commit: string;
  dirtyState: boolean;
  buildCommands: string[];
  testCommands: string[];
  deploymentTarget: string;
  deploymentMethod: string;
  runtimeRestartMethod: string;
  health: {
    healthy: boolean;
    status: 'VALID' | 'DEGRADED' | 'INVALID';
    reason?: string;
    checkedAt: string;
  };
}

export interface DiscoveredCapability {
  id: string;
  name: string;
  surface: 'internal' | 'tool' | 'start_menu' | 'desktop' | 'executable' | 'app_user_model_id' | 'process' | 'browser' | 'filesystem' | 'shell' | 'learned' | 'camera' | 'location' | 'taskbar' | 'desktop_observe' | 'screenshot';
  target: string;
  executablePath?: string;
  shortcutPath?: string;
  url?: string;
  appUserModelId?: string;
  processName?: string;
  score: number;
  parameters?: Record<string, any>;
  description: string;
}
