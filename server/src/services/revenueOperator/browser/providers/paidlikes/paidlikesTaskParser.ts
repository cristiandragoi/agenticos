/**
 * Parser and normalizer for PaidLikes task listings.
 * Validates tasks against a strict canary allowlist and rejects
 * ambiguous or unsupported tasks deterministically.
 */

import {
  type PaidLikesNormalizedTask,
  type PaidLikesRawTask,
  type SupportedPaidLikesTaskType,
  SUPPORTED_CANARY_TASK_TYPES,
  PAIDLIKES_POINTS_TO_EUR_RATE,
} from './paidlikesTypes.js';

export interface ParseTaskResult {
  success: boolean;
  task?: PaidLikesNormalizedTask;
  unsupportedReason?: string;
  rawType?: string;
}

export class PaidLikesTaskParser {
  /**
   * Parse points string or number into numeric points value.
   * e.g. "2 Punkte", "1 Punkt", "3.0", 2 -> 2
   */
  static parsePoints(input: string | number | undefined | null): number {
    if (typeof input === 'number') {
      return isNaN(input) || input < 0 ? 0 : input;
    }
    if (!input || typeof input !== 'string') {
      return 0;
    }
    const clean = input.replace(',', '.');
    const match = clean.match(/(\d+(?:\.\d+)?)/);
    if (!match) return 0;
    const parsed = parseFloat(match[1]);
    return isNaN(parsed) ? 0 : parsed;
  }

  /**
   * Convert points to EUR amount.
   */
  static pointsToEur(points: number): number {
    return Math.round(points * PAIDLIKES_POINTS_TO_EUR_RATE * 100) / 100;
  }

  /**
   * Classify target URL / action text into a task type.
   */
  static classifyTaskType(raw: {
    platform?: string;
    actionText?: string;
    targetUrl?: string;
    title?: string;
  }): {
    supported: boolean;
    taskType?: SupportedPaidLikesTaskType;
    reason?: string;
    rawType: string;
  } {
    const text = `${raw.platform || ''} ${raw.actionText || ''} ${raw.title || ''} ${raw.targetUrl || ''}`.toLowerCase();
    const url = (raw.targetUrl || '').toLowerCase();

    // 1. YouTube Like
    if (
      (url.includes('youtube.com/watch') || url.includes('youtu.be/')) &&
      (text.includes('like') || text.includes('gefällt mir') || text.includes('daumen'))
    ) {
      return {
        supported: true,
        taskType: 'PAIDLIKES_YOUTUBE_LIKE',
        rawType: 'youtube_like',
      };
    }

    // 2. YouTube Subscribe
    if (
      (url.includes('youtube.com/channel') || url.includes('youtube.com/@') || url.includes('youtube.com/c/')) &&
      (text.includes('abonnier') || text.includes('subscribe') || text.includes('abo'))
    ) {
      return {
        supported: true,
        taskType: 'PAIDLIKES_YOUTUBE_SUBSCRIBE',
        rawType: 'youtube_subscribe',
      };
    }

    // Generic YouTube with ambiguous action -> classify by URL structure
    if (url.includes('youtube.com/watch') || url.includes('youtu.be/')) {
      return {
        supported: true,
        taskType: 'PAIDLIKES_YOUTUBE_LIKE',
        rawType: 'youtube_video_like',
      };
    }

    if (url.includes('youtube.com/@') || url.includes('youtube.com/channel/')) {
      return {
        supported: true,
        taskType: 'PAIDLIKES_YOUTUBE_SUBSCRIBE',
        rawType: 'youtube_channel_sub',
      };
    }

    // 3. Website Visit
    if (
      (text.includes('webseite') || text.includes('besuchen') || text.includes('visit') || text.includes('surfen')) &&
      url.startsWith('http') &&
      !url.includes('facebook.com') &&
      !url.includes('instagram.com') &&
      !url.includes('tiktok.com')
    ) {
      return {
        supported: true,
        taskType: 'PAIDLIKES_WEBSITE_VISIT',
        rawType: 'website_visit',
      };
    }

    // Explicitly reject unsupported platform tasks
    if (url.includes('facebook.com') || text.includes('facebook')) {
      return {
        supported: false,
        reason: 'UNSUPPORTED_TASK_TYPE: Facebook tasks are disabled in canary mode',
        rawType: 'facebook_like',
      };
    }

    if (url.includes('instagram.com') || text.includes('instagram')) {
      return {
        supported: false,
        reason: 'UNSUPPORTED_TASK_TYPE: Instagram tasks are disabled in canary mode',
        rawType: 'instagram_follow',
      };
    }

    if (url.includes('tiktok.com') || text.includes('tiktok')) {
      return {
        supported: false,
        reason: 'UNSUPPORTED_TASK_TYPE: TikTok tasks are disabled in canary mode',
        rawType: 'tiktok_task',
      };
    }

    if (text.includes('umfrage') || text.includes('survey')) {
      return {
        supported: false,
        reason: 'UNSUPPORTED_TASK_TYPE: Surveys require subjective input and are disabled',
        rawType: 'survey',
      };
    }

    return {
      supported: false,
      reason: 'UNSUPPORTED_TASK_TYPE: Ambiguous or unknown task category',
      rawType: 'unknown',
    };
  }

