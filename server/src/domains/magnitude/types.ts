export type MagnitudeRunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'stopped';

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
  | 'magnitude_completed'
  | 'magnitude_failed'
  | 'magnitude_stopped';

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
