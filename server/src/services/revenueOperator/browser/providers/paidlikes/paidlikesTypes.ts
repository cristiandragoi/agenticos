/**
 * Types and data models for PaidLikes Browser Revenue Provider.
 */

export const SUPPORTED_CANARY_TASK_TYPES = [
  'PAIDLIKES_YOUTUBE_LIKE',
  'PAIDLIKES_YOUTUBE_SUBSCRIBE',
  'PAIDLIKES_WEBSITE_VISIT',
] as const;

export type SupportedPaidLikesTaskType = typeof SUPPORTED_CANARY_TASK_TYPES[number];

export interface PaidLikesRawTask {
  id: string;
  platform: 'youtube' | 'facebook' | 'instagram' | 'tiktok' | 'web' | 'unknown';
  actionType: string;
  points: number;
  rewardEur: number;
  targetUrl: string;
  providerTaskUrl?: string;
  actionSelector?: string;
  metadata?: Record<string, unknown>;
}

export interface PaidLikesNormalizedTask {
  externalTaskId: string;
  taskType: SupportedPaidLikesTaskType;
  targetPlatform: string;
  points: number;
  rewardEur: number;
  targetUrl: string;
  providerTaskUrl: string;
  actionSelector: string;
  metadata: Record<string, unknown>;
}

export interface PaidLikesSessionStatus {
  isAuthenticated: boolean;
  username?: string;
  pointsBalance?: number;
  eurBalance?: number;
  captchaDetected: boolean;
  challengeDetected: boolean;
  reason?: string;
}

export interface PaidLikesVerificationResult {
  verified: boolean;
  externalActionVerified: boolean;
  providerAccepted: boolean;
  rewardVerified: boolean;
  earnedEur: number;
  earnedPoints?: number;
  previousBalanceEur?: number;
  newBalanceEur?: number;
  reason?: string;
}

export const PAIDLIKES_POINTS_TO_EUR_RATE = 0.02; // 1 Punkt = 0.02 € (500 Punkte = 10,00 €)
