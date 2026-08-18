/**
 * STORE vs RECALL memory semantics + relevant-preference retrieval
 * (user-acceptance stabilization).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { memoryStore } from '../services/memory/store.js';
import { seedDecisions } from '../services/memory/distill.js';
import { isMemoryStore, handleMemoryStore, retrieveRelevantPreferences } from '../domains/jarvis/memoryRecall.js';

describe('STORE-memory semantics', () => {
  beforeEach(() => { seedDecisions(); });

  it('recognizes STORE requests', () => {
    for (const s of [
      'Please remember that my favorite color is teal',
      'Please remember my favorite color is teal',
      'Remember that I prefer dark mode',
      'From now on remember my email is x@example.com',
      'Remember my dog is called Rex',
    ]) {
      expect(isMemoryStore(s)).toBe(true);
    }
  });

  it('never treats RECALL forms as STORE', () => {
    for (const s of [
      'Do you remember what model we chose?',
      'What do you remember about Kadabau?',
      'What happened in our last Berlin roofing search?',
      'What did I say about the database design?',
      'Did you remember to run the tests?',
    ]) {
      expect(isMemoryStore(s)).toBe(false);
    }
  });

  it('persists the extracted fact as a preference memory with truthful wording', () => {
    const { reply, memoryId } = handleMemoryStore('Please remember that my favorite color is teal');
    expect(reply).toContain("I've saved that to memory: my favorite color is teal");
    expect(reply).toContain('preference memory');
    const m = memoryStore.get(memoryId);
    expect(m?.type).toBe('preference');
    expect(m?.title).toContain('favorite color is teal');
    expect(m?.scope).toBe('user');
    expect(m?.status).toBe('active');
    // cleanup
    memoryStore.remove(memoryId);
  });

  it('drops the "for this conversation" tail so the stored fact is clean', () => {
    const { reply } = handleMemoryStore('Please remember that my favorite color is teal for this conversation');
    expect(reply).toContain('my favorite color is teal');
    expect(reply).not.toContain('for this conversation');
  });

  it('retrieves the relevant preference for a NEW-conversation question, and never episodic revenue memories', async () => {
    const { memoryId } = handleMemoryStore('Please remember that my favorite color is teal');
    try {
      const hits = retrieveRelevantPreferences('What is my favorite color?', 3);
      expect(hits.length).toBeGreaterThan(0);
      expect(hits.some((h) => h.title.includes('favorite color'))).toBe(true);
      // episodic revenue records are excluded from the injection surface
      for (const h of hits) {
        expect(h.type).not.toBe('episodic');
      }
      // unrelated question returns nothing relevant
      const none = retrieveRelevantPreferences('How does the gateway route requests?', 3);
      expect(none.some((h) => h.title.includes('favorite color'))).toBe(false);
    } finally {
      memoryStore.remove(memoryId);
    }
  });
});
