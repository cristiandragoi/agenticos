import { logger } from '../utils/logger.js';
import { eventBus } from '../core/eventBus.js';
export class BaseConnector {
    sourceName;
    constructor(sourceName) {
        this.sourceName = sourceName;
    }
    /**
     * Ingests a raw webhook payload, normalizes it, and publishes it to the Event Bus.
     */
    async ingest(rawPayload) {
        const event = this.normalizeEvent(rawPayload);
        if (!event) {
            logger.warn(`[Connector:${this.sourceName}] Ignored raw payload or failed to normalize.`);
            return;
        }
        try {
            await eventBus.publish(event);
            logger.info(`[Connector:${this.sourceName}] Ingested and published event: ${event.eventType}`);
        }
        catch (err) {
            logger.error(`[Connector:${this.sourceName}] Failed to publish normalized event`, err);
        }
    }
}
