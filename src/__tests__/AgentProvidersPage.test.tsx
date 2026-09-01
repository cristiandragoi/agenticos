import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { HashRouter } from 'react-router-dom';
import LeftRail from '../components/layout/LeftRail';
import AgentProvidersPage from '../pages/AgentProvidersPage';
import { DataProvider } from '../store/dataStore';
import { AppProvider } from '../store/appStore';
import { ProjectProvider } from '../store/projectStore';

// Mock fetch for API calls
global.fetch = vi.fn((url: any) => {
  if (String(url).includes('/api/antigravity/status')) {
    return Promise.resolve({
      ok: true,
      json: () =>
        Promise.resolve({
          providerId: 'antigravity',
          name: 'Antigravity (Google DeepMind / Gemini)',
          configured: true,
          maskedPreview: 'AIz...654',
          reachable: true,
          status: 'connected',
          latencyMs: 120,
          config: {
            maxTotalTokens: 8192,
            maxEstimatedCostUsd: 0.50,
            timeoutMs: 60000,
            autoRetries: 0,
            defaultModel: 'gemini-2.5-flash',
            enabled: true,
          },
        }),
    });
  }
  if (String(url).includes('/api/hermes-api/status')) {
    return Promise.resolve({
      ok: true,
      json: () =>
        Promise.resolve({
          reachable: true,
          detail: 'Hermes In-Repo Engine Online',
          model: 'deepseek-v4-flash',
        }),
    });
  }
  if (String(url).includes('/api/providers/prov-ollama/models')) {
    return Promise.resolve({
      ok: true,
      json: () =>
        Promise.resolve({
          reachable: true,
          models: [{ id: 'llama3.2:3b', name: 'Llama 3.2 3B' }],
        }),
    });
  }
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve({}),
  });
}) as any;

describe('Agent Providers Left Navigation & Page Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('1. LeftRail contains AGENT PROVIDERS link', async () => {
    render(
      <DataProvider>
        <AppProvider>
          <ProjectProvider>
            <HashRouter>
              <LeftRail />
            </HashRouter>
          </ProjectProvider>
        </AppProvider>
      </DataProvider>
    );

    await waitFor(() => {
      const link = screen.getByTestId('nav-agent-providers');
      expect(link).toBeInTheDocument();
      expect(link.textContent).toContain('AGENT PROVIDERS');
    });
  });

  it('2. AgentProvidersPage displays cards for Hermes, Ollama, and Antigravity', async () => {
    render(
      <DataProvider>
        <AppProvider>
          <ProjectProvider>
            <HashRouter>
              <AgentProvidersPage />
            </HashRouter>
          </ProjectProvider>
        </AppProvider>
      </DataProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('provider-card-hermes')).toBeInTheDocument();
      expect(screen.getByTestId('provider-card-ollama')).toBeInTheDocument();
      expect(screen.getByTestId('provider-card-antigravity')).toBeInTheDocument();
    });

    expect(screen.getByText('Hermes')).toBeInTheDocument();
    expect(screen.getByText('Ollama')).toBeInTheDocument();
    expect(screen.getByText('Antigravity')).toBeInTheDocument();
  });

  it('3. Antigravity card shows credential configuration and execution limits controls', async () => {
    render(
      <DataProvider>
        <AppProvider>
          <ProjectProvider>
            <HashRouter>
              <AgentProvidersPage />
            </HashRouter>
          </ProjectProvider>
        </AppProvider>
      </DataProvider>
    );

    await waitFor(() => {
      expect(screen.getByText(/Antigravity Execution Limits & Safety Controls/i)).toBeInTheDocument();
      expect(screen.getByText(/Max Total Tokens/i)).toBeInTheDocument();
      expect(screen.getByText(/Max Estimated Cost/i)).toBeInTheDocument();
      expect(screen.getByText(/Automatic Retries/i)).toBeInTheDocument();
      expect(screen.getByText(/Experimental Read-Only Analysis Probe/i)).toBeInTheDocument();
    });
  });
});
