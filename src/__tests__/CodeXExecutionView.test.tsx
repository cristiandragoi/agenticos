import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { presentEvent, getActivityPhrase } from '../presenters/EventPresenter';
import { deriveCurrentAction, pairToolExecutions } from '../presenters/executionStatus';
import { DiagnosticsDrawer } from '../components/codex/DiagnosticsDrawer';
import { CodexProvider } from '../store/codexStore';
import { normalizeExecutionEvent } from '../utils/normalize';

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockResolvedValue({ ok: true, json: async () => ([]) });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

function makeEvent(partial: any) {
  return normalizeExecutionEvent({
    goalId: 'g1',
    sequence: 1,
    timestamp: new Date().toISOString(),
    state: 'executing',
    step: 1,
    message: '',
    ...partial
  });
}

describe('EventPresenter literal template fixes', () => {
  it('renders real tool name and file path instead of template literals', () => {
    const event = makeEvent({
      eventType: 'tool_started',
      tool: 'readFile',
      filePath: 'package.json',
      normalizedStatus: 'active',
      lifecycleState: 'running'
    });
    const presented = presentEvent(event);
    expect(presented.title).toContain('Read File');
    expect(presented.title).toContain('package.json');
    expect(presented.title).not.toContain('${');
    expect(presented.explanation).not.toContain('${');
  });

  it('translates parse-retry events into readable phrases', () => {
    const event = makeEvent({
      eventType: 'retry_started',
      errorCode: 'CODEX_TOOL_PARSE_FAILED',
      lifecycleState: 'retrying',
      normalizedStatus: 'attention'
    });
    expect(getActivityPhrase(event)).toMatch(/did not return valid tool JSON/i);
  });

  it('does not use raw event names as activity phrases when a translation exists', () => {
    const event = makeEvent({ eventType: 'checkpoint_written', normalizedStatus: 'completed' });
    expect(getActivityPhrase(event)).toBe('Checkpoint saved.');
  });
});

describe('deriveCurrentAction status mapping', () => {
  it('shows the active tool with GREEN status during a tool step', () => {
    const events = [makeEvent({ eventType: 'tool_started', tool: 'readFile', filePath: 'package.json', lifecycleState: 'running', normalizedStatus: 'active' })];
    const action = deriveCurrentAction('executing', events, 'connected');
    expect(action.color).toBe('green');
    expect(action.message).toBe('Reading package.json');
    expect(action.tool).toBe('readFile');
    expect(action.filePath).toBe('package.json');
  });

  it('shows YELLOW while waiting for the model', () => {
    const events = [makeEvent({ eventType: 'planning_started', lifecycleState: 'planning', normalizedStatus: 'planning' })];
    const action = deriveCurrentAction('executing', events, 'connected');
    expect(action.color).toBe('yellow');
    expect(action.message).toMatch(/waiting for.*model response/i);
  });

  it('shows PURPLE while reviewing the previous result', () => {
    const events = [makeEvent({ eventType: 'tool_completed', tool: 'runCommand', command: 'npm run build', lifecycleState: 'running', normalizedStatus: 'completed' })];
    const action = deriveCurrentAction('executing', events, 'connected');
    expect(action.color).toBe('purple');
    expect(action.message).toMatch(/reviewing the previous result/i);
  });

  it('shows BLUE when completed and RED when failed', () => {
    expect(deriveCurrentAction('completed', [], 'connected').color).toBe('blue');
    expect(deriveCurrentAction('failed', [], 'connected').color).toBe('red');
  });

  it('flags a disconnected stream without erasing run state', () => {
    const events = [makeEvent({ eventType: 'tool_started', tool: 'writeFile', filePath: 'src/app.ts', lifecycleState: 'running', normalizedStatus: 'active' })];
    const action = deriveCurrentAction('executing', events, 'disconnected');
    expect(action.statusLabel).toBe('Disconnected');
    expect(action.tool).toBe('writeFile');
  });

  it('is GREY and idle with no goal', () => {
    const action = deriveCurrentAction(null, [], 'disconnected');
    expect(action.color).toBe('grey');
    expect(action.statusLabel).toBe('Idle');
  });
});

describe('pairToolExecutions', () => {
  it('pairs tool_started with tool_completed including timing', () => {
    const start = new Date('2026-01-01T10:00:00Z').toISOString();
    const end = new Date('2026-01-01T10:00:02Z').toISOString();
    const events = [
      makeEvent({ sequence: 1, eventType: 'tool_started', tool: 'runCommand', command: 'npm run build', timestamp: start }),
      makeEvent({ sequence: 2, eventType: 'tool_completed', tool: 'runCommand', message: 'Tool Result:\nbuild ok', timestamp: end })
    ];
    const executions = pairToolExecutions(events, false);
    expect(executions).toHaveLength(1);
    expect(executions[0].state).toBe('completed');
    expect(executions[0].tool).toBe('runCommand');
    expect(executions[0].command).toBe('npm run build');
    expect(executions[0].durationMs).toBe(2000);
    expect(executions[0].summary).toBe('build ok');
  });

  it('marks an unpaired tool as running while the run is active', () => {
    const events = [makeEvent({ sequence: 1, eventType: 'tool_started', tool: 'readFile', filePath: 'a.ts' })];
    const executions = pairToolExecutions(events, true);
    expect(executions[0].state).toBe('running');
  });
});

describe('DiagnosticsDrawer', () => {
  it('starts collapsed and reopens from a visible button', () => {
    render(
      <CodexProvider>
        <DiagnosticsDrawer />
      </CodexProvider>
    );
    expect(screen.getByText(/Advanced Diagnostics/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^open$/i }));
    // Expanded: the Close control and tab buttons exist.
    expect(screen.getByRole('button', { name: /^close$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Circuit Breakers/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^close$/i }));
    // Collapsed again: Close control gone, visible Open button remains.
    expect(screen.queryByRole('button', { name: /^close$/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^open$/i })).toBeInTheDocument();
    expect(screen.getByText(/Advanced Diagnostics/i)).toBeInTheDocument();
  });
});
