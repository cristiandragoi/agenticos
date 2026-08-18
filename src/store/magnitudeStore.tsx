import React, { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { apiFetch, apiUrl } from '../api/client';

export interface MagnitudeEvent {
  id: string;
  runId: string;
  sequence: number;
  timestamp: string;
  type: string;
  message: string;
  details?: any;
}

export interface MagnitudeInspectResult {
  url: string;
  finalUrl: string;
  title: string;
  text: string;
  metaDescription?: string;
  linksCount?: number;
  durationMs: number;
  actionSummary?: string;
  /** Screenshot evidence (M7) — served via /api/magnitude/runs/:id/screenshot. */
  screenshotPath?: string;
  screenshotBytes?: number;
}

export interface MagnitudeRunRecord {
  id: string;
  goal: string;
  requestedUrl: string;
  actionType: 'inspect' | 'click' | 'search';
  status: 'queued' | 'running' | 'completed' | 'failed' | 'stopped';
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  result?: MagnitudeInspectResult;
  error?: string;
  events?: MagnitudeEvent[];
  conversationId?: string;
}

interface MagnitudeContextType {
  activeRunId: string | null;
  activeRun: MagnitudeRunRecord | null;
  events: MagnitudeEvent[];
  runs: MagnitudeRunRecord[];
  isLoading: boolean;
  isStarting: boolean;
  input: string;
  setInput: (v: string) => void;
  selectRun: (runId: string) => Promise<void>;
  createAndStartRun: (goal: string) => Promise<string | null>;
  stopActiveRun: () => Promise<void>;
  refreshRuns: () => Promise<void>;
  resetForNewRun: () => void;
}

const MagnitudeContext = createContext<MagnitudeContextType | undefined>(undefined);

export const MagnitudeProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [activeRun, setActiveRun] = useState<MagnitudeRunRecord | null>(null);
  const [events, setEvents] = useState<MagnitudeEvent[]>([]);
  const [runs, setRuns] = useState<MagnitudeRunRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [input, setInput] = useState('');

  const refreshRuns = useCallback(async () => {
    try {
      const res = await apiFetch('/api/magnitude/runs');
      if (res.ok) {
        const data = await res.json();
        setRuns(data);
      }
    } catch {}
  }, []);

  useEffect(() => {
    refreshRuns();
  }, [refreshRuns]);

  const selectRun = useCallback(async (runId: string) => {
    setActiveRunId(runId);
    setIsLoading(true);
    try {
      const res = await apiFetch(`/api/magnitude/runs/${runId}`);
      if (res.ok) {
        const data = await res.json();
        setActiveRun(data);
        setEvents(data.events || []);
      }
    } catch {} finally {
      setIsLoading(false);
    }
  }, []);

  // SSE Event Stream for active run
  useEffect(() => {
    if (!activeRunId) return;
    if (activeRun && ['completed', 'failed', 'stopped'].includes(activeRun.status)) return;

    let es: EventSource | null = null;
    try {
      es = new EventSource(apiUrl(`/api/magnitude/runs/${activeRunId}/stream`));

      es.addEventListener('magnitude_event', (e: any) => {
        try {
          const evt: MagnitudeEvent = JSON.parse(e.data);
          setEvents(prev => {
            if (prev.find(p => p.id === evt.id || (p.sequence === evt.sequence && p.type === evt.type))) return prev;
            return [...prev, evt].sort((a, b) => a.sequence - b.sequence);
          });
        } catch {}
      });

      es.addEventListener('done', async () => {
        es?.close();
        // Refresh full record
        try {
          const res = await apiFetch(`/api/magnitude/runs/${activeRunId}`);
          if (res.ok) {
            const data = await res.json();
            setActiveRun(data);
            if (data.events) setEvents(data.events);
          }
        } catch {}
        refreshRuns();
      });

      es.onerror = () => {
        es?.close();
      };
    } catch {}

    return () => {
      es?.close();
    };
  }, [activeRunId, activeRun?.status, refreshRuns]);

  const createAndStartRun = useCallback(async (goal: string) => {
    if (!goal.trim()) return null;
    setIsStarting(true);
    try {
      const res = await apiFetch('/api/magnitude/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goal: goal.trim() })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to create Magnitude run.');
      }
      const newRun = await res.json();
      setActiveRunId(newRun.id);
      setActiveRun(newRun);
      setEvents(newRun.events || []);
      setInput('');
      refreshRuns();
      return newRun.id;
    } catch (err: any) {
      alert(err.message || 'Error starting Magnitude run.');
      return null;
    } finally {
      setIsStarting(false);
    }
  }, [refreshRuns]);

  const stopActiveRun = useCallback(async () => {
    if (!activeRunId) return;
    try {
      await apiFetch(`/api/magnitude/runs/${activeRunId}/stop`, { method: 'POST' });
      const res = await apiFetch(`/api/magnitude/runs/${activeRunId}`);
      if (res.ok) {
        const data = await res.json();
        setActiveRun(data);
        if (data.events) setEvents(data.events);
      }
      refreshRuns();
    } catch {}
  }, [activeRunId, refreshRuns]);

  const resetForNewRun = useCallback(() => {
    setActiveRunId(null);
    setActiveRun(null);
    setEvents([]);
    setInput('');
  }, []);

  return (
    <MagnitudeContext.Provider
      value={{
        activeRunId,
        activeRun,
        events,
        runs,
        isLoading,
        isStarting,
        input,
        setInput,
        selectRun,
        createAndStartRun,
        stopActiveRun,
        refreshRuns,
        resetForNewRun,
      }}
    >
      {children}
    </MagnitudeContext.Provider>
  );
};

export const useMagnitudeStore = () => {
  const context = useContext(MagnitudeContext);
  if (!context) {
    throw new Error('useMagnitudeStore must be used within a MagnitudeProvider');
  }
  return context;
};
