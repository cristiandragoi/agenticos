import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { JarvisActionInspector } from '../components/jarvis/JarvisActionInspector';
import { JarvisRuntimeProvider, useJarvisRuntime } from '../context/JarvisRuntimeContext';
import { MemoryRouter } from 'react-router-dom';

// Helper component to feed test action records into context
const TestHarness: React.FC<{ initialRecord?: any }> = ({ initialRecord }) => {
  const { setLatestActionRecord } = useJarvisRuntime();
  React.useEffect(() => {
    if (initialRecord) {
      setLatestActionRecord(initialRecord);
    }
  }, [initialRecord, setLatestActionRecord]);

  return <JarvisActionInspector />;
};

describe('JarvisActionInspector UI Component', () => {
  it('renders placeholder when no actions exist', () => {
    render(
      <MemoryRouter>
        <JarvisRuntimeProvider>
          <JarvisActionInspector />
        </JarvisRuntimeProvider>
      </MemoryRouter>
    );

    expect(screen.getByText(/No Jarvis Actions Yet/i)).toBeInTheDocument();
  });

  it('renders completed action activity trace correctly', async () => {
    const mockRecord = {
      id: 'act-1',
      ownerAgent: 'jarvis',
      module: 'revenue-operator',
      command: 'Open the Notion and Agentic workflow template',
      actionType: 'OPEN_ENTITY',
      entityId: 'opp-dfd16cad-',
      displayName: 'Niche Notion & Agentic Workflow Template Pack for Solopreneurs',
      status: 'completed',
      startedAt: new Date().toISOString(),
      destination: '/revenue-operator?opportunity=opp-dfd16cad-',
      evidence: [
        { type: 'resolution', detail: 'Found exact opportunity match in Revenue Operator', timestamp: new Date().toISOString() }
      ]
    };

    render(
      <MemoryRouter>
        <JarvisRuntimeProvider>
          <TestHarness initialRecord={mockRecord} />
        </JarvisRuntimeProvider>
      </MemoryRouter>
    );

    expect(await screen.findByTestId('user-activity-view')).toBeInTheDocument();
    expect(screen.getByText('COMPLETED')).toBeInTheDocument();
    expect(screen.getByText(/Heard command/i)).toBeInTheDocument();
    expect(screen.getByText(/OPEN_ENTITY/i)).toBeInTheDocument();
    expect(screen.getByText(/Niche Notion & Agentic Workflow Template Pack/i)).toBeInTheDocument();
    expect(screen.getByText(/Opened successfully/i)).toBeInTheDocument();
  });

  it('switches to Detailed Inspector mode and displays raw diagnostic fields', async () => {
    const mockRecord = {
      id: 'act-2',
      ownerAgent: 'jarvis',
      module: 'revenue-operator',
      command: 'Open Revenue Operator',
      actionType: 'OPEN_MODULE',
      displayName: 'Revenue Operator',
      status: 'completed',
      startedAt: new Date().toISOString(),
      destination: '/revenue-operator'
    };

    render(
      <MemoryRouter>
        <JarvisRuntimeProvider>
          <TestHarness initialRecord={mockRecord} />
        </JarvisRuntimeProvider>
      </MemoryRouter>
    );

    const inspectorBtn = await screen.findByRole('button', { name: /Detailed Inspector/i });
    fireEvent.click(inspectorBtn);

    expect(screen.getByTestId('detailed-inspector-view')).toBeInTheDocument();
    expect(screen.getByText(/1\. Input/i)).toBeInTheDocument();
    expect(screen.getByText(/2\. Workspace Context/i)).toBeInTheDocument();
    expect(screen.getByText(/3\. Intent Detection/i)).toBeInTheDocument();
    expect(screen.getByText(/4\. Entity Resolution/i)).toBeInTheDocument();
    expect(screen.getByText(/5\. Action Execution/i)).toBeInTheDocument();
  });

  it('renders failure trace when entity resolution fails', async () => {
    const mockFailure = {
      id: 'act-3',
      ownerAgent: 'jarvis',
      module: 'revenue-operator',
      command: 'Open Project XYZ123',
      actionType: 'OPEN_ENTITY',
      status: 'failed',
      errorCode: 'ENTITY_NOT_FOUND',
      error: 'No matching entity found for "Project XYZ123" inside revenue-operator.',
      startedAt: new Date().toISOString()
    };

    render(
      <MemoryRouter>
        <JarvisRuntimeProvider>
          <TestHarness initialRecord={mockFailure} />
        </JarvisRuntimeProvider>
      </MemoryRouter>
    );

    expect(await screen.findByTestId('user-activity-view')).toBeInTheDocument();
    expect(screen.getByText('FAILED')).toBeInTheDocument();
    expect(screen.getByText(/Entity resolution failed/i)).toBeInTheDocument();
    expect(screen.getByText(/No matching entity found for "Project XYZ123"/i)).toBeInTheDocument();
    expect(screen.getByText(/Execution stopped/i)).toBeInTheDocument();
  });
});
