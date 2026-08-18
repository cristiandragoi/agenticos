import { logger } from '../utils/logger.js';
import { eventBus, SystemEventPayload } from '../core/eventBus.js';

export abstract class BaseConnector {
  public sourceName: string;

  constructor(sourceName: string) {
    this.sourceName = sourceName;
  }

  /**
   * Subclasses implement this to convert their raw external payload
   * into a canonical SystemEventPayload.
   */
  abstract normalizeEvent(rawPayload: any): SystemEventPayload | null;

  /**
   * Ingests a raw webhook payload, normalizes it, and publishes it to the Event Bus.
   */
  async ingest(rawPayload: any): Promise<void> {
    const event = this.normalizeEvent(rawPayload);
    if (!event) {
      logger.warn(`[Connector:${this.sourceName}] Ignored raw payload or failed to normalize.`);
      return;
    }

    try {
      await eventBus.publish(event);
      logger.info(`[Connector:${this.sourceName}] Ingested and published event: ${event.eventType}`);
    } catch (err) {
      logger.error(`[Connector:${this.sourceName}] Failed to publish normalized event`, err);
    }
  }
}
