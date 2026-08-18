import { logger } from '../utils/logger.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { JsonStore } from './store.js';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
export const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

export interface AsyncStore<T extends { id: string }> {
  list(): Promise<T[]>;
  get(id: string): Promise<T | undefined>;
  upsert(item: T): Promise<void>;
}

class SupabaseStore<T extends { id: string }> implements AsyncStore<T> {
  constructor(private tableName: string) {}
  async list(): Promise<T[]> {
    const { data, error } = await supabase!.from(this.tableName).select('*');
    if (error) throw error;
    return data as T[];
  }
  async get(id: string): Promise<T | undefined> {
    const { data, error } = await supabase!.from(this.tableName).select('*').eq('id', id).single();
    if (error && error.code !== 'PGRST116') throw error;
    return data || undefined;
  }
  async upsert(item: T): Promise<void> {
    const { error } = await supabase!.from(this.tableName).upsert(item as any);
    if (error) throw error;
  }
}

class AsyncJsonStoreAdapter<T extends { id: string }> implements AsyncStore<T> {
  constructor(private store: JsonStore<T>) {}
  async list(): Promise<T[]> { return this.store.list(); }
  async get(id: string): Promise<T | undefined> { return this.store.get(id); }
  async upsert(item: T): Promise<void> { this.store.upsert(item); }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(__dirname, '../../data');
logger.info('[DB Path Debug] Resolving dataDir to:', dataDir);

import type { 
  AgentDefinition, 
  Runtime, 
  ProviderDefinition, 
  MemoryScope, 
  MemoryEntry,
  Artifact, 
  Board, 
  ToolDefinition,
  ResearchBrief,
  ServiceLead,
  StripeEventRecord
} from '../types.js';

import {
  mockAgents,
  mockRuntimes,
  mockProviders,
  mockMemoryScopes,
  mockMemoryEntries,
  mockArtifacts,
  mockBoards,
  mockTools
} from '../data.js';

class DatabaseRegistry {
  public agents = new JsonStore<AgentDefinition>(path.join(dataDir, 'agents.json'));
  public runtimes = new JsonStore<Runtime>(path.join(dataDir, 'runtimes.json'));
  public providers = new JsonStore<ProviderDefinition>(path.join(dataDir, 'providers.json'));
  public memoryScopes = new JsonStore<MemoryScope>(path.join(dataDir, 'memoryScopes.json'));
  public memoryEntries = new JsonStore<MemoryEntry>(path.join(dataDir, 'memoryEntries.json'));

  public boards = new JsonStore<Board>(path.join(dataDir, 'boards.json'));
  public tools = new JsonStore<ToolDefinition>(path.join(dataDir, 'tools.json'));
  public researchBriefs = new JsonStore<ResearchBrief>(path.join(dataDir, 'researchBriefs.json'));
  
  // Production Async Stores
  public leads: AsyncStore<ServiceLead> = supabase 
    ? new SupabaseStore('leads') 
    : new AsyncJsonStoreAdapter(new JsonStore<ServiceLead>(path.join(dataDir, 'leads.json')));
    
  public stripeEvents: AsyncStore<StripeEventRecord> = supabase 
    ? new SupabaseStore('stripeEvents') 
    : new AsyncJsonStoreAdapter(new JsonStore<StripeEventRecord>(path.join(dataDir, 'stripeEvents.json')));
    
  public artifacts: AsyncStore<Artifact> = supabase 
    ? new SupabaseStore('artifacts') 
    : new AsyncJsonStoreAdapter(new JsonStore<Artifact>(path.join(dataDir, 'artifacts.json')));

  public init() {
    // Seed data if files were just created and are empty
    if (this.agents.list().length === 0) mockAgents.forEach(a => this.agents.upsert(a));
    if (this.runtimes.list().length === 0) mockRuntimes.forEach(r => this.runtimes.upsert(r));
    if (this.providers.list().length === 0) mockProviders.forEach(p => this.providers.upsert(p));
    if (this.memoryScopes.list().length === 0) mockMemoryScopes.forEach(m => this.memoryScopes.upsert(m));
    if (this.memoryEntries.list().length === 0) mockMemoryEntries.forEach(m => this.memoryEntries.upsert(m));
    // Skip synchronous artifact seeding since artifacts is now AsyncStore. Production doesn't need mock artifacts.
    if (this.boards.list().length === 0) mockBoards.forEach(b => this.boards.upsert(b));
    if (this.tools.list().length === 0) mockTools.forEach(t => this.tools.upsert(t));
    logger.info('[DB] Persistent stores initialized and seeded (if empty).');
  }
}

export const db = new DatabaseRegistry();