  /**
   * Normalizes a raw task into a validated PaidLikesNormalizedTask.
   * If the task is unsupported or malformed, returns success: false with reason.
   */
  static normalizeTask(raw: PaidLikesRawTask): ParseTaskResult {
    if (!raw.id || !raw.targetUrl) {
      return {
        success: false,
        unsupportedReason: 'MALFORMED_TASK: Missing required external ID or target URL',
        rawType: 'invalid',
      };
    }

    const classification = this.classifyTaskType({
      platform: raw.platform,
      actionText: raw.actionType,
      targetUrl: raw.targetUrl,
    });

    if (!classification.supported || !classification.taskType) {
      return {
        success: false,
        unsupportedReason: classification.reason || 'UNSUPPORTED_TASK_TYPE',
        rawType: classification.rawType,
      };
    }

    const points = this.parsePoints(raw.points);
    const rewardEur = raw.rewardEur > 0 ? raw.rewardEur : this.pointsToEur(points);

    const task: PaidLikesNormalizedTask = {
      externalTaskId: String(raw.id).trim(),
      taskType: classification.taskType,
      targetPlatform: raw.platform || 'youtube',
      points,
      rewardEur,
      targetUrl: raw.targetUrl.trim(),
      providerTaskUrl: raw.providerTaskUrl || 'https://www.paidlikes.de/mitglieder/aktionen',
      actionSelector: raw.actionSelector || 'button.like-btn',
      metadata: raw.metadata || {},
    };

    return {
      success: true,
      task,
    };
  }

  /**
   * Parse task card element extracted from HTML or DOM snippet.
   */
  static parseFromHtml(snippet: string): ParseTaskResult {
    // Extract task ID (e.g. data-id="12345" or data-task-id="12345" or id="task-12345")
    const idMatch = snippet.match(/data-(?:task-)?id=["']([^"']+)["']/i) || snippet.match(/id=["']task[-_]?(\d+)["']/i);
    const id = idMatch ? idMatch[1] : '';

    // Extract target URL (href="..." or data-url="...")
    const urlMatch = snippet.match(/href=["'](https?:\/\/[^"']+)["']/i) || snippet.match(/data-url=["'](https?:\/\/[^"']+)["']/i);
    const targetUrl = urlMatch ? urlMatch[1] : '';

    // Extract points (e.g. "2 Punkte", "3 Punkte", "1 Punkt", data-points="2")
    const pointsMatch = snippet.match(/data-points=["']([^"']+)["']/i) || snippet.match(/(\d+(?:[.,]\d+)?)\s*Punkte?/i);
    const points = pointsMatch ? this.parsePoints(pointsMatch[1]) : 1;

    // Extract text description
    const textMatch = snippet.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

    return this.normalizeTask({
      id,
      platform: targetUrl.includes('youtube') ? 'youtube' : 'unknown',
      actionType: textMatch,
      points,
      rewardEur: this.pointsToEur(points),
      targetUrl,
      providerTaskUrl: 'https://www.paidlikes.de/mitglieder/aktionen',
    });
  }
}
