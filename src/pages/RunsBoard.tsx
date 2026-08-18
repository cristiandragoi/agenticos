// @ts-nocheck
import { useData } from '../store/dataStore';
import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useDrawer } from '../store/appStore';
import { apiClient } from '../api/client';
import BoardColumn from '../components/ui/BoardColumn';
import EntityCard from '../components/ui/EntityCard';
import { Plus, Sparkles, Send, Loader2, X, Target, Terminal, AlertTriangle } from 'lucide-react';

const ALL_AGENT_ID = '__all__';
const AUTO_ROUTE_ID = 'auto';
const POLL_INTERVAL = 2000;

const STATUS_COLUMNS: Array<{ key: string; label: string; color: string }> = [
  { key: 'queued', label: 'Queued', color: '#f59e0b' },
  { key: 'running', label: 'Running', color: '#3b82f6' },
  { key: 'waiting', label: 'Waiting', color: '#8b5cf6' },
  { key: 'completed', label: 'Completed', color: '#10b981' },
  { key: 'failed', label: 'Failed', color: '#ef4444' },
];

const RunsBoard: React.FC = () => {
  const { agents, runs, isLoading, refresh } = useData();
  const drawer = useDrawer();

  const [showComposer, setShowComposer] = useState(false);
  const [selectedAgentId, setSelectedAgentId] = useState<string>(AUTO_ROUTE_ID);
  const [agentFilter, setAgentFilter] = useState<string>(ALL_AGENT_ID);
  const [prompt, setPrompt] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Autonomous task modal state
  const [showAutoModal, setShowAutoModal] = useState(false);
  const [autoGoal, setAutoGoal] = useState('');
  const [autoConstraints, setAutoConstraints] = useState('');
  const [autoAgentId, setAutoAgentId] = useState<string>('agent-jarvis');
  const [isAutoSubmitting, setIsAutoSubmitting] = useState(false);
  const [autoError, setAutoError] = useState<string | null>(null);

  // Live run polling — faster interval when active runs exist
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fastPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    pollRef.current = setInterval(() => refresh(), POLL_INTERVAL);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (fastPollRef.current) clearInterval(fastPollRef.current);
    };
  }, [refresh]);

  // Auto-close error after 5 seconds
  useEffect(() => {
    if (error) {
      const t = setTimeout(() => setError(null), 5000);
      return () => clearTimeout(t);
    }
  }, [error]);

  useEffect(() => {
    if (autoError) {
      const t = setTimeout(() => setAutoError(null), 5000);
      return () => clearTimeout(t);
    }
  }, [autoError]);

  if (isLoading) return null;

  const isLiveStatus = (s: string) =>
    s === 'queued' || s === 'running' || s === 'waiting';

  const hasActiveRuns = runs.some(r => isLiveStatus(r.status));

  // Fast poll (every 1s) when there are active runs
  useEffect(() => {
    if (hasActiveRuns) {
      fastPollRef.current = setInterval(() => refresh(), 1000);
    }
    return () => {
      if (fastPollRef.current) clearInterval(fastPollRef.current);
    };
  }, [hasActiveRuns, refresh]);

  // Stats for the header
  const stats = useMemo(() => {
    const filtered = agentFilter === ALL_AGENT_ID ? runs : runs.filter(r => r.agentId === agentFilter);
    return {
      total: filtered.length,
      running: filtered.filter(r => isLiveStatus(r.status)).length,
      completed: filtered.filter(r => r.status === 'completed').length,
      failed: filtered.filter(r => r.status === 'failed').length,
    };
  }, [runs, agentFilter]);

  const visibleRuns = useMemo(() => {
    return agentFilter === ALL_AGENT_ID ? runs : runs.filter(r => r.agentId === agentFilter);
  }, [runs, agentFilter]);

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!prompt.trim() || isSubmitting) return;

    setIsSubmitting(true);
    setError(null);
    try {
      const targetAgent = selectedAgentId === AUTO_ROUTE_ID
        ? agents.find(a => a.id === 'agent-hermes')?.id || 'agent-hermes'
        : selectedAgentId;

      await apiClient.createRun(targetAgent, prompt.trim(), 'chat');
      setPrompt('');
      setShowComposer(false);
      // Immediate refresh so the new run appears quickly
      refresh();
    } catch (err: any) {
      console.error('[RunsBoard] Failed to create run:', err);
      setError(err?.message || 'Failed to start run');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAutoSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!autoGoal.trim() || isAutoSubmitting) return;

    setIsAutoSubmitting(true);
    setAutoError(null);
    try {
      await apiClient.createAutonomousRun(autoAgentId, autoGoal.trim(), autoConstraints.trim() || undefined, 'task');
      setAutoGoal('');
      setAutoConstraints('');
      setShowAutoModal(false);
      refresh();
    } catch (err: any) {
      console.error('[RunsBoard] Failed to create autonomous run:', err);
      setAutoError(err?.message || 'Failed to start autonomous task');
    } finally {
      setIsAutoSubmitting(false);
    }
  };

  const selectedAgentLabel =
    selectedAgentId === AUTO_ROUTE_ID
      ? 'Auto-route'
      : agents.find(a => a.id === selectedAgentId)?.name || 'Unknown';

  return (
    <div className="flex-col h-full" style={{ 
      backgroundImage: "linear-gradient(to bottom, rgba(10, 10, 12, 0.8), rgba(10, 10, 12, 0.95)), url('/bg/bg_runs.png')", 
      backgroundSize: 'cover', backgroundPosition: 'center', backgroundAttachment: 'fixed'
    }}>
      <div className="page-header">
        <div className="page-header__title">
          <h1>Runs Overview</h1>
          <p>Global pipeline of all active, waiting, and historical executions.</p>
        </div>
        <div className="page-header__actions" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {/* Agent filter */}
          <select
            value={agentFilter}
            onChange={(e) => setAgentFilter(e.target.value)}
            className="form-input"
            style={{ height: '32px', fontSize: '12px', padding: '0 8px' }}
            aria-label="Filter by agent"
          >
            <option value={ALL_AGENT_ID}>All agents ({runs.length})</option>
            {agents.map(a => {
              const count = runs.filter(r => r.agentId === a.id).length;
              return (
                <option key={a.id} value={a.id}>
                  {a.name} ({count})
                </option>
              );
            })}
          </select>

          <button
            className="btn btn-primary"
            onClick={() => setShowAutoModal(s => !s)}
            style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <Target size={14} />
            New Autonomous Task
          </button>

          <button
            className="btn btn-primary"
            onClick={() => setShowComposer(s => !s)}
            disabled={isSubmitting}
            style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <Plus size={14} />
            New Run
          </button>
        </div>
      </div>

      {/* Quick stats */}
      <div style={{ display: 'flex', gap: '12px', padding: '0 16px 12px', flexWrap: 'wrap' }}>
        <StatPill label="Total" value={stats.total} color="var(--text-secondary)" />
        <StatPill label="In progress" value={stats.running} color="var(--color-warning, #f59e0b)" />
        <StatPill label="Completed" value={stats.completed} color="var(--color-success, #10b981)" />
        <StatPill label="Failed" value={stats.failed} color="var(--color-error, #ef4444)" />
        {hasActiveRuns && (
          <span style={{ fontSize: '10px', color: 'var(--color-warning)', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <Loader2 size={12} className="spin" /> Live
          </span>
        )}
      </div>

      {/* Error toast */}
      {error && (
        <div style={{
          margin: '0 16px 12px', padding: '8px 12px',
          background: 'rgba(239, 68, 68, 0.15)', border: '1px solid rgba(239, 68, 68, 0.3)',
          borderRadius: '6px', fontSize: '0.75rem', color: '#fca5a5',
          display: 'flex', alignItems: 'center', gap: '6px'
        }}>
          <AlertTriangle size={12} />
          {error}
          <button onClick={() => setError(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#fca5a5', cursor: 'pointer' }}>
            <X size={12} />
          </button>
        </div>
      )}

      {/* Inline composer */}
      {showComposer && (
        <form
          onSubmit={handleSubmit}
          style={{
            margin: '0 16px 12px',
            padding: '12px',
            background: 'var(--bg-surface, rgba(255,255,255,0.03))',
            border: '1px solid var(--border-subtle, rgba(255,255,255,0.08))',
            borderRadius: '8px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Sparkles size={14} color="var(--color-primary, #6366f1)" />
            <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>
              New run
            </span>
            <button
              type="button"
              onClick={() => { setShowComposer(false); setError(null); }}
              style={{ marginLeft: 'auto', background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)' }}
              aria-label="Close composer"
            >
              <X size={14} />
            </button>
          </div>

          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <label style={{ fontSize: '11px', color: 'var(--text-tertiary)', minWidth: '70px' }}>
              Agent
            </label>
            <select
              value={selectedAgentId}
              onChange={(e) => setSelectedAgentId(e.target.value)}
              className="form-input"
              disabled={isSubmitting}
              style={{ flex: 1, height: '32px', fontSize: '12px', padding: '0 8px' }}
              aria-label="Target agent"
            >
              <option value={AUTO_ROUTE_ID}>✨ Auto-route (let Hermes decide)</option>
              {agents.map(a => (
                <option key={a.id} value={a.id}>
                  {a.name} — {a.role || a.runtimeId}
                </option>
              ))}
            </select>
          </div>

          <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
            <label style={{ fontSize: '11px', color: 'var(--text-tertiary)', minWidth: '70px', marginTop: '8px' }}>
              Prompt
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  handleSubmit();
                }
              }}
              placeholder={`Describe what ${selectedAgentLabel} should do...`}
              disabled={isSubmitting}
              rows={3}
              className="form-input"
              style={{ flex: 1, fontSize: '12px', padding: '8px', resize: 'vertical', fontFamily: 'inherit' }}
              autoFocus
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>
              Cmd/Ctrl + Enter to send
            </span>
            <button
              type="submit"
              disabled={!prompt.trim() || isSubmitting}
              className="btn btn-primary"
              style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
            >
              {isSubmitting ? <Loader2 size={13} className="spin" /> : <Send size={13} />}
              {isSubmitting ? 'Starting…' : `Send to ${selectedAgentLabel}`}
            </button>
          </div>
        </form>
      )}

      {/* Autonomous Task Modal */}
      {showAutoModal && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 9999,
            background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '16px',
          }}
          onClick={() => { if (!isAutoSubmitting) setShowAutoModal(false); }}
        >
          <form
            onSubmit={handleAutoSubmit}
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--bg-panel, #1a1a1e)',
              border: '1px solid var(--border-color, rgba(255,255,255,0.1))',
              borderRadius: '12px',
              padding: '24px',
              maxWidth: '520px',
              width: '100%',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
              boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Target size={18} color="var(--color-primary, #6366f1)" />
              <span style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)' }}>
                New Autonomous Task
              </span>
              <button
                type="button"
                onClick={() => { if (!isAutoSubmitting) setShowAutoModal(false); }}
                style={{ marginLeft: 'auto', background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)' }}
                aria-label="Close modal"
              >
                <X size={16} />
              </button>
            </div>

            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
                Agent
              </label>
              <select
                value={autoAgentId}
                onChange={(e) => setAutoAgentId(e.target.value)}
                className="form-input"
                disabled={isAutoSubmitting}
                style={{ width: '100%', height: '36px', fontSize: '12px', padding: '0 8px' }}
              >
                {agents.filter(a => ['agent-hermes', 'agent-jarvis', 'agent-athena', 'agent-sentinel', 'agent-video'].includes(a.id)).map(a => (
                  <option key={a.id} value={a.id}>
                    {a.name} — {a.description?.slice(0, 60)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
                Goal <span style={{ color: 'var(--color-error)' }}>*</span>
              </label>
              <textarea
                value={autoGoal}
                onChange={(e) => setAutoGoal(e.target.value)}
                placeholder="e.g. Research competitive landscape for AI agent frameworks Q3 2026"
                disabled={isAutoSubmitting}
                rows={3}
                className="form-input"
                style={{ width: '100%', fontSize: '12px', padding: '8px', resize: 'vertical', fontFamily: 'inherit' }}
                autoFocus
              />
            </div>

            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
                Constraints (optional)
              </label>
              <textarea
                value={autoConstraints}
                onChange={(e) => setAutoConstraints(e.target.value)}
                placeholder="e.g. Focus on open-source frameworks. Exclude proprietary tools. Deliver as markdown report."
                disabled={isAutoSubmitting}
                rows={2}
                className="form-input"
                style={{ width: '100%', fontSize: '12px', padding: '8px', resize: 'vertical', fontFamily: 'inherit' }}
              />
            </div>

            {autoError && (
              <div style={{ fontSize: '11px', color: 'var(--color-error, #ef4444)', padding: '4px 8px', background: 'rgba(239,68,68,0.1)', borderRadius: '4px' }}>
                {autoError}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '4px' }}>
              <button
                type="button"
                onClick={() => { if (!isAutoSubmitting) setShowAutoModal(false); }}
                className="btn btn-ghost"
                disabled={isAutoSubmitting}
                style={{ fontSize: '12px', padding: '8px 16px' }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!autoGoal.trim() || isAutoSubmitting}
                className="btn btn-primary"
                style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', padding: '8px 16px' }}
              >
                {isAutoSubmitting ? <Loader2 size={13} className="spin" /> : <Terminal size={13} />}
                {isAutoSubmitting ? 'Starting...' : 'Launch Task'}
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="board-layout">
        {STATUS_COLUMNS.map(col => {
          const colRuns = visibleRuns.filter(r => r.status === col.key);
          // Sort active runs to the top, then by recency
          const sorted = [...colRuns].sort((a, b) => {
            const aLive = isLiveStatus(a.status);
            const bLive = isLiveStatus(b.status);
            if (aLive && !bLive) return -1;
            if (!aLive && bLive) return 1;
            return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
          });

          return (
            <BoardColumn
              key={col.key}
              title={col.label}
              count={colRuns.length}
              accent={col.color}
            >
              {sorted.map(run => {
                const agent = agents.find(a => a.id === run.agentId);
                const isLive = isLiveStatus(run.status);
                return (
                  <EntityCard
                    key={run.id}
                    title={`Run ${run.id.slice(0, 8)}`}
                    subtitle={agent?.name || 'Unknown Agent'}
                    preview={run.status === 'failed' && run.errorMessage ? run.errorMessage : run.input?.slice(0, 120)}
                    status={run.status}
                    onClick={() => drawer.open('run', run.id)}
                    tags={[run.mode, ...(isLive ? ['Live'] : [])]}
                  />
                );
              })}
            </BoardColumn>
          );
        })}
      </div>
    </div>
  );
};

const StatPill: React.FC<{ label: string; value: number; color: string }> = ({ label, value, color }) => (
  <div
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: '6px',
      padding: '4px 10px',
      borderRadius: '999px',
      background: 'var(--bg-surface, rgba(255,255,255,0.04))',
      border: '1px solid var(--border-subtle, rgba(255,255,255,0.08))',
      fontSize: '11px',
    }}
  >
    <span style={{ color: 'var(--text-tertiary)' }}>{label}</span>
    <span style={{ color, fontWeight: 600 }}>{value}</span>
  </div>
);

export default RunsBoard;
