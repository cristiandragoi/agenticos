// @ts-nocheck
import { useData } from '../store/dataStore';
import React, { useState, useRef, useCallback, useEffect } from 'react';
import StatusBadge from '../components/ui/StatusBadge';
import ContextChip from '../components/ui/ContextChip';
import RoutinesPanel from '../components/routines/RoutinesPanel';
import { useChatManager } from '../hooks/useChatManager';
import { useRevenueIntelligenceSummary } from '../lib/dataport';
import { apiClient, apiFetch, apiUrl } from '../api/client';
import {
  Send,
  Loader2,
  Sparkles,
  Clock,
  Plus,
  Trash2,
  Play,
  RefreshCw,
  X,
  Activity,
  AlertTriangle,
  Target,
  GitBranch,
  CheckCircle,
  Link2,
  CalendarDays,
  Webhook,
} from 'lucide-react';

const AUTO_ROUTE_ID = 'auto';

const INTERVAL_PRESETS = [
  { label: 'Every 30 min', value: '30m' },
  { label: 'Every hour', value: '1h' },
  { label: 'Every 2 hours', value: '2h' },
  { label: 'Every 6 hours', value: '6h' },
  { label: 'Daily', value: '1d' },
  { label: 'Weekly', value: '1w' },
];

const ControlRoom: React.FC = () => {
  const { agents, runs, runtimes, schedules, isLoading, refresh } = useData();
  const { sendMessage, isTyping } = useChatManager();
  const revSummary = useRevenueIntelligenceSummary();

  // ── Composer state ──
  const [promptStr, setPromptStr] = useState('');
  const [selectedAgentId, setSelectedAgentId] = useState<string>(AUTO_ROUTE_ID);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [composerError, setComposerError] = useState<string | null>(null);

  // ── Heavy Gen state ──
  const [showFuguModal, setShowFuguModal] = useState(false);
  const [showFusionModal, setShowFusionModal] = useState(false);
  const [hgProjectName, setHgProjectName] = useState('');
  const [hgBrief, setHgBrief] = useState('');

  // ── Schedule creation state ──
  const [showCreateSchedule, setShowCreateSchedule] = useState(false);
  const [schedName, setSchedName] = useState('');
  const [schedInterval, setSchedInterval] = useState('1h');
  const [schedAgentId, setSchedAgentId] = useState('');
  const [schedPrompt, setSchedPrompt] = useState('');
  const [schedType, setSchedType] = useState<'task' | 'workflow' | 'health-check'>('task');
  const [schedCreating, setSchedCreating] = useState(false);
  const [schedError, setSchedError] = useState<string | null>(null);

  // ── Webhook binding state ──
  const [webhookBindings, setWebhookBindings] = useState<Array<{ id: string; name: string; url: string; scheduleId: string; type: 'n8n' | 'generic' }>>([]);
  const [showAddWebhook, setShowAddWebhook] = useState(false);
  const [whName, setWhName] = useState('');
  const [whUrl, setWhUrl] = useState('');
  const [whScheduleId, setWhScheduleId] = useState('');
  const [whType, setWhType] = useState<'n8n' | 'generic'>('generic');

  // ── Autonomous Task state ──
  const [showAutoTask, setShowAutoTask] = useState(false);
  const [autoTaskGoal, setAutoTaskGoal] = useState('');
  const [autoTaskConstraints, setAutoTaskConstraints] = useState('');
  const [autoTaskAgent, setAutoTaskAgent] = useState<string>('agent-hermes');
  const [autoTaskSubmitting, setAutoTaskSubmitting] = useState(false);
  const [autoTaskResult, setAutoTaskResult] = useState<string | null>(null);
  const [autoTaskError, setAutoTaskError] = useState<string | null>(null);

  // Auto-dismiss error for composer
  useEffect(() => {
    if (composerError) {
      const t = setTimeout(() => setComposerError(null), 5000);
      return () => clearTimeout(t);
    }
  }, [composerError]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!promptStr.trim() || isSubmitting) return;
    setIsSubmitting(true);
    setComposerError(null);
    try {
      await sendMessage(promptStr.trim(), selectedAgentId);
      setPromptStr('');
      refresh();
    } catch (err: any) {
      console.error('[ControlRoom] Failed to create run:', err);
      setComposerError(err?.message || 'Failed to start run. Is the backend running?');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCreateSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!schedName.trim() || !schedPrompt.trim() || !schedAgentId || schedCreating) return;
    setSchedCreating(true);
    setSchedError(null);
    try {
      await apiClient.createSchedule({
        name: schedName.trim(),
        agentId: schedAgentId,
        interval: schedInterval,
        prompt: schedPrompt.trim(),
        type: schedType,
      });
      setShowCreateSchedule(false);
      setSchedName('');
      setSchedPrompt('');
      refresh();
    } catch (err: any) {
      setSchedError(err?.message || 'Failed to create schedule');
    } finally {
      setSchedCreating(false);
    }
  };

  const handleDeleteSchedule = async (id: string) => {
    try {
      await apiClient.deleteSchedule(id);
      refresh();
    } catch (err) {
      console.error('[ControlRoom] Failed to delete schedule:', err);
    }
  };

  const handleRunSchedule = async (id: string) => {
    try {
      await apiClient.runSchedule(id);
      setTimeout(() => refresh(), 500);
    } catch (err) {
      console.error('[ControlRoom] Failed to run schedule:', err);
    }
  };

  // ── Webhook Handlers ──
  const handleAddWebhook = (e: React.FormEvent) => {
    e.preventDefault();
    if (!whName.trim() || !whUrl.trim()) return;
    const newBinding = {
      id: `wh-${Date.now().toString(36)}`,
      name: whName.trim(),
      url: whUrl.trim(),
      scheduleId: whScheduleId || '',
      type: whType,
    };
    setWebhookBindings(prev => [...prev, newBinding]);
    setWhName('');
    setWhUrl('');
    setWhScheduleId('');
    setShowAddWebhook(false);
  };

  const handleRemoveWebhook = (id: string) => {
    setWebhookBindings(prev => prev.filter(w => w.id !== id));
  };

  // Helper: compute next run time for a schedule based on interval
  const computeNextRun = (sched: typeof schedules[0]): string => {
    if (!sched.lastRunAt) return 'Next run pending...';
    const lastRun = new Date(sched.lastRunAt).getTime();
    const now = Date.now();
    const intervalMs = parseInterval(sched.interval);
    if (!intervalMs) return '—';
    const elapsed = now - lastRun;
    if (elapsed >= intervalMs) return 'Due now';
    const remaining = intervalMs - elapsed;
    if (remaining < 60000) return `~${Math.round(remaining / 1000)}s`;
    if (remaining < 3600000) return `~${Math.round(remaining / 60000)}m`;
    return `~${Math.round(remaining / 3600000)}h`;
  };

  const parseInterval = (interval: string): number | null => {
    const match = interval.match(/^(\d+)([mhdw])$/);
    if (!match) return null;
    const val = parseInt(match[1]);
    const unit = match[2];
    switch (unit) {
      case 'm': return val * 60000;
      case 'h': return val * 3600000;
      case 'd': return val * 86400000;
      case 'w': return val * 604800000;
      default: return null;
    }
  };

  // ── Autonomous Task Handler ──
  const handleAutoTaskSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!autoTaskGoal.trim() || autoTaskSubmitting) return;
    setAutoTaskSubmitting(true);
    setAutoTaskError(null);
    setAutoTaskResult(null);
    try {
      await apiClient.createAutonomousRun(autoTaskAgent, autoTaskGoal.trim(), autoTaskConstraints.trim() || undefined, 'task');
      setShowAutoTask(false);
      setAutoTaskGoal('');
      setAutoTaskConstraints('');
      setAutoTaskResult(`✓ Autonomous task dispatched to ${agents.find(a => a.id === autoTaskAgent)?.name || autoTaskAgent}. Monitor progress in the Runs view.`);
      setTimeout(() => { setAutoTaskResult(null); refresh(); }, 100);
    } catch (err: any) {
      setAutoTaskError(err?.message || 'Failed to launch autonomous task');
    } finally {
      setAutoTaskSubmitting(false);
    }
  };

  if (isLoading) return null;

  const runningRuns = runs.filter((r) => r.status === 'running');
  const queuedRuns = runs.filter((r) => r.status === 'queued');
  const failedRuns = runs.filter((r) => r.status === 'failed');
  const completedRuns = runs.filter((r) => r.status === 'completed');
  const liveRuns = [...runningRuns, ...queuedRuns];
  const recentHistory = [...completedRuns, ...failedRuns].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()).slice(0, 10);
  const recentLogs = runs.flatMap((r) => r.logs || []).slice(-50);
  const activeSchedules = (schedules || []).filter((s) => s.status === 'active');
  const pausedSchedules = (schedules || []).filter((s) => s.status === 'paused');

  return (
    <div className="flex-col h-full" style={{ 
      backgroundImage: "linear-gradient(to bottom, rgba(10, 10, 12, 0.8), rgba(10, 10, 12, 0.95)), url('/bg/bg_control_room.png')", 
      backgroundSize: 'cover', backgroundPosition: 'center', backgroundAttachment: 'fixed'
    }}>
      <div className="page-header">
        <div className="page-header__title">
          <h1>Control Room</h1>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: 2 }}>
            Dispatch and supervise tasks, schedules, and system operations.
          </p>
          <span className="text-xxs text-dim" style={{ marginTop: 4 }}>Control Room: place to dispatch and supervise tasks and schedules</span>
        </div>
      </div>

      {/* ── Revenue Intelligence KPIs ── */}
      {revSummary && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <Activity size={16} color="var(--color-hermes)" />
            <h2 style={{ fontSize: '1rem', fontWeight: 600, margin: 0, color: 'var(--text-primary)' }}>Business Outcomes</h2>
            <span style={{ fontSize: '11px', color: '#f59e0b', border: '1px solid #f59e0b', padding: '2px 6px', borderRadius: '4px', marginLeft: 8 }}>Seeded Demo Data</span>
            <span style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginLeft: 8 }}>Real attributed data will be strictly isolated from demo data.</span>
          </div>
          <div className="dashboard-grid">
            <div className="widget-card" style={{ borderTop: '3px solid #10b981' }}>
              <div className="widget-card__header">
                <span className="text-secondary text-sm font-semibold">Total Revenue</span>
              </div>
              <div className="metric-value text-success">${revSummary.totalRevenue?.toLocaleString() || '0'}</div>
            </div>
            <div className="widget-card" style={{ borderTop: '3px solid #ef4444' }}>
              <div className="widget-card__header">
                <span className="text-secondary text-sm font-semibold">Total Spend</span>
              </div>
              <div className="metric-value text-error">${revSummary.totalSpend?.toLocaleString() || '0'}</div>
            </div>
            <div className="widget-card" style={{ borderTop: '3px solid #f59e0b' }}>
              <div className="widget-card__header">
                <span className="text-secondary text-sm font-semibold">Overall ROI</span>
              </div>
              <div className="metric-value text-warning">{revSummary.overallRoi?.toFixed(2) || '0.00'}x</div>
            </div>
            <div className="widget-card" style={{ borderTop: '3px solid var(--color-hermes)' }}>
              <div className="widget-card__header">
                <span className="text-secondary text-sm font-semibold">Conversions</span>
              </div>
              <div className="metric-value text-hermes">{revSummary.totalConversions?.toLocaleString() || '0'}</div>
            </div>
          </div>
        </div>
      )}

      {/* ── Dashboard Widgets ── */}
      <div className="dashboard-grid" style={{ marginBottom: 24 }}>
        <div className="widget-card">
          <div className="widget-card__header">
            <span className="text-secondary text-sm font-semibold">
              Active Runs
            </span>
            <span className="text-xxs text-dim" style={{ marginLeft: 6 }}>currently executing tasks</span>
          </div>
          <div className="metric-value">{runningRuns.length}</div>
        </div>
        <div className="widget-card">
          <div className="widget-card__header">
            <span className="text-secondary text-sm font-semibold">
              Queue Depth
            </span>
            <span className="text-xxs text-dim" style={{ marginLeft: 6 }}>tasks awaiting execution</span>
          </div>
          <div className="metric-value text-warning">{queuedRuns.length}</div>
        </div>
        <div className="widget-card">
          <div className="widget-card__header">
            <span className="text-secondary text-sm font-semibold">
              Failed Runs
            </span>
            <span className="text-xxs text-dim" style={{ marginLeft: 6 }}>tasks that hit errors</span>
          </div>
          <div className="metric-value text-error">{failedRuns.length}</div>
        </div>
        <div className="widget-card">
          <div className="widget-card__header">
            <span className="text-secondary text-sm font-semibold">
              Runtimes
            </span>
            <span className="text-xxs text-dim" style={{ marginLeft: 6 }}>available execution environments</span>
          </div>
          <div className="flex-col gap-2">
            {(runtimes || []).map((rt) => (
              <div
                key={rt.id}
                className="flex-row justify-between text-sm"
              >
                <span>{rt.label}</span>
                <StatusBadge status={rt.health?.status || 'unknown'} />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Recent History ── */}
      {recentHistory.length > 0 && (
        <div className="widget-card" style={{ marginBottom: 24, padding: '12px' }}>
          <div className="widget-card__header" style={{ marginBottom: 12 }}>
            <span className="text-secondary text-sm font-semibold">
              Recent History
            </span>
            <span className="text-xxs text-dim" style={{ marginLeft: 6 }}>completed and failed runs</span>
          </div>
          <div className="flex-col gap-2">
            {recentHistory.map((run) => (
              <div key={run.id} style={{ display: 'flex', alignItems: 'flex-start', padding: '8px', border: '1px solid var(--border-subtle)', borderRadius: '6px', background: 'var(--bg-surface)' }}>
                <StatusBadge status={run.status} style={{ marginTop: 2, marginRight: 12 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)' }}>{run.agentId}</span>
                    <span style={{ fontSize: '0.65rem', color: 'var(--text-dim)' }}>{new Date(run.updatedAt).toLocaleTimeString()}</span>
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: 4, whiteSpace: 'pre-wrap' }}>
                    {run.input}
                  </div>
                  {run.errorMessage && (
                    <div style={{ fontSize: '0.7rem', color: 'var(--color-error)', background: 'rgba(239,68,68,0.1)', padding: '4px 8px', borderRadius: '4px' }}>
                      {run.errorMessage}
                    </div>
                  )}
                  {run.output && !run.errorMessage && (
                    <div style={{ fontSize: '0.7rem', color: 'var(--color-success)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {run.output}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Ask anything composer ── */}
      <form
        onSubmit={handleSubmit}
        style={{
          margin: '0 0 12px',
          padding: '12px',
          background: 'var(--bg-surface, rgba(255,255,255,0.03))',
          border: '1px solid var(--border-subtle, rgba(255,255,255,0.08))',
          borderRadius: '8px',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
        }}
      >
        {/* (Keep existing composer from earlier) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Sparkles size={14} color="var(--color-hermes, #d4a373)" />
          <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>
            Ask anything or request a task
          </span>
          <span className="text-xxs text-dim" style={{ marginLeft: 4 }}>— dispatch work to any agent</span>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <select
            value={selectedAgentId}
            onChange={(e) => setSelectedAgentId(e.target.value)}
            className="form-input"
            disabled={isSubmitting}
            style={{ minWidth: '160px', height: '32px', fontSize: '12px', padding: '0 8px' }}
            aria-label="Target agent"
          >
            <option value={AUTO_ROUTE_ID}>✨ Auto-route</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={promptStr}
            onChange={(e) => setPromptStr(e.target.value)}
            placeholder={`Describe what ${selectedAgentId === AUTO_ROUTE_ID ? 'the system' : agents.find((a) => a.id === selectedAgentId)?.name || 'selected agent'} should do...`}
            disabled={isSubmitting}
            className="form-input"
            style={{ flex: 1, height: '32px', fontSize: '12px', padding: '0 8px' }}
          />
          <button
            type="submit"
            disabled={!promptStr.trim() || isSubmitting || isTyping}
            className="btn btn-primary"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              height: '32px',
              padding: '0 16px',
              background: 'var(--color-hermes, #d4a373)',
              border: 'none',
              borderRadius: '6px',
              color: '#000',
              fontWeight: 600,
              cursor: (!promptStr.trim() || isSubmitting || isTyping) ? 'not-allowed' : 'pointer',
              opacity: (!promptStr.trim() || isSubmitting || isTyping) ? 0.5 : 1,
            }}
          >
            {isSubmitting ? (
              <Loader2 size={13} className="spin" />
            ) : (
              <Send size={13} />
            )}
            {isSubmitting ? 'Starting...' : 'Run'}
          </button>
        </div>
      </form>

      {/* Composer error */}
      {composerError && (
        <div style={{
          marginTop: '-8px', marginBottom: '12px',
          padding: '6px 10px', background: 'rgba(239, 68, 68, 0.12)',
          border: '1px solid rgba(239, 68, 68, 0.25)', borderRadius: '6px',
          fontSize: '11px', color: '#fca5a5',
          display: 'flex', alignItems: 'center', gap: '6px'
        }}>
          <AlertTriangle size={12} />
          {composerError}
          <button onClick={() => setComposerError(null)}
            style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#fca5a5', cursor: 'pointer' }}>
            <X size={12} />
          </button>
        </div>
      )}

      {/* ── Autonomous Task Button ── */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
        <button
          onClick={() => setShowAutoTask(true)}
          className="btn btn-primary"
          style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            padding: '8px 14px', fontSize: '12px',
            background: 'linear-gradient(135deg, var(--color-hermes, #d4a373), #b8860b)',
            color: '#000', border: 'none', borderRadius: '6px',
            fontWeight: 600, cursor: 'pointer',
          }}
        >
          <Target size={14} /> New Autonomous Task
        </button>
        <span className="text-xxs text-dim" style={{ marginTop: 8 }}>delegate open-ended goals to agents</span>
      </div>

      {/* ── Autonomous Task Modal ── */}
      {showAutoTask && (
        <form onSubmit={handleAutoTaskSubmit}
          style={{
            marginBottom: '12px', padding: '14px',
            background: 'var(--bg-surface, rgba(255,255,255,0.04))',
            border: '1px solid var(--color-hermes, #d4a373)', borderRadius: '8px',
            display: 'flex', flexDirection: 'column', gap: '10px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <GitBranch size={14} color="var(--color-hermes)" />
            <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-secondary)' }}>
              New Autonomous Task
            </span>
            <button type="button" onClick={() => { setShowAutoTask(false); setAutoTaskError(null); }}
              style={{ marginLeft: 'auto', background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)' }}>
              <X size={14} />
            </button>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <label style={{ fontSize: '11px', color: 'var(--text-tertiary)', minWidth: '50px' }}>Agent</label>
            <select value={autoTaskAgent} onChange={e => setAutoTaskAgent(e.target.value)}
              className="form-input" disabled={autoTaskSubmitting}
              style={{ flex: 1, height: '32px', fontSize: '12px', padding: '0 8px' }}>
              {agents.filter(a => ['agent-hermes', 'agent-jarvis', 'agent-athena', 'agent-sentinel', 'agent-video', 'agent-qwythos'].includes(a.id)).map(a => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>
          <textarea value={autoTaskGoal} onChange={e => setAutoTaskGoal(e.target.value)}
            placeholder="Describe the high-level goal for this autonomous task..."
            disabled={autoTaskSubmitting} rows={2}
            className="form-input"
            style={{ width: '100%', fontSize: '12px', padding: '8px', resize: 'vertical', fontFamily: 'inherit' }}
            autoFocus />
          <textarea value={autoTaskConstraints} onChange={e => setAutoTaskConstraints(e.target.value)}
            placeholder="Constraints (e.g., time limit, scope boundaries, files to touch)..."
            disabled={autoTaskSubmitting} rows={2}
            className="form-input"
            style={{ width: '100%', fontSize: '12px', padding: '8px', resize: 'vertical', fontFamily: 'inherit' }} />
          {autoTaskError && (
            <div style={{ fontSize: '11px', color: 'var(--color-error)', padding: '4px 8px' }}>
              <AlertTriangle size={11} /> {autoTaskError}
            </div>
          )}
          {autoTaskResult && (
            <div style={{ fontSize: '11px', color: 'var(--color-success)', padding: '4px 8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <CheckCircle size={12} /> {autoTaskResult}
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '6px' }}>
            <button type="button" onClick={() => { setShowAutoTask(false); setAutoTaskError(null); }}
              style={{ height: '30px', padding: '0 12px', fontSize: '11px', background: 'transparent', border: '1px solid var(--border-subtle)', borderRadius: '6px', color: 'var(--text-tertiary)', cursor: 'pointer' }}>
              Cancel
            </button>
            <button type="submit" disabled={!autoTaskGoal.trim() || autoTaskSubmitting}
              className="btn btn-primary"
              style={{ height: '30px', padding: '0 14px', fontSize: '11px', background: 'var(--color-hermes)', color: '#000', border: 'none', borderRadius: '6px', fontWeight: 600, cursor: !autoTaskGoal.trim() || autoTaskSubmitting ? 'not-allowed' : 'pointer', opacity: !autoTaskGoal.trim() || autoTaskSubmitting ? 0.5 : 1 }}>
              {autoTaskSubmitting ? <Loader2 size={12} className="spin" /> : <Send size={12} />}
              {autoTaskSubmitting ? 'Launching...' : 'Launch Autonomous Task'}
            </button>
          </div>
        </form>
      )}

      {/* ── Scheduled Tasks ── */}
      <div
        className="widget-card"
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          marginBottom: 12,
        }}
      >
        <div className="widget-card__header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Clock size={14} color="var(--color-hermes)" />
            <span className="text-secondary text-sm font-semibold">
              Scheduled Tasks
            </span>
            <span className="text-xxs text-dim" style={{ marginLeft: 4 }}>recurring → triggers</span>
            <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
              ({activeSchedules.length + pausedSchedules.length} total)
            </span>
          </div>
          <button
            onClick={() => setShowCreateSchedule(true)}
            className="btn btn-primary"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              padding: '4px 10px',
              fontSize: '11px',
              background: 'var(--color-hermes)',
              color: '#000',
              border: 'none',
              borderRadius: '6px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            <Plus size={12} />
            New Schedule
          </button>
        </div>

        {/* Create Schedule Form */}
        {showCreateSchedule && (
          <form
            onSubmit={handleCreateSchedule}
            style={{
              padding: '12px',
              borderTop: '1px solid var(--border-subtle)',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
            }}
          >
            <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-tertiary)' }}>
              New Scheduled Task
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                type="text"
                value={schedName}
                onChange={(e) => setSchedName(e.target.value)}
                placeholder="Schedule name"
                className="form-input"
                style={{ flex: 1, height: '30px', fontSize: '11px', padding: '0 8px' }}
                required
              />
              <select
                value={schedInterval}
                onChange={(e) => setSchedInterval(e.target.value)}
                className="form-input"
                style={{ width: '120px', height: '30px', fontSize: '11px', padding: '0 6px' }}
              >
                {INTERVAL_PRESETS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <select
                value={schedAgentId}
                onChange={(e) => setSchedAgentId(e.target.value)}
                className="form-input"
                style={{ flex: 1, height: '30px', fontSize: '11px', padding: '0 6px' }}
                required
              >
                <option value="">Select agent...</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
              <select
                value={schedType}
                onChange={(e) =>
                  setSchedType(e.target.value as 'task' | 'workflow' | 'health-check')
                }
                className="form-input"
                style={{ width: '110px', height: '30px', fontSize: '11px', padding: '0 6px' }}
              >
                <option value="task">Task</option>
                <option value="workflow">Workflow</option>
                <option value="health-check">Health Check</option>
              </select>
            </div>
            <textarea
              value={schedPrompt}
              onChange={(e) => setSchedPrompt(e.target.value)}
              placeholder="What should the agent do on each run?"
              className="form-input"
              style={{
                width: '100%',
                minHeight: '40px',
                fontSize: '11px',
                padding: '6px 8px',
                resize: 'vertical',
                fontFamily: 'inherit',
              }}
              required
            />
            {schedError && (
              <div style={{ fontSize: '11px', color: 'var(--color-error)' }}>
                {schedError}
              </div>
            )}
            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => {
                  setShowCreateSchedule(false);
                  setSchedError(null);
                }}
                style={{
                  height: '30px',
                  padding: '0 12px',
                  fontSize: '11px',
                  background: 'transparent',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '6px',
                  color: 'var(--text-tertiary)',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={
                  !schedName.trim() || !schedPrompt.trim() || !schedAgentId || schedCreating
                }
                className="btn btn-primary"
                style={{
                  height: '30px',
                  padding: '0 12px',
                  fontSize: '11px',
                  background: 'var(--color-hermes)',
                  color: '#000',
                  border: 'none',
                  borderRadius: '6px',
                  fontWeight: 600,
                  cursor:
                    !schedName.trim() || !schedPrompt.trim() || !schedAgentId || schedCreating
                      ? 'not-allowed'
                      : 'pointer',
                  opacity:
                    !schedName.trim() || !schedPrompt.trim() || !schedAgentId || schedCreating
                      ? 0.5
                      : 1,
                }}
              >
                {schedCreating ? 'Creating...' : 'Create'}
              </button>
            </div>
          </form>
        )}

        {/* Schedule List */}
        <div
          className="flex-col"
          style={{ maxHeight: 260, overflowY: 'auto' }}
        >
          {(schedules || []).length === 0 ? (
            <div
              style={{
                padding: '16px',
                color: 'var(--text-tertiary)',
                fontSize: '0.8rem',
                fontStyle: 'italic',
                textAlign: 'center',
              }}
            >
              No schedules yet. Create your first scheduled task above.
            </div>
          ) : (
            (schedules || []).map((sched) => {
              const agent = agents.find((a) => a.id === sched.agentId);
              return (
                <div
                  key={sched.id}
                  style={{
                    padding: '10px 12px',
                    borderTop: '1px solid var(--border-subtle)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                  }}
                >
                  {/* Status indicator */}
                  <div
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background:
                        sched.status === 'active'
                          ? 'var(--color-success)'
                          : sched.status === 'error'
                          ? 'var(--color-error)'
                          : 'var(--text-tertiary)',
                      flexShrink: 0,
                    }}
                  />

                  {/* Info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '0.8rem', fontWeight: 600 }}>
                      {sched.name}
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        gap: 6,
                        fontSize: '0.65rem',
                        color: 'var(--text-tertiary)',
                        marginTop: 2,
                        flexWrap: 'wrap',
                      }}
                    >
                      <span>{agent?.name || sched.agentId}</span>
                      <span>·</span>
                      <span>Every {sched.interval}</span>
                      <span>·</span>
                      <ContextChip label={sched.type} />
                      {sched.lastRunStatus && (
                        <>
                          <span>·</span>
                          <StatusBadge status={sched.lastRunStatus} />
                        </>
                      )}
                    </div>
                    {sched.lastRunOutput && (
                      <div
                        style={{
                          fontSize: '0.7rem',
                          color: 'var(--text-tertiary)',
                          marginTop: 2,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          maxWidth: 400,
                        }}
                      >
                        {sched.lastRunOutput}
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                    <button
                      onClick={() => handleRunSchedule(sched.id)}
                      title="Run now"
                      style={{
                        background: 'none',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: '4px',
                        padding: '3px 6px',
                        cursor: 'pointer',
                        color: 'var(--text-tertiary)',
                        display: 'flex',
                        alignItems: 'center',
                      }}
                    >
                      <Play size={12} />
                    </button>
                    <button
                      onClick={() => handleDeleteSchedule(sched.id)}
                      title="Delete schedule"
                      style={{
                        background: 'none',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: '4px',
                        padding: '3px 6px',
                        cursor: 'pointer',
                        color: 'var(--color-error)',
                        display: 'flex',
                        alignItems: 'center',
                      }}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ── Routines ── */}
      <div className="widget-card" style={{ marginBottom: 12 }}>
        <div className="widget-card__header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Clock size={14} color="var(--color-info)" />
            <span className="text-secondary text-sm font-semibold">Routines</span>
            <span className="text-xxs text-dim">canonical scheduled worker jobs</span>
          </div>
        </div>
        <RoutinesPanel />
      </div>

      {/* ── Webhook / Trigger Bindings ── */}
      <div className="widget-card" style={{ marginBottom: 12 }}>
        <div className="widget-card__header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Link2 size={14} color="var(--color-info)" />
            <span className="text-secondary text-sm font-semibold">
              Webhook / Trigger Bindings
            </span>
            <span className="text-xxs text-dim">bind external flows → trigger runs</span>
          </div>
          <button
            onClick={() => setShowAddWebhook(true)}
            className="btn btn-primary"
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              padding: '4px 10px', fontSize: '11px',
              background: 'var(--color-info)',
              color: '#000', border: 'none', borderRadius: '6px',
              fontWeight: 600, cursor: 'pointer',
            }}
          >
            <Plus size={12} />
            Add Webhook
          </button>
        </div>

        {/* Add Webhook Form */}
        {showAddWebhook && (
          <form onSubmit={handleAddWebhook}
            style={{
              padding: '12px', borderTop: '1px solid var(--border-subtle)',
              display: 'flex', flexDirection: 'column', gap: '8px',
            }}
          >
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                type="text" value={whName} onChange={e => setWhName(e.target.value)}
                placeholder="Webhook name (e.g. n8n SEO Workflow)"
                className="form-input"
                style={{ flex: 1, height: '30px', fontSize: '11px', padding: '0 8px' }}
                required
              />
              <select
                value={whType} onChange={e => setWhType(e.target.value as any)}
                className="form-input"
                style={{ width: '100px', height: '30px', fontSize: '11px', padding: '0 6px' }}
              >
                <option value="generic">Generic</option>
                <option value="n8n">n8n</option>
              </select>
            </div>
            <input
              type="url" value={whUrl} onChange={e => setWhUrl(e.target.value)}
              placeholder="Webhook URL (e.g. https://your-n8n.example.com/webhook/...)"
              className="form-input"
              style={{ width: '100%', height: '30px', fontSize: '11px', padding: '0 8px' }}
              required
            />
            <select
              value={whScheduleId} onChange={e => setWhScheduleId(e.target.value)}
              className="form-input"
              style={{ width: '100%', height: '30px', fontSize: '11px', padding: '0 8px' }}
            >
              <option value="">Bind to schedule (optional)</option>
              {(schedules || []).map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => setShowAddWebhook(false)}
                style={{ height: '28px', padding: '0 10px', fontSize: '11px', background: 'transparent', border: '1px solid var(--border-subtle)', borderRadius: '6px', color: 'var(--text-tertiary)', cursor: 'pointer' }}>
                Cancel
              </button>
              <button type="submit"
                style={{ height: '28px', padding: '0 10px', fontSize: '11px', background: 'var(--color-info)', color: '#000', border: 'none', borderRadius: '6px', fontWeight: 600, cursor: 'pointer' }}>
                Add Binding
              </button>
            </div>
          </form>
        )}

        {/* Webhook List */}
        <div className="flex-col" style={{ maxHeight: 160, overflowY: 'auto' }}>
          {webhookBindings.length === 0 ? (
            <div style={{ padding: '16px', color: 'var(--text-tertiary)', fontSize: '0.8rem', fontStyle: 'italic', textAlign: 'center' }}>
              No webhook bindings yet. Add a webhook URL to trigger runs from N8N or other services.
            </div>
          ) : (
            webhookBindings.map(wh => {
              const boundSched = (schedules || []).find(s => s.id === wh.scheduleId);
              return (
                <div key={wh.id}
                  style={{ padding: '10px 12px', borderTop: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Webhook size={14} color="var(--color-info)" style={{ flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '0.8rem', fontWeight: 600 }}>{wh.name}</div>
                    <div style={{ fontSize: '0.65rem', color: 'var(--text-tertiary)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <span className="text-xxs" style={{ background: 'var(--bg-elevated)', padding: '1px 4px', borderRadius: 3, marginRight: 4 }}>{wh.type}</span>
                      {wh.url}
                      {boundSched && <><span style={{ margin: '0 4px' }}>→</span>{boundSched.name}</>}
                    </div>
                  </div>
                  <button onClick={() => handleRemoveWebhook(wh.id)}
                    title="Remove webhook"
                    style={{ background: 'none', border: '1px solid var(--border-subtle)', borderRadius: '4px', padding: '3px 6px', cursor: 'pointer', color: 'var(--color-error)', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                    <Trash2 size={12} />
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ── Upcoming Executions ── */}
      <div className="widget-card" style={{ marginBottom: 12 }}>
        <div className="widget-card__header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <CalendarDays size={14} color="var(--color-hermes)" />
            <span className="text-secondary text-sm font-semibold">
              Upcoming Executions
            </span>
            <span className="text-xxs text-dim">next expected run times for active schedules</span>
          </div>
        </div>
        <div className="flex-col" style={{ maxHeight: 180, overflowY: 'auto' }}>
          {(schedules || []).filter(s => s.status === 'active').length === 0 ? (
            <div style={{ padding: '16px', color: 'var(--text-tertiary)', fontSize: '0.8rem', fontStyle: 'italic', textAlign: 'center' }}>
              No active schedules. Create one above to see upcoming executions.
            </div>
          ) : (
            (schedules || []).filter(s => s.status === 'active').map(sched => {
              const agent = agents.find(a => a.id === sched.agentId);
              return (
                <div key={sched.id}
                  style={{ padding: '10px 12px', borderTop: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--color-success)', flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '0.8rem', fontWeight: 600 }}>{sched.name}</div>
                    <div style={{ display: 'flex', gap: 6, fontSize: '0.65rem', color: 'var(--text-tertiary)', marginTop: 2, flexWrap: 'wrap' }}>
                      <span>Every {sched.interval}</span>
                      <span>·</span>
                      <span>{agent?.name || sched.agentId}</span>
                      <span>·</span>
                      <span>Next: <strong style={{ color: 'var(--text-secondary)' }}>{computeNextRun(sched)}</strong></span>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
      <div
        className="widget-card"
        style={{ flex: 1, display: 'flex', flexDirection: 'column', marginBottom: 12 }}
      >
        <div className="widget-card__header">
          <span className="text-secondary text-sm font-semibold">
            Live Event Log
          </span>
          <span className="text-xxs text-dim">real-time agent activity stream</span>
        </div>
        <div className="log-stream" style={{ flex: 1 }}>
          {recentLogs.map((log, i) => (
            <div key={i} className="log-stream__entry flex-row gap-2">
              <span className="log-stream__timestamp">
                {new Date().toISOString().slice(11, 19)}
              </span>
              <span>{log}</span>
            </div>
          ))}
          {recentLogs.length === 0 && (
            <div className="text-muted text-xs">No active streams.</div>
          )}
        </div>
      </div>

      {/* ── Heavy Generation Pipelines ── */}
      <div className="widget-card" style={{ marginBottom: 12 }}>
        <div className="widget-card__header">
          <span className="text-secondary text-sm font-semibold">
            Heavy Generation Pipelines
          </span>
          <span className="text-xxs text-dim">long-running batch builds</span>
        </div>
        <div style={{ display: 'flex', gap: '12px', padding: '12px 16px', flexDirection: 'column' }}>
          <div style={{ display: 'flex', gap: '12px' }}>
            <button
              className="btn btn-primary"
              style={{ padding: '8px 16px', background: 'var(--color-hermes, #d4a373)', color: '#000', fontWeight: 'bold' }}
              onClick={() => setShowFuguModal(!showFuguModal)}
            >
              🚀 Run Fugu Project Build
            </button>
            <button
              className="btn btn-primary"
              style={{ padding: '8px 16px', background: 'var(--color-info, #4cc9f0)', color: '#000', fontWeight: 'bold' }}
              onClick={() => setShowFusionModal(!showFusionModal)}
            >
              🧠 Run Fusion Planner
            </button>
          </div>

          {showFuguModal && (
            <div style={{ padding: '12px', background: 'rgba(255,255,255,0.05)', borderRadius: '8px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ fontSize: '12px', fontWeight: 'bold' }}>Fugu Project Builder</div>
              <input type="text" placeholder="Project Name" className="form-input" value={hgProjectName} onChange={e => setHgProjectName(e.target.value)} />
              <textarea placeholder="Project Brief" className="form-input" value={hgBrief} onChange={e => setHgBrief(e.target.value)} style={{ minHeight: '60px' }} />
              <button 
                className="btn btn-primary"
                onClick={() => {
                  if (!hgProjectName || !hgBrief) return;
                  apiFetch('/api/heavy-gen/fugu', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ projectName: hgProjectName, brief: hgBrief })
                  }).then(res => res.json()).then(data => { alert(data.message); setShowFuguModal(false); setHgProjectName(''); setHgBrief(''); refresh(); }).catch(console.error);
                }}
              >Submit to Fugu</button>
            </div>
          )}

          {showFusionModal && (
            <div style={{ padding: '12px', background: 'rgba(255,255,255,0.05)', borderRadius: '8px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ fontSize: '12px', fontWeight: 'bold' }}>Fusion Project Planner</div>
              <input type="text" placeholder="Project Name" className="form-input" value={hgProjectName} onChange={e => setHgProjectName(e.target.value)} />
              <textarea placeholder="Project Brief" className="form-input" value={hgBrief} onChange={e => setHgBrief(e.target.value)} style={{ minHeight: '60px' }} />
              <button 
                className="btn btn-primary"
                onClick={() => {
                  if (!hgProjectName || !hgBrief) return;
                  apiFetch('/api/heavy-gen/fusion', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ projectName: hgProjectName, brief: hgBrief })
                  }).then(res => res.json()).then(data => { alert(data.message); setShowFusionModal(false); setHgProjectName(''); setHgBrief(''); refresh(); }).catch(console.error);
                }}
              >Submit to Fusion</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ControlRoom;

