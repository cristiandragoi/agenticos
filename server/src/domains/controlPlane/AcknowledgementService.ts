/**
 * AcknowledgementService.ts — Immediate Goal Acknowledgment
 *
 * Implements Section 2:
 * Immediately acknowledges the actionable command to the user ("Okay, opening X now")
 * before heavy execution/discovery begins.
 * Clearly separates ACKNOWLEDGED from EXECUTED, VERIFIED, and COMPLETED.
 */

export class AcknowledgementService {
  private static instance: AcknowledgementService;

  private constructor() {}

  public static getInstance(): AcknowledgementService {
    if (!AcknowledgementService.instance) {
      AcknowledgementService.instance = new AcknowledgementService();
    }
    return AcknowledgementService.instance;
  }

  /**
   * Produce an immediate acknowledgment string based on normalized goal and target.
   */
  public generateAcknowledgement(input: string, target?: string): string {
    const clean = input.trim().replace(/[.!?]+$/, '');

    // Camera perception
    if (/\b(?:can you see me|see me|look at this|what am i holding|what is this|what do you see)\b/i.test(clean)) {
      return 'Okay, inspecting camera frame now.';
    }

    // Location access
    if (/\b(?:where am i|what is my location|what's my location|where is this)\b/i.test(clean)) {
      return 'Okay, checking your current location now.';
    }

    // "Open X" -> "Okay, opening X now."
    const openMatch = clean.match(/^(?:can you\s+|please\s+)?(?:open|launch|start|run|show)\s+(.+)$/i);
    if (openMatch) {
      const entity = openMatch[1].trim();
      return `Okay, opening ${entity} now.`;
    }

    // "Locate Julian Goldy SEO on YouTube" -> "Okay, locating Julian Goldy SEO on YouTube now."
    const searchMatch = clean.match(/^(?:can you\s+|please\s+)?(?:locate|find|search\s+for)\s+(.+)$/i);
    if (searchMatch) {
      const entity = searchMatch[1].trim();
      return `Okay, searching for ${entity} now.`;
    }

    // "Rename X to Y" -> "Okay, renaming X to Y now."
    const renameMatch = clean.match(/^(?:can you\s+|please\s+)?(?:rename|change(?:\s+the\s+name\s+of)?)\s+(.+?)\s+to\s+(.+)$/i);
    if (renameMatch) {
      return `Okay, renaming ${renameMatch[1].trim()} now.`;
    }

    // "Create X" -> "Okay, creating X now."
    const createMatch = clean.match(/^(?:can you\s+|please\s+)?(?:create|make|build|add)\s+(.+)$/i);
    if (createMatch) {
      return `Okay, creating ${createMatch[1].trim()} now.`;
    }

    if (target) {
      return `Okay, working on ${target} now.`;
    }

    return `Okay, working on that now.`;
  }

  /**
   * Produce a truthful completion response ONLY after verification succeeds.
   */
  public generateCompletionMessage(target: string, surface: string, action: string = 'open'): string {
    switch (surface) {
      case 'browser':
        return `${target} is open.`;
      case 'process':
      case 'executable':
      case 'start_menu':
      case 'app_user_model_id':
      case 'desktop':
        return `${target} is open.`;
      case 'internal':
        return `${target} completed successfully.`;
      default:
        return `${target} completed and verified.`;
    }
  }
}

export const acknowledgementService = AcknowledgementService.getInstance();
