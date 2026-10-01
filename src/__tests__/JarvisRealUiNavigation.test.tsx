import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, act } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { JarvisRuntimeProvider, useJarvisRuntime } from '../context/JarvisRuntimeContext';
import { jarvisLiveKitSession } from '../lib/jarvisLiveKitSession';

// Current route inspector helper component
function RouteDisplay() {
  const location = useLocation();
  const runtime = useJarvisRuntime();
  return (
    <div>
      <div data-testid="current-pathname">{location.pathname}</div>
      <div data-testid="current-search">{location.search}</div>
      <div data-testid="workspace-route">{runtime.workspaceContext.activeRoute}</div>
      <div data-testid="selected-project">{runtime.workspaceContext.selectedProject}</div>
    </div>
  );
}

describe('Frontend Real UI Navigation Integration', () => {
  let emittedDataCallbacks: Array<(data: any) => void> = [];
  let sentDataMessages: any[] = [];

  beforeEach(() => {
    emittedDataCallbacks = [];
    sentDataMessages = [];

    vi.spyOn(jarvisLiveKitSession, 'onData').mockImplementation((cb: (data: any) => void) => {
      emittedDataCallbacks.push(cb);
      return () => {
        emittedDataCallbacks = emittedDataCallbacks.filter((c) => c !== cb);
      };
    });

    vi.spyOn(jarvisLiveKitSession, 'sendData').mockImplementation(async (payload: any) => {
      sentDataMessages.push(payload);
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('handles NAVIGATE_REQUEST for Free Cash, updates router, and emits NAVIGATE_ACK', async () => {
    const { getByTestId } = render(
      <MemoryRouter initialEntries={['/jarvis']}>
        <JarvisRuntimeProvider>
          <Routes>
            <Route path="*" element={<RouteDisplay />} />
          </Routes>
        </JarvisRuntimeProvider>
      </MemoryRouter>
    );

    expect(getByTestId('current-pathname').textContent).toBe('/jarvis');

    // Simulate backend sending NAVIGATE_REQUEST over LiveKit DataChannel
    await act(async () => {
      for (const cb of emittedDataCallbacks) {
        cb({
          type: 'NAVIGATE_REQUEST',
          navigationId: 'nav-test-freecash-123',
          route: '/projects?project=proj-free-cash',
          entityId: 'proj-free-cash',
          entityType: 'project',
          entityName: 'Free Cash',
        });
      }
    });

    await waitFor(() => {
      expect(getByTestId('current-pathname').textContent).toBe('/projects');
      expect(getByTestId('current-search').textContent).toBe('?project=proj-free-cash');
    });

    // Verify ACK sent back to backend — D14: the ACK carries PROVEN state, so it
    // arrives after the router/view settles, not on navigate() return.
    await waitFor(() => {
      expect(sentDataMessages).toContainEqual({
        type: 'NAVIGATE_ACK',
        navigationId: 'nav-test-freecash-123',
        success: true,
        actualRoute: '/projects?project=proj-free-cash',
        visibleEntityId: 'proj-free-cash',
        error: undefined,
      });
    });

    // Verify global inspection state
    expect((window as any).__LAST_JARVIS_NAVIGATION__).toMatchObject({
      navigationId: 'nav-test-freecash-123',
      route: '/projects?project=proj-free-cash',
      actualRoute: '/projects?project=proj-free-cash',
      entityId: 'proj-free-cash',
      entityType: 'project',
      success: true,
    });
  });

  it('handles NAVIGATE_REQUEST for Revenue Operator, updates router, and emits NAVIGATE_ACK', async () => {
    const { getByTestId } = render(
      <MemoryRouter initialEntries={['/projects?project=proj-free-cash']}>
        <JarvisRuntimeProvider>
          <Routes>
            <Route path="*" element={<RouteDisplay />} />
          </Routes>
        </JarvisRuntimeProvider>
      </MemoryRouter>
    );

    expect(getByTestId('current-pathname').textContent).toBe('/projects');

    // Simulate backend sending NAVIGATE_REQUEST for Revenue Operator
    await act(async () => {
      for (const cb of emittedDataCallbacks) {
        cb({
          type: 'NAVIGATE_REQUEST',
          navigationId: 'nav-test-ro-456',
          route: '/revenue-operator',
          entityId: 'revenue_operator',
          entityType: 'capability',
          entityName: 'Revenue Operator',
        });
      }
    });

    await waitFor(() => {
      expect(getByTestId('current-pathname').textContent).toBe('/revenue-operator');
    });

    await waitFor(() => {
      expect(sentDataMessages).toContainEqual({
        type: 'NAVIGATE_ACK',
        navigationId: 'nav-test-ro-456',
        success: true,
        actualRoute: '/revenue-operator',
        visibleEntityId: 'revenue_operator',
        error: undefined,
      });
    });
  });
});
