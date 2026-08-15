export type MagnitudeRunStatus = 'queued' | 'running' | 'waiting_for_approval' | 'completed' | 'failed' | 'stopped';

export type MagnitudeEventType =
  | 'magnitude_started'
  | 'browser_launch_started'
  | 'browser_launched'
  | 'navigation_started'
  | 'navigation_completed'
  | 'inspection_started'
  | 'inspection_completed'
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
}
