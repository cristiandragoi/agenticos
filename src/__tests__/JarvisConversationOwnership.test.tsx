/**
 * JarvisConversationOwnership.test.tsx — regression guard for the
 * conversation-ownership stale-closure bug.
 *
 * Root cause (live acceptance): the sticky composer and voice auto-submit
 * send through `chatRef.current?.sendMessage(...)`, but the imperative handle
 * had `[]` deps and closed over the FIRST render's `handleSendMessage` —
 * which captured `conversationId === null` (set AFTER mount by the studio's
 * restore effect). Every follow-up turn then auto-created a NEW conversation
 * (T1→conv-A, T2→conv-B), losing context for deictic resolution.
 *
 * Fix: the imperative handle now routes through refs that always point at the
 * LATEST closures (`handleSendRef.current`, `cancelResponseRef.current`).
 *
 * These guards verify the wiring pattern, not the streaming behavior.
 */
/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

describe('JarvisChat conversation ownership wiring', () => {
  const src = fs.readFileSync('src/components/jarvis/JarvisChat.tsx', 'utf8');

  it('imperative handle routes sendMessage through the latest-closure ref', () => {
    expect(src).toContain('handleSendRef.current');
    expect(src).toContain('handleSendRef.current?.(text, inputChannel)');
    expect(src).not.toContain('void handleSendMessage(text, inputChannel);');
  });

  it('imperative handle routes cancelResponse through the latest-closure ref', () => {
    expect(src).toContain('cancelResponseRef.current?.()');
  });

  it('comment documents the stale-closure hazard (conversationId null on first render)', () => {
    expect(src).toContain('conversationId === null');
    expect(src).toContain('T1→conv-A, T2→conv-B');
  });

  it('refs are refreshed every render (assignment pattern, not one-shot)', () => {
    // The ref.current assignment must appear AFTER the closure definitions,
    // i.e. near the imperative handle, not in an empty-deps effect.
    const idxHandle = src.indexOf('React.useImperativeHandle');
    const idxRefAssign = src.indexOf('handleSendRef.current =');
    expect(idxRefAssign).toBeGreaterThan(-1);
    expect(idxHandle).toBeGreaterThan(-1);
    expect(idxRefAssign).toBeLessThan(idxHandle);
  });
});
