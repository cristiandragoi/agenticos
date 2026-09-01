import { describe, it, expect } from 'vitest';
import { intentRouter } from '../src/domains/jarvis/intentRouter.js';

describe('Jarvis Model Identity & Intent Routing', () => {
  it('A. "Jarvis, what model are you using?" routes as direct conversation with high confidence', async () => {
    const result = await intentRouter.routeIntent('Jarvis, what model are you using?');
    expect(result.route).toBe('direct');
    expect(result.category).toBe('conversation');
    expect(result.mode).toBe('direct_conversation');
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('B. "what model are you running" routes as direct conversation', async () => {
    const result = await intentRouter.routeIntent('what model are you running');
    expect(result.route).toBe('direct');
    expect(result.category).toBe('conversation');
    expect(result.mode).toBe('direct_conversation');
  });

  it('C. "what is 2 plus 2" routes as direct conversation', async () => {
    const result = await intentRouter.routeIntent('what is 2 plus 2');
    expect(result.route).toBe('direct');
    expect(result.category).toBe('conversation');
    expect(result.mode).toBe('direct_conversation');
  });
});
