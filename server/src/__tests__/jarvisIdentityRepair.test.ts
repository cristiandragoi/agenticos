import { describe, it, expect, vi } from 'vitest';
const state = vi.hoisted(() => ({ records: [] as any[] }));
vi.mock('../services/memory/store.js', () => ({ memoryStore: {
 list: ({scope}: any) => { const items = state.records.filter(r => r.scope === scope); return {items, total: items.length}; },
 update: (id: string, patch: any) => Object.assign(state.records.find(r => r.id === id), patch),
} }));
vi.mock('../services/memory/distill.js', () => ({createMemory: (r: any) => state.records.push({...r, id: String(state.records.length)})}));
vi.mock('../services/projectsStore.js', () => ({projectsStore: {}}));
vi.mock('../domains/jarvis/projectMemory.js', () => ({retrieveProjectMemory: vi.fn()}));
import { resolvePreferredNameTurn, getUserWorkingProfile } from '../domains/jarvis/coreMemory.js';
describe('durable human identity', () => {
 it('migrates role defaults and preserves unrelated preferences', () => {
 state.records.push({id:'legacy', scope:'user:profile', content: JSON.stringify({preferredName:'Operator', workingPreferences:['keep this']})});
 expect(getUserWorkingProfile().preferredName).toBe('Christian');
 expect(getUserWorkingProfile().workingPreferences).toEqual(['keep this']);
 });
 it('records an explicit correction and resolves it on a later turn', () => {
 expect(resolvePreferredNameTurn('My name is Christian, not operator.')).toBe("I'll call you Christian.");
 expect(resolvePreferredNameTurn('What is my name?')).toBe('Your preferred address is Christian.');
 expect(resolvePreferredNameTurn('Check Revenue Operator.')).toBeNull();
 expect(getUserWorkingProfile().preferredName).toBe('Christian');
 });
});
