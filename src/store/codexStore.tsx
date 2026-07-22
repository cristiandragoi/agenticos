import React, { createContext, useContext, useState, type ReactNode } from 'react';
import type { ConnectionState } from '../presenters/executionStatus';

export interface CodexRunSettings {
  folderTree: string;
  workspacePath: string;
  execProvider: string;
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
}

const CodexContext = createContext<CodexState | null>(null);

export function CodexProvider({ children }: { children: ReactNode }) {
  const [activeGoalId, setActiveGoalId] = useState<string | null>(null);
  const [goalStatus, setGoalStatus] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('chat');
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const [streamNonce, setStreamNonce] = useState(0);
  const reconnectStream = () => setStreamNonce(n => n + 1);

  const [runSettings, setRunSettings] = useState<CodexRunSettings>({
    folderTree: '',
    workspacePath: '',
    execProvider: 'ollama',
    valProvider: 'omniRoute',
    approvalPolicy: 'strict'
  });
  
  const [events, setEvents] = useState<any[]>([]);
  const [localChat, setLocalChat] = useState<any[]>([]);
  const [input, setInput] = useState('');
  const [workspacePath, setWorkspacePath] = useState('C:\\Users\\Cris\\Documents\\MockRepo');
  const [showSettings, setShowSettings] = useState(false);
  const [isPlanning, setIsPlanning] = useState(false);
  const [isStarting, setIsStarting] = useState(false);

  return (
    <CodexContext.Provider value={{
      activeGoalId, setActiveGoalId,
      goalStatus, setGoalStatus,
      activeTab, setActiveTab,
      isDrawerOpen, setIsDrawerOpen,
      connectionState, setConnectionState,
      streamNonce, reconnectStream,
      runSettings, setRunSettings,
      events, setEvents,
      localChat, setLocalChat,
      input, setInput,
      workspacePath, setWorkspacePath,
      showSettings, setShowSettings,
      isPlanning, setIsPlanning,
      isStarting, setIsStarting
    }}>
      {children}
    </CodexContext.Provider>
  );
}

export function useCodexStore() {
  const ctx = useContext(CodexContext);
  if (!ctx) throw new Error("useCodexStore must be used within CodexProvider");
  return ctx;
}
