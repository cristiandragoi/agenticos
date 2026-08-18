import { describe, expect, it } from 'vitest';
import { intentRouter } from '../domains/jarvis/intentRouter.js';

describe('Jarvis intent routing policy', () => {
  it('explicit do not use CodeX is a hard direct route', async () => {
    const intent = await intentRouter.routeIntent('Do not use CodeX. Which branch is active?');

    expect(intent.route).toBe('direct');
    expect(intent.selectedAgent).toBe('Jarvis');
    expect(intent.reason).toContain('Explicit non-delegation');
  });

  it('answer directly prevents repository analysis delegation', async () => {
    const intent = await intentRouter.routeIntent('Answer directly. Inspect server/src/routers/jarvis.ts.');

    expect(intent.route).toBe('direct');
    expect(intent.requiresWorkspace).toBe(false);
  });

  it('uncertain short prompts default to direct conversation', async () => {
    await expect(intentRouter.routeIntent('hello')).resolves.toMatchObject({ route: 'direct' });
    await expect(intentRouter.routeIntent('Jarvis')).resolves.toMatchObject({ route: 'direct' });
    await expect(intentRouter.routeIntent('what model are you?')).resolves.toMatchObject({ route: 'direct' });
  });

  it('explicit use CodeX creates a CodeX route', async () => {
    const intent = await intentRouter.routeIntent('Use CodeX to inspect the Jarvis router.');

    expect(intent.route).toBe('codex');
    expect(intent.selectedAgent).toBe('CodeX');
    expect(intent.requiresWorkspace).toBe(true);
  });
});
