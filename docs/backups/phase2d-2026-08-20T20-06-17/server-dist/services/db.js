import { logger } from '../utils/logger.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { JsonStore } from './store.js';
import { createClient } from '@supabase/supabase-js';
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
export const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;
class SupabaseStore {
    tableName;
    constructor(tableName) {
        this.tableName = tableName;
    }
    async list() {
        const { data, error } = await supabase.from(this.tableName).select('*');
        if (error)
            throw error;
        return data;
    }
    async get(id) {
        const { data, error } = await supabase.from(this.tableName).select('*').eq('id', id).single();
        if (error && error.code !== 'PGRST116')
            throw error;
        return data || undefined;
    }
    async upsert(item) {
        const { error } = await supabase.from(this.tableName).upsert(item);
        if (error)
            throw error;
    }
}
class AsyncJsonStoreAdapter {
    store;
    constructor(store) {
        this.store = store;
    }
    async list() { return this.store.list(); }
    async get(id) { return this.store.get(id); }
    async upsert(item) { this.store.upsert(item); }
}
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(__dirname, '../../data');
logger.info('[DB Path Debug] Resolving dataDir to:', dataDir);
import { mockAgents, mockRuntimes, mockProviders, mockMemoryScopes, mockMemoryEntries, mockBoards, mockTools } from '../data.js';
class DatabaseRegistry {
    agents = new JsonStore(path.join(dataDir, 'agents.json'));
    runtimes = new JsonStore(path.join(dataDir, 'runtimes.json'));
    providers = new JsonStore(path.join(dataDir, 'providers.json'));
    memoryScopes = new JsonStore(path.join(dataDir, 'memoryScopes.json'));
    memoryEntries = new JsonStore(path.join(dataDir, 'memoryEntries.json'));
    boards = new JsonStore(path.join(dataDir, 'boards.json'));
    tools = new JsonStore(path.join(dataDir, 'tools.json'));
    researchBriefs = new JsonStore(path.join(dataDir, 'researchBriefs.json'));
    // Production Async Stores
    leads = supabase
        ? new SupabaseStore('leads')
        : new AsyncJsonStoreAdapter(new JsonStore(path.join(dataDir, 'leads.json')));
    stripeEvents = supabase
        ? new SupabaseStore('stripeEvents')
        : new AsyncJsonStoreAdapter(new JsonStore(path.join(dataDir, 'stripeEvents.json')));
    artifacts = supabase
        ? new SupabaseStore('artifacts')
        : new AsyncJsonStoreAdapter(new JsonStore(path.join(dataDir, 'artifacts.json')));
    init() {
        // Seed data if files were just created and are empty
        if (this.agents.list().length === 0)
            mockAgents.forEach(a => this.agents.upsert(a));
        if (this.runtimes.list().length === 0)
            mockRuntimes.forEach(r => this.runtimes.upsert(r));
        if (this.providers.list().length === 0)
            mockProviders.forEach(p => this.providers.upsert(p));
        if (this.memoryScopes.list().length === 0)
            mockMemoryScopes.forEach(m => this.memoryScopes.upsert(m));
        if (this.memoryEntries.list().length === 0)
            mockMemoryEntries.forEach(m => this.memoryEntries.upsert(m));
        // Skip synchronous artifact seeding since artifacts is now AsyncStore. Production doesn't need mock artifacts.
        if (this.boards.list().length === 0)
            mockBoards.forEach(b => this.boards.upsert(b));
        if (this.tools.list().length === 0)
            mockTools.forEach(t => this.tools.upsert(t));
        logger.info('[DB] Persistent stores initialized and seeded (if empty).');
    }
}
export const db = new DatabaseRegistry();
