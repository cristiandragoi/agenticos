import React, { useEffect } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { JarvisChat } from '../components/jarvis/JarvisChat';
import { JarvisWorkspaceBar } from '../components/jarvis/JarvisWorkspaceBar';
import { JarvisTeamPreviewCard } from '../components/jarvis/JarvisTeamPreviewCard';
import { JarvisTeamExecutionCard } from '../components/jarvis/JarvisTeamExecutionCard';
import { CodexProvider, useCodexStore } from '../store/codexStore';

class MockEventSource {
  static CLOSED = 2;
  static instances: MockEventSource[] = [];
  url: string;
  readyState = 0;
  onopen: any = null;
  onerror: any = null;
  listeners: Record<string, any> = {};
  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }
  addEventListener(type: string, cb: any) { this.listeners[type] = cb; }
  close() {}
}

const fetchMock = vi.fn();
let lastMessageBody: any = null;
let reportsResponse: any = { reports: [] };

describe('full top-level replica probe', () => {
  it('survives the module scope of JarvisExecutionFlow', () => {
    expect(JarvisChat).toBeTruthy();
    expect(JarvisWorkspaceBar).toBeTruthy();
    expect(JarvisTeamPreviewCard).toBeTruthy();
    expect(JarvisTeamExecutionCard).toBeTruthy();
    expect(CodexProvider).toBeTruthy();
    expect(useCodexStore).toBeTruthy();
    expect(typeof MockEventSource).toBe('function');
    expect(fetchMock).toBeTruthy();
    void lastMessageBody; void reportsResponse;
  });
});
