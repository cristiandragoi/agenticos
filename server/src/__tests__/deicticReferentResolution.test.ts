import { describe, it, expect, beforeEach } from 'vitest';
import { activeInteractionContextStore } from '../domains/jarvis/activeInteractionContext.js';
import { referentResolver } from '../domains/jarvis/execution/referentResolver.js';

describe('Deictic Referent Resolution Pipeline', () => {
  const convId = 'test-conv-deictic-' + Date.now();

  beforeEach(() => {
    // Reset to clean default context
    activeInteractionContextStore.update(convId, {
      activeCapability: 'browser',
      activePageUrl: 'https://www.youtube.com/results?search_query=seeadler+tv',
      activePageTitle: 'seeadler tv - YouTube',
      currentDomain: 'youtube.com',
      currentIntent: 'search',
      currentEntity: {
        type: 'channel',
        name: 'SEEADLER TV',
        url: 'https://www.youtube.com/@SEEADLERTV',
      },
      lastSearchQuery: 'seeadler tv',
      lastSearchResults: [
        {
          index: 0,
          type: 'channel',
          title: 'SEEADLER TV',
          href: 'https://www.youtube.com/@SEEADLERTV',
          visibleText: 'SEEADLER TV 50K subscribers',
        },
        {
          index: 1,
          type: 'video',
          title: 'SEEADLER TV Live Stream',
          href: 'https://www.youtube.com/watch?v=abc1234',
          visibleText: 'SEEADLER TV Live Stream',
        },
      ],
      lastSelectedResult: null,
      latestResolvedReferent: null,
      referencedEntities: [],
      navigationHistory: [
        {
          url: 'https://www.youtube.com',
          title: 'YouTube',
          timestamp: Date.now() - 10000,
        },
        {
          url: 'https://www.youtube.com/results?search_query=seeadler+tv',
          title: 'seeadler tv - YouTube',
          timestamp: Date.now() - 5000,
        },
      ],
    });
  });

  it('Turn 8 to Turn 9 sequence: "Find their website" records latestResolvedReferent, "Open it" navigates to that exact website', () => {
    // Turn 8 sets latestResolvedReferent in ActiveInteractionContext
    const externalUrl = 'https://www.bitchute.com/channel/seeadler-tv/';
    activeInteractionContextStore.setLatestReferent(convId, {
      type: 'website',
      entity: 'SEEADLER TV website',
      url: externalUrl,
      sourceTurn: 8,
      actionable: true,
      timestamp: Date.now(),
    });

    // Verify persistence in store
    const storedReferent = activeInteractionContextStore.getLatestReferent(convId);
    expect(storedReferent).not.toBeNull();
    expect(storedReferent?.url).toBe(externalUrl);
    expect(storedReferent?.entity).toBe('SEEADLER TV website');

    // Turn 9: User says "Open it."
    const res1 = referentResolver.resolve('Open it.', convId);
    expect(res1.kind).toBe('direct_action');
    expect(res1.action).toBe('navigate_url');
    expect(res1.parameters?.url).toBe(externalUrl);

    // User says "Open that"
    const res2 = referentResolver.resolve('Open that', convId);
    expect(res2.kind).toBe('direct_action');
    expect(res2.action).toBe('navigate_url');
    expect(res2.parameters?.url).toBe(externalUrl);

    // User says "Open the website"
    const res3 = referentResolver.resolve('Open the website', convId);
    expect(res3.kind).toBe('direct_action');
    expect(res3.action).toBe('navigate_url');
    expect(res3.parameters?.url).toBe(externalUrl);
  });

  it('Turn 6: "Pause it" resolves to pause_media directly', () => {
    const res = referentResolver.resolve('Pause it.', convId);
    expect(res.kind).toBe('direct_action');
    expect(res.action).toBe('pause_media');
  });

  it('Media resume: "Resume it" / "Play it" resolves to play_media', () => {
    const res1 = referentResolver.resolve('Resume it', convId);
    expect(res1.kind).toBe('direct_action');
    expect(res1.action).toBe('play_media');

    const res2 = referentResolver.resolve('Play it', convId);
    expect(res2.kind).toBe('direct_action');
    expect(res2.action).toBe('play_media');
  });

  it('Turn 10: "Go back to YouTube" resolves to navigate with YouTube navigation history entry', () => {
    const res = referentResolver.resolve('Go back to YouTube', convId);
    expect(res.kind).toBe('direct_action');
    expect(res.action).toBe('navigate');
    expect(res.target).toBe('YouTube');
    expect(res.parameters?.url).toContain('youtube.com');
  });

  it('Ordinals: "The second one" resolves to index 1', () => {
    const res = referentResolver.resolve('The second one', convId);
    expect(res.kind).toBe('direct_action');
    expect(res.action).toBe('open_result_index');
    expect(res.parameters?.index).toBe(1);
    expect(res.target).toBe('SEEADLER TV Live Stream');
  });

  it('Ordinals: "No, the other one" switches from current index', () => {
    // Select index 0 first
    activeInteractionContextStore.selectResult(convId, 0);

    const res = referentResolver.resolve('No, the other one', convId);
    expect(res.kind).toBe('direct_action');
    expect(res.action).toBe('open_result_index');
    expect(res.parameters?.index).toBe(1);
  });

  it('End-to-End routeTurn: "Open it" routes to latestResolvedReferent and is not hijacked by stale navigation target', async () => {
    const { routeTurn, getFocus } = await import('../domains/jarvisNext/turnRouter.js');
    const testConv = 'test-conv-e2e-' + Date.now();

    // Turn 1 setup: stale navigation target
    const focus = getFocus(testConv);
    focus.lastNavigationTarget = {
      entityId: 'youtube',
      entityName: 'YouTube',
      entityType: 'app',
    };
    focus.lastVerificationState = 'verified'; // was verified in Turn 1, NOT a pending failed navigation!

    // Turn 8 setup: discovered external website
    const externalUrl = 'https://www.bitchute.com/channel/seeadler-tv/';
    activeInteractionContextStore.setLatestReferent(testConv, {
      type: 'website',
      entity: 'SEEADLER TV website',
      url: externalUrl,
      sourceTurn: 8,
      actionable: true,
      timestamp: Date.now(),
    });

    const res = await routeTurn({
      prompt: 'Open it.',
      conversationId: testConv,
    });

    // Must NOT be hijacked to YouTube!
    expect(res.text).not.toBe("I've opened YouTube.");
    expect(res.entityName).not.toBe('YouTube');
  });
});

