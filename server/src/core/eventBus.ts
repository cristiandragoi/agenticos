import { logger } from '../utils/logger.js';
import { EventEmitter } from 'events';
import { db } from '../db/index.js';
import { systemEvents } from '../db/schema.js';

import crypto from 'crypto';
import { eq } from 'drizzle-orm';

export type SystemEventType = 
  | 'video_view' 
  | 'video_complete' 
  | 'click' 
  | 'cart' 
  | 'purchase' 
  | 'refund' 
  | 'affiliate_commission'
  | 'campaign_started' 
  | 'campaign_paused' 
  | 'campaign_finished' 
  | 'asset_published' 
  | 'asset_deleted' 
  | 'compliance_warning'
  | 'cost_incurred'
  | 'llm_output_received'
  | 'llm_schema_validation_failed'
  | 'llm_schema_repair_started'
  | 'llm_schema_repair_completed'
  | 'llm_schema_repair_failed';

export interface SystemEventPayload {
  id?: string;
  eventType: SystemEventType;
  source: string;
  payload: Record<string, any>;
  timestamp?: string;
}

class EventBus extends EventEmitter {
  constructor() {
    super();
    // Increase limit if many subsystems subscribe
    this.setMaxListeners(20);
  }

  /**
   * Publishes an event to the bus.
   * 1. Persists the event to the system_events ledger.
   * 2. Broadcasts the event to all internal memory subscribers.
   */
  async publish(event: SystemEventPayload): Promise<string> {
    const eventId = event.id || `evt_${crypto.randomUUID()}`;
    const timestamp = event.timestamp || new Date().toISOString();

    try {
      // 1. Persist
      await db.insert(systemEvents).values({
        id: eventId,
        eventType: event.eventType,
        source: event.source,
        payload: event.payload,
        timestamp,
        createdAt: new Date().toISOString(),
        processed: false
      });
      
      // 2. Broadcast
      const fullEvent = { ...event, id: eventId, timestamp };
      this.emit(event.eventType, fullEvent);
      this.emit('*', fullEvent); // Broadcast to wildcard listeners

      return eventId;
    } catch (err) {
      logger.error(`[EventBus] Failed to publish event ${eventId}`, err);
      throw err;
    }
  }

  /**
   * Mark an event as processed in the database
   */
  async markProcessed(eventId: string) {
    try {
      await db.update(systemEvents)
        .set({ processed: true })
        .where(eq(systemEvents.id, eventId));
    } catch (err) {
      logger.error(`[EventBus] Failed to mark event ${eventId} as processed`, err);
    }
  }
}

export const eventBus = new EventBus();
