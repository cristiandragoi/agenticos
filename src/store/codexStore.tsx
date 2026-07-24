import React, { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import type { ConnectionState } from '../presenters/executionStatus';
import { CODEX_BASE_URL, CODEX_MODEL, CODEX_PROVIDER, CODEX_REPOSITORY } from '../config/codexRuntime';

export interface CodexRunSettings {
  folderTree: string;
  workspacePath: string;
  execProvider: string;
  execModel: string;
  baseUrl: string;
  valProvider: string;
  approvalPolicy: string;
}

interface CodexState {
  activeGoalId: string | null;
  setActiveGoalId: (id: string | null) => void;
  goalStatus: string | null;
  setGoalStatus: (status: string | null) => void;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  isDrawerOpen: boolean;
  setIsDrawerOpen: (open: boolean) => void;

  // Event stream connection state
  connectionState: ConnectionState;
  setConnectionState: (state: ConnectionState) => void;
  streamNonce: number;
  reconnectStream: () => void;

  // Run settings (editable before a run, summarized during a run)
  runSettings: CodexRunSettings;
  setRunSettings: React.Dispatch<React.SetStateAction<CodexRunSettings>>;
  
  // Chat state
  events: any[];
  setEvents: React.Dispatch<React.SetStateAction<any[]>>;
  localChat: any[];
  setLocalChat: React.Dispatch<React.SetStateAction<any[]>>;
  input: string;
  setInput: (input: string) => void;
  workspacePath: string;
  setWorkspacePath: (path: string) => void;
  showSettings: boolean;
  setShowSettings: (show: boolean) => void;
  isPlanning: boolean;
  setIsPlanning: (planning: boolean) => void;
  isStarting: boolean;
  setIsStarting: (starting: boolean) => void;
  resetForNewTask: () => void;
}

const CodexContext = createContext<CodexState | null>(null);
const RUN_SETTINGS_STORAGE_KEY = 'agenticos:codex-run-settings';

const defaultRunSettings: CodexRunSettings = {
  folderTree: '',
  workspacePath: CODEX_REPOSITORY,
  execProvider: CODEX_PROVIDER,
  execModel: CODEX_MODEL,
  baseUrl: CODEX_BASE_URL,
  valProvider: 'omniRoute',
  approvalPolicy: 'strict'
};

function readPersistedRunSettings(): CodexRunSettings {
  if (typeof window === 'undefined') return defaultRunSettings;
  try {
    const raw = window.localStorage.getItem(RUN_SETTINGS_STORAGE_KEY);
    if (!raw) return defaultRunSettings;
    const parsed = JSON.parse(raw);
    return {
      ...defaultRunSettings,
      ...parsed,
      folderTree: typeof parsed.folderTree === 'string' ? parsed.folderTree : '',
      workspacePath: typeof parsed.workspacePath === 'string' && parsed.workspacePath ? parsed.workspacePath : CODEX_REPOSITORY,
      execProvider: CODEX_PROVIDER,
      execModel: CODEX_MODEL,
      baseUrl: CODEX_BASE_URL
    };
  } catch {
    return defaultRunSettings;
  }
}

function persistRunSettings(settings: CodexRunSettings) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(RUN_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
}

export function CodexProvider({ children }: { children: ReactNode }) {
  const [activeGoalId, setActiveGoalId] = useState<string | null>(null);
  const [goalStatus, setGoalStatus] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('chat');
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');
  const [streamNonce, setStreamNonce] = useState(0);
  const reconnectStream = () => setStreamNonce(n => n + 1);

  const [runSettingsState, setRunSettingsState] = useState<CodexRunSettings>(() => readPersistedRunSettings());
  
  const [events, setEvents] = useState<any[]>([]);
  const [localChat, setLocalChat] = useState<any[]>([]);
  const [input, setInput] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [isPlanning, setIsPlanning] = useState(false);
  const [isStarting, setIsStarting] = useState(false);

  const setRunSettings: React.Dispatch<React.SetStateAction<CodexRunSettings>> = updater => {
    setRunSettingsState(prev => {
      const next = typeof updater === 'function'
        ? (updater as (prev: CodexRunSettings) => CodexRunSettings)(prev)
        : updater;
      persistRunSettings(next);
      return next;
    });
  };

  const setWorkspacePath = (path: string) => {
    setRunSettings(prev => ({ ...prev, workspacePath: path, folderTree: prev.folderTree || path }));
  };

  const resetForNewTask = () => {
    setActiveGoalId(null);
    setGoalStatus(null);
    setConnectionState('idle_connected');
    setEvents([]);
    setLocalChat([]);
    setInput('');
    setIsPlanning(false);
    setIsStarting(false);
    setActiveTab('chat');
  };

  const value = useMemo(() => ({
    activeGoalId, setActiveGoalId,
    goalStatus, setGoalStatus,
    activeTab, setActiveTab,
    isDrawerOpen, setIsDrawerOpen,
    connectionState, setConnectionState,
    streamNonce, reconnectStream,
    runSettings: runSettingsState,
    setRunSettings,
    events, setEvents,
    localChat, setLocalChat,
    input, setInput,
    workspacePath: runSettingsState.workspacePath,
    setWorkspacePath,
    showSettings, setShowSettings,
    isPlanning, setIsPlanning,
    isStarting, setIsStarting,
    resetForNewTask
  }), [
    activeGoalId, goalStatus, activeTab, isDrawerOpen,
    connectionState, streamNonce, runSettingsState, events,
    localChat, input, showSettings, isPlanning, isStarting
  ]);

  return (
    <CodexContext.Provider value={value}>
      {children}
    </CodexContext.Provider>
  );
}

export function useCodexStore() {
  const ctx = useContext(CodexContext);
  if (!ctx) throw new Error("useCodexStore must be used within CodexProvider");
  return ctx;
}
