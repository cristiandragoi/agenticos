import { randomUUID } from 'crypto';
import { db } from '../../db/index.js';
import { conversations, conversationMessages } from '../../db/schema.js';
import { eq, asc, desc } from 'drizzle-orm';
export class ConversationService {
    // SSE stream clients mapped by conversation ID
    streamClients = new Map();
    async createConversation(title, workspaceId, primaryAgent) {
        const id = `conv-${randomUUID().slice(0, 9)}`;
        const now = new Date().toISOString();
        db.insert(conversations).values({
            id,
            title,
            workspaceId,
            primaryAgent,
            status: 'active',
            createdAt: now,
            updatedAt: now
        }).run();
        return id;
    }
    async getConversation(id) {
        return db.select().from(conversations).where(eq(conversations.id, id)).get();
    }
    async listConversations() {
        // Most-recently-updated first — clients restore data[0] as the active
        // conversation, so ordering is the session-persistence contract.
        return db.select().from(conversations).orderBy(desc(conversations.updatedAt)).all();
    }
    async getMessages(conversationId) {
        return db.select()
            .from(conversationMessages)
            .where(eq(conversationMessages.conversationId, conversationId))
            .orderBy(asc(conversationMessages.createdAt))
            .all();
    }
    async appendMessage(args) {
        const id = `msg-${randomUUID().slice(0, 9)}`;
        const now = new Date().toISOString();
        const sequence = db.select()
            .from(conversationMessages)
            .where(eq(conversationMessages.conversationId, args.conversationId))
            .all().length + 1;
        const message = {
            id,
            conversationId: args.conversationId,
            sequence,
            role: args.role,
            messageType: args.messageType || 'message',
            content: args.content,
            status: args.status,
            routedAgent: args.routedAgent,
            runId: args.runId,
            goalId: args.goalId,
            parentMessageId: args.parentMessageId,
            metadata: args.metadata,
            createdAt: now,
            updatedAt: now
        };
        db.insert(conversationMessages).values(message).run();
        db.update(conversations)
            .set({ updatedAt: now })
            .where(eq(conversations.id, args.conversationId))
            .run();
        // Broadcast
        this.broadcast(args.conversationId, 'message', message);
        return message;
    }
    // --- SSE Streaming Methods ---
    addStreamClient(conversationId, res) {
        if (!this.streamClients.has(conversationId)) {
            this.streamClients.set(conversationId, []);
        }
        this.streamClients.get(conversationId).push(res);
    }
    removeStreamClient(conversationId, res) {
        const clients = this.streamClients.get(conversationId) || [];
        this.streamClients.set(conversationId, clients.filter(c => c !== res));
        if (this.streamClients.get(conversationId).length === 0) {
            this.streamClients.delete(conversationId);
        }
    }
    broadcast(conversationId, event, data) {
        const clients = this.streamClients.get(conversationId) || [];
        clients.forEach(client => {
            try {
                client.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
            }
            catch (err) {
                // Ignored
            }
        });
    }
}
export const conversationService = new ConversationService();
