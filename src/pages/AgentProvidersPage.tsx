// @ts-nocheck
import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../api/client';
import {
  Server, Cpu, Shield, Key, CheckCircle, XCircle, AlertTriangle,
  RefreshCw, Activity, Zap, Play, Lock, Globe, Terminal, Settings,
  Check, Info, Sliders, ArrowRight
} from 'lucide-react';

interface AntigravityStatus {
  providerId: string;
  name: string;
  category: string;
  kind: string;
  configured: boolean;
  maskedPreview: string | null;
  reachable: boolean;
  status: 'connected' | 'needs-auth' | 'error';
  lastTestedAt: string | null;
  latencyMs: number;
  errorMessage?: string;
  config: {
    maxTotalTokens: number;
    maxEstimatedCostUsd: number;
    timeoutMs: number;
    autoRetries: number;
    defaultModel: string;
    enabled: boolean;
  };
}

const AgentProvidersPage: React.FC = () => {
  // State for Hermes
  const [hermesStatus, setHermesStatus] = useState<any>(null);
  const [hermesLoading, setHermesLoading] = useState<boolean>(false);

  // State for Ollama
  const [ollamaStatus, setOllamaStatus] = useState<any>(null);
  const [ollamaLoading, setOllamaLoading] = useState<boolean>(false);

  // State for Antigravity
  const [antigravityStatus, setAntigravityStatus] = useState<AntigravityStatus | null>(null);
  const [antigravityLoading, setAntigravityLoading] = useState<boolean>(false);
  const [antigravityTesting, setAntigravityTesting] = useState<boolean>(false);
  const [testResult, setTestResult] = useState<any>(null);

  // Modal / Key configuration state
  const [keyModalOpen, setKeyModalOpen] = useState<boolean>(false);
  const [apiKeyInput, setApiKeyInput] = useState<string>('');
  const [keySaving, setKeySaving] = useState<boolean>(false);
  const [keyError, setKeyError] = useState<string | null>(null);

  // Configurable limits state
  const [limitsForm, setLimitsForm] = useState({
    maxTotalTokens: 8192,
    maxEstimatedCostUsd: 0.50,
    timeoutMs: 60000,
    autoRetries: 0,
    defaultModel: 'gemini-2.5-flash',
  });
  const [limitsSaving, setLimitsSaving] = useState<boolean>(false);
  const [limitsSavedMessage, setLimitsSavedMessage] = useState<string | null>(null);

  // Read-only run probe state
  const [probePrompt, setProbePrompt] = useState<string>('Analyze current system architecture advantages and suggest optimizations.');
  const [probeRunning, setProbeRunning] = useState<boolean>(false);
  const [probeResult, setProbeResult] = useState<any>(null);
  const [probeError, setProbeError] = useState<string | null>(null);

  // Load status for all providers
  const loadStatuses = useCallback(async () => {
    // 1. Antigravity status
    try {
      setAntigravityLoading(true);
      const res = await apiFetch('/api/antigravity/status');
      if (res.ok) {
        const data: AntigravityStatus = await res.json();
        setAntigravityStatus(data);
        if (data.config) {
          setLimitsForm({
            maxTotalTokens: data.config.maxTotalTokens ?? 8192,
            maxEstimatedCostUsd: data.config.maxEstimatedCostUsd ?? 0.50,
            timeoutMs: data.config.timeoutMs ?? 60000,
            autoRetries: data.config.autoRetries ?? 0,
            defaultModel: data.config.defaultModel || 'gemini-2.5-flash',
          });
        }
      }
    } catch (err) {
      console.warn('Failed to fetch Antigravity status', err);
    } finally {
      setAntigravityLoading(false);
    }

    // 2. Hermes status
    try {
      setHermesLoading(true);
      const res = await apiFetch('/api/hermes-api/status');
      if (res.ok) {
        const data = await res.json();
        setHermesStatus(data);
      }
    } catch (err) {
      console.warn('Failed to fetch Hermes status', err);
    } finally {
      setHermesLoading(false);
    }

    // 3. Ollama status
    try {
      setOllamaLoading(true);
      const res = await apiFetch('/api/providers/prov-ollama/models');
      if (res.ok) {
        const data = await res.json();
        setOllamaStatus(data);
      }
    } catch (err) {
      console.warn('Failed to fetch Ollama status', err);
    } finally {
      setOllamaLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStatuses();
  }, [loadStatuses]);

  // Test Antigravity connection
  const handleTestAntigravity = async () => {
    setAntigravityTesting(true);
    setTestResult(null);
    try {
      const res = await apiFetch('/api/antigravity/test', { method: 'POST' });
      const data = await res.json();
      setTestResult(data);
      loadStatuses();
    } catch (err: any) {
      setTestResult({ reachable: false, errorMessage: err?.message || 'Network error' });
    } finally {
      setAntigravityTesting(false);
    }
  };

  // Save Antigravity API Key securely
  const handleSaveKey = async () => {
    if (!apiKeyInput.trim()) {
      setKeyError('Please enter a valid API key');
      return;
    }
    setKeySaving(true);
    setKeyError(null);
    try {
      const res = await apiFetch('/api/antigravity/credentials', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: apiKeyInput.trim() }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Failed to save credential');
      }
      setApiKeyInput('');
      setKeyModalOpen(false);
      loadStatuses();
    } catch (err: any) {
      setKeyError(err?.message || 'Failed to save credential');
    } finally {
      setKeySaving(false);
    }
  };

  // Remove Antigravity API Key
  const handleDeleteKey = async () => {
    if (!window.confirm('Are you sure you want to remove the stored Antigravity API key?')) return;
    setKeySaving(true);
    try {
      await apiFetch('/api/antigravity/credentials', { method: 'DELETE' });
      setKeyModalOpen(false);
      loadStatuses();
    } catch (err: any) {
      alert('Failed to delete key: ' + err.message);
    } finally {
      setKeySaving(false);
    }
  };

  // Save Limits Form
  const handleSaveLimits = async (e: React.FormEvent) => {
    e.preventDefault();
    setLimitsSaving(true);
    setLimitsSavedMessage(null);
    try {
      const res = await apiFetch('/api/antigravity/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(limitsForm),
      });
      if (!res.ok) throw new Error('Failed to update configuration limits');
      setLimitsSavedMessage('Limits updated successfully');
      setTimeout(() => setLimitsSavedMessage(null), 3000);
      loadStatuses();
    } catch (err: any) {
      alert(err.message || 'Error updating limits');
    } finally {
      setLimitsSaving(false);
    }
  };

  // Execute Read-Only Test Probe
  const handleRunProbe = async () => {
    setProbeRunning(true);
    setProbeResult(null);
    setProbeError(null);
    try {
      const res = await apiFetch('/api/antigravity/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: probePrompt,
          model: limitsForm.defaultModel,
          approvedForExternalTransmission: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || data.error || 'Execution failed');
      }
      setProbeResult(data);
    } catch (err: any) {
      setProbeError(err?.message || 'Read-only execution failed');
    } finally {
      setProbeRunning(false);
    }
  };

  return (
    <div
      className="flex-col h-full"
      style={{
        padding: '24px 32px',
        overflowY: 'auto',
        background: 'var(--bg-app)',
      }}
    >
      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h1 style={{ fontSize: '1.6rem', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
              Agent Providers
            </h1>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: 4 }}>
              AgenticOS Control Plane • Execution Runtimes and Cloud Providers
            </p>
          </div>
          <button
            className="btn btn-secondary btn-sm"
            onClick={loadStatuses}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <RefreshCw size={14} className={antigravityLoading ? 'animate-spin' : ''} />
            Refresh All
          </button>
        </div>
      </div>

      {/* Provider Cards Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
          gap: 20,
          marginBottom: 32,
        }}
      >
        {/* ─── CARD 1: HERMES ─── */}
        <div
          data-testid="provider-card-hermes"
          style={{
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 12,
            padding: 20,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 8,
                    background: 'rgba(217, 119, 6, 0.15)',
                    border: '1px solid rgba(217, 119, 6, 0.4)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#f59e0b',
                  }}
                >
                  <Cpu size={20} />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 600 }}>Hermes</h3>
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>Autonomous Runtime</span>
                </div>
              </div>
              <span
                style={{
                  fontSize: '0.7rem',
                  fontWeight: 600,
                  padding: '3px 8px',
                  borderRadius: 12,
                  background: hermesStatus?.reachable ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                  color: hermesStatus?.reachable ? '#22c55e' : '#ef4444',
                  border: `1px solid ${hermesStatus?.reachable ? 'rgba(34, 197, 94, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
                }}
              >
                {hermesStatus?.reachable ? '✓ Reachable' : 'Offline / In-Repo'}
              </span>
            </div>

            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 16 }}>
              Primary reasoning and planning runtime. Dispatches multi-step goals via the live Hermes API server with automatic in-repo engine fallback.
            </p>

            <div style={{ fontSize: '0.75rem', background: 'rgba(0,0,0,0.2)', padding: '10px 12px', borderRadius: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ color: 'var(--text-tertiary)' }}>Mode:</span>
                <span style={{ fontWeight: 600 }}>In-Repo + Gateway API</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ color: 'var(--text-tertiary)' }}>Model:</span>
                <span>{hermesStatus?.model || 'deepseek-v4-flash / gpt-oss'}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-tertiary)' }}>Status detail:</span>
                <span style={{ color: 'var(--text-secondary)' }}>{hermesStatus?.detail || 'Ready'}</span>
              </div>
            </div>
          </div>

          <div style={{ marginTop: 18, display: 'flex', gap: 8 }}>
            <a href="#/hermes-studio" className="btn btn-secondary btn-sm" style={{ flex: 1, textAlign: 'center' }}>
              Open Studio
            </a>
          </div>
        </div>

        {/* ─── CARD 2: OLLAMA ─── */}
        <div
          data-testid="provider-card-ollama"
          style={{
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 12,
            padding: 20,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 8,
                    background: 'rgba(56, 189, 248, 0.15)',
                    border: '1px solid rgba(56, 189, 248, 0.4)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#38bdf8',
                  }}
                >
                  <Server size={20} />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 600 }}>Ollama</h3>
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>Local LLM Runtime</span>
                </div>
              </div>
              <span
                style={{
                  fontSize: '0.7rem',
                  fontWeight: 600,
                  padding: '3px 8px',
                  borderRadius: 12,
                  background: ollamaStatus?.reachable ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                  color: ollamaStatus?.reachable ? '#22c55e' : '#ef4444',
                  border: `1px solid ${ollamaStatus?.reachable ? 'rgba(34, 197, 94, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
                }}
              >
                {ollamaStatus?.reachable ? '✓ Connected (11434)' : 'Offline'}
              </span>
            </div>

            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 16 }}>
              On-device model runner. 100% private, zero token costs, handles local heartbeat model tasks and offline development.
            </p>

            <div style={{ fontSize: '0.75rem', background: 'rgba(0,0,0,0.2)', padding: '10px 12px', borderRadius: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ color: 'var(--text-tertiary)' }}>Port:</span>
                <span style={{ fontWeight: 600 }}>127.0.0.1:11434</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ color: 'var(--text-tertiary)' }}>Auth:</span>
                <span style={{ color: '#22c55e' }}>None required (Local)</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-tertiary)' }}>Installed models:</span>
                <span>{ollamaStatus?.models?.length || 0} model(s)</span>
              </div>
            </div>
          </div>

          <div style={{ marginTop: 18, display: 'flex', gap: 8 }}>
            <a href="#/models" className="btn btn-secondary btn-sm" style={{ flex: 1, textAlign: 'center' }}>
              Manage Models
            </a>
          </div>
        </div>

        {/* ─── CARD 3: ANTIGRAVITY ─── */}
        <div
          data-testid="provider-card-antigravity"
          style={{
            background: 'var(--bg-elevated)',
            border: '1px solid rgba(139, 92, 246, 0.4)',
            borderRadius: 12,
            padding: 20,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            boxShadow: '0 4px 20px rgba(139, 92, 246, 0.08)',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 8,
                    background: 'rgba(139, 92, 246, 0.15)',
                    border: '1px solid rgba(139, 92, 246, 0.5)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#a78bfa',
                  }}
                >
                  <Zap size={20} />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 600 }}>Antigravity</h3>
                  <span style={{ fontSize: '0.7rem', color: '#a78bfa' }}>Google Gemini API Provider</span>
                </div>
              </div>
              <span
                style={{
                  fontSize: '0.7rem',
                  fontWeight: 600,
                  padding: '3px 8px',
                  borderRadius: 12,
                  background: antigravityStatus?.status === 'connected'
                    ? 'rgba(34, 197, 94, 0.15)'
                    : antigravityStatus?.status === 'needs-auth'
                    ? 'rgba(234, 179, 8, 0.15)'
                    : 'rgba(239, 68, 68, 0.15)',
                  color: antigravityStatus?.status === 'connected'
                    ? '#22c55e'
                    : antigravityStatus?.status === 'needs-auth'
                    ? '#eab308'
                    : '#ef4444',
                  border: `1px solid ${
                    antigravityStatus?.status === 'connected'
                      ? 'rgba(34, 197, 94, 0.3)'
                      : antigravityStatus?.status === 'needs-auth'
                      ? 'rgba(234, 179, 8, 0.3)'
                      : 'rgba(239, 68, 68, 0.3)'
                  }`,
                }}
              >
                {antigravityStatus?.status === 'connected'
                  ? '✓ Connected'
                  : antigravityStatus?.status === 'needs-auth'
                  ? '⚠ Needs Key'
                  : 'Error'}
              </span>
            </div>

            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 16 }}>
              Execution adapter powered by Google Gemini API (generateContent). Enables read-only deep analysis and autonomous agent tasks with explicit file authorization.
            </p>

            <div style={{ fontSize: '0.75rem', background: 'rgba(0,0,0,0.2)', padding: '10px 12px', borderRadius: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ color: 'var(--text-tertiary)' }}>Credential:</span>
                <span style={{ fontWeight: 600, color: antigravityStatus?.configured ? '#22c55e' : '#eab308' }}>
                  {antigravityStatus?.configured ? `Configured (${antigravityStatus.maskedPreview || '***'})` : 'Missing API Key'}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ color: 'var(--text-tertiary)' }}>Model:</span>
                <span>{antigravityStatus?.config?.defaultModel || 'gemini-2.5-flash'}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-tertiary)' }}>Safety mode:</span>
                <span style={{ color: '#38bdf8' }}>Read-Only • Explicit File Approval</span>
              </div>
            </div>

            {testResult && (
              <div
                style={{
                  marginTop: 10,
                  padding: '8px 10px',
                  borderRadius: 6,
                  fontSize: '0.7rem',
                  background: testResult.reachable ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                  color: testResult.reachable ? '#22c55e' : '#ef4444',
                  border: `1px solid ${testResult.reachable ? 'rgba(34, 197, 94, 0.2)' : 'rgba(239, 68, 68, 0.2)'}`,
                }}
              >
                {testResult.reachable ? `✓ Probe passed in ${testResult.latencyMs}ms` : `✗ Probe failed: ${testResult.errorMessage}`}
              </div>
            )}
          </div>

          <div style={{ marginTop: 18, display: 'flex', gap: 8 }}>
            <button
              className="btn btn-primary btn-sm"
              onClick={() => setKeyModalOpen(true)}
              style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
            >
              <Key size={13} />
              {antigravityStatus?.configured ? 'Edit Key' : 'Configure Key'}
            </button>
            <button
              className="btn btn-secondary btn-sm"
              onClick={handleTestAntigravity}
              disabled={antigravityTesting || !antigravityStatus?.configured}
              style={{ display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <Activity size={13} className={antigravityTesting ? 'animate-spin' : ''} />
              Test
            </button>
          </div>
        </div>
      </div>

      {/* Execution Limits & Configuration */}
      <div
        style={{
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 12,
          padding: 24,
          marginBottom: 32,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <Sliders size={18} color="#a78bfa" />
          <h2 style={{ fontSize: '1.15rem', fontWeight: 600, margin: 0 }}>
            Antigravity Execution Limits & Safety Controls
          </h2>
        </div>

        <form onSubmit={handleSaveLimits}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: 20,
              marginBottom: 20,
            }}
          >
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
                Max Total Tokens
              </label>
              <input
                type="number"
                min="256"
                max="128000"
                step="256"
                className="input"
                style={{ width: '100%' }}
                value={limitsForm.maxTotalTokens}
                onChange={(e) => setLimitsForm({ ...limitsForm, maxTotalTokens: parseInt(e.target.value) || 8192 })}
              />
              <span style={{ fontSize: '0.65rem', color: 'var(--text-tertiary)' }}>Hard ceiling for input + output tokens</span>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
                Max Estimated Cost ($USD)
              </label>
              <input
                type="number"
                min="0.01"
                max="20.0"
                step="0.05"
                className="input"
                style={{ width: '100%' }}
                value={limitsForm.maxEstimatedCostUsd}
                onChange={(e) => setLimitsForm({ ...limitsForm, maxEstimatedCostUsd: parseFloat(e.target.value) || 0.50 })}
              />
              <span style={{ fontSize: '0.65rem', color: 'var(--text-tertiary)' }}>Budget limit per execution run</span>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
                Timeout (Seconds)
              </label>
              <input
                type="number"
                min="5"
                max="300"
                step="5"
                className="input"
                style={{ width: '100%' }}
                value={limitsForm.timeoutMs / 1000}
                onChange={(e) => setLimitsForm({ ...limitsForm, timeoutMs: (parseInt(e.target.value) || 60) * 1000 })}
              />
              <span style={{ fontSize: '0.65rem', color: 'var(--text-tertiary)' }}>Abort request if inference stalls</span>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
                Automatic Retries
              </label>
              <input
                type="number"
                min="0"
                max="3"
                className="input"
                style={{ width: '100%' }}
                value={limitsForm.autoRetries}
                onChange={(e) => setLimitsForm({ ...limitsForm, autoRetries: parseInt(e.target.value) || 0 })}
              />
              <span style={{ fontSize: '0.65rem', color: 'var(--text-tertiary)' }}>Disabled by default (0) to prevent cost runaway</span>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button type="submit" className="btn btn-primary btn-sm" disabled={limitsSaving}>
              {limitsSaving ? 'Saving...' : 'Save Limits'}
            </button>
            {limitsSavedMessage && (
              <span style={{ fontSize: '0.75rem', color: '#22c55e', display: 'flex', alignItems: 'center', gap: 4 }}>
                <Check size={14} /> {limitsSavedMessage}
              </span>
            )}
          </div>
        </form>
      </div>

      {/* Experimental Read-Only Execution Sandbox */}
      <div
        style={{
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 12,
          padding: 24,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <Terminal size={18} color="#38bdf8" />
          <h2 style={{ fontSize: '1.15rem', fontWeight: 600, margin: 0 }}>
            Experimental Read-Only Analysis Probe
          </h2>
        </div>

        <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 16 }}>
          Run an isolated query through Antigravity. Operates strictly read-only and respects token budget limits.
        </p>

        <div style={{ marginBottom: 16 }}>
          <textarea
            className="input"
            rows={3}
            style={{ width: '100%', resize: 'vertical' }}
            value={probePrompt}
            onChange={(e) => setProbePrompt(e.target.value)}
            placeholder="Enter an objective or question for Antigravity..."
          />
        </div>

        <button
          className="btn btn-primary btn-sm"
          onClick={handleRunProbe}
          disabled={probeRunning || !antigravityStatus?.configured || !probePrompt.trim()}
          style={{ display: 'flex', alignItems: 'center', gap: 6 }}
        >
          <Play size={13} className={probeRunning ? 'animate-pulse' : ''} />
          {probeRunning ? 'Executing Inference…' : 'Run Read-Only Probe'}
        </button>

        {probeError && (
          <div style={{ marginTop: 16, padding: 12, borderRadius: 8, background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', fontSize: '0.8rem', border: '1px solid rgba(239, 68, 68, 0.3)' }}>
            <strong>Error:</strong> {probeError}
          </div>
        )}

        {probeResult && (
          <div style={{ marginTop: 16, background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border-subtle)', borderRadius: 8, padding: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: 8 }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#38bdf8' }}>
                Output from {probeResult.model} ({probeResult.latencyMs}ms)
              </span>
              <span style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>
                Tokens: {probeResult.usage.totalTokens} • Est. Cost: ${probeResult.usage.estimatedCostUsd.toFixed(5)}
              </span>
            </div>
            <pre style={{ margin: 0, fontSize: '0.8rem', whiteSpace: 'pre-wrap', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
              {probeResult.text}
            </pre>
          </div>
        )}
      </div>

      {/* ─── SECURE API KEY MODAL ─── */}
      {keyModalOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.7)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
          }}
        >
          <div
            style={{
              width: 460,
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 12,
              padding: 24,
              boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <Lock size={18} color="#a78bfa" />
              <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 600 }}>Configure Antigravity Credential</h3>
            </div>

            <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: 16 }}>
              Your Google Gemini / Antigravity API key will be encrypted and securely stored in your local operating system credential vault (keytar / wincred). It is never sent to any server other than Google's API endpoints.
            </p>

            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: 6 }}>
                Gemini API Key
              </label>
              <input
                type="password"
                className="input"
                style={{ width: '100%' }}
                placeholder="AIzaSy..."
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
              />
            </div>

            {keyError && (
              <div style={{ color: '#ef4444', fontSize: '0.75rem', marginBottom: 12 }}>
                {keyError}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
              {antigravityStatus?.configured && (
                <button
                  type="button"
                  className="btn btn-danger btn-sm"
                  onClick={handleDeleteKey}
                  disabled={keySaving}
                >
                  Remove Key
                </button>
              )}
              <div style={{ display: 'flex', gap: 10, marginLeft: 'auto' }}>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => { setKeyModalOpen(false); setKeyError(null); }}
                  disabled={keySaving}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={handleSaveKey}
                  disabled={keySaving || !apiKeyInput.trim()}
                >
                  {keySaving ? 'Saving...' : 'Save Securely'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AgentProvidersPage;
