export type MagnitudeRunStatus = 'queued' | 'running' | 'waiting_for_approval' | 'completed' | 'failed' | 'stopped';

export type MagnitudeEventType =
  | 'magnitude_started'
  | 'browser_launch_started'
  | 'browser_launched'
  | 'navigation_started'
  | 'navigation_completed'
  | 'inspection_started'
  | 'inspection_completed'
  | 'screenshot_captured'
  | 'screenshot_failed'
  | 'action_started'
  | 'action_completed'
  | 'approval_requested'
  | 'approval_granted'
  | 'approval_rejected'
  | 'magnitude_completed'
  | 'magnitude_failed'
  | 'magnitude_stopped';

export type RiskLevel = 'read_only' | 'low' | 'medium' | 'high';
export type ApprovalStatus = 'not_required' | 'pending' | 'approved' | 'rejected';

export interface MagnitudeApprovalRequest {
  id: string;
  runId: string;
  targetUrl: string;
  actionType: 'click' | 'fill' | 'navigate' | 'download' | 'submit';
  description: string;
  riskLevel: RiskLevel;
  status: ApprovalStatus;
  createdAt: string;
  respondedAt?: string;
  responder?: string;
  reason?: string;
}

export interface MagnitudeEvent {
  id: string;
  runId: string;
  sequence: number;
  timestamp: string;
  type: MagnitudeEventType;
  message: string;
  details?: any;
}

export interface MagnitudeInspectResult {
  url: string;
  finalUrl: string;
  title: string;
  text: string;
  metaDescription?: string;
  linksCount?: number;
  durationMs: number;
  actionSummary?: string;
  /** PHASE MAGNITUDE (A4/A5): screenshot evidence path (relative to data dir)
   *  and byte size. Persisted with the run so evidence is project-owned. */
  screenshotPath?: string;
  screenshotBytes?: number;
}

export interface MagnitudeRunRecord {
  id: string;
  goal: string;
  requestedUrl: string;
  actionType: 'inspect' | 'click' | 'search';
  status: MagnitudeRunStatus;
  approval?: MagnitudeApprovalRequest;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  result?: MagnitudeInspectResult;
  error?: string;
  events: MagnitudeEvent[];
  conversationId?: string;
  /** PHASE MAGNITUDE (A5): canonical provenance — project/task/run ids so
   *  browser evidence can never bleed between projects. */
  projectId?: string;
  projectTaskId?: string;
  executionRunId?: string;
  scheduleExecutionId?: string;
}
