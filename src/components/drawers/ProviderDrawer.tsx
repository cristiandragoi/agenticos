// @ts-nocheck
import { useData } from '../../store/dataStore';
import React, { useState, useEffect, useMemo } from 'react';

import DrawerShell from './DrawerShell';
import StatusBadge from '../ui/StatusBadge';
import ContextChip from '../ui/ContextChip';
import { apiClient, apiFetch, apiUrl } from '../../api/client';
import {
  Key, Eye, EyeOff, CheckCircle, XCircle, Users, RefreshCw,
  Activity, Wifi, WifiOff, Monitor, Globe, Server, Cpu,
  AlertTriangle, Zap, ArrowRight, Settings, HardDrive,
  Save, Trash2, ChevronDown, ChevronUp, Shield,
} from 'lucide-react';

const CATEGORY_ICONS = {
  local: <Monitor size={14} />,
  remote: <Globe size={14} />,
  infra: <Server size={14} />,
};

const CATEGORY_COLORS = {
  local: 'var(--color-provider-local)',
  remote: 'var(--color-provider-remote)',
  infra: 'var(--color-provider-infra)',
};

/** Determine which provider + model a given agent will actively use */
function getAgentActiveProvider(agent, providers, provider) {
  const agentProvIds = agent.providerIds || [];
  // 1) If this provider is the agent's first assigned LLM, show it
  const llmProviders = provider 
    ? [provider] 
    : providers.filter(p => p.kind === 'llm');
  
  // Return "{provider name} · {model}" or null
  const assigned = agentProvIds
    .map(pid => providers.find(p => p.id === pid))
    .filter(Boolean);
  
  if (assigned.length === 0) return null;
  
  // Show the one we're currently viewing, or the first one
  const target = provider && assigned.find(a => a.id === provider.id) 
    ? provider 
    : assigned[0];
  
  if (!target) return null;
  
  const modelName = target.models?.find(m => m.id === target.defaultModel)?.displayName 
    || target.defaultModel 
    || 'no model set';
  
  return `${target.name} · ${modelName}`;
}

interface ProviderDrawerProps {
  entityId: string;
  onClose: () => void;
  onPin: () => void;
  isPinned: boolean;
}

const ProviderDrawer: React.FC<ProviderDrawerProps> = ({
  entityId,
  onClose,
  onPin,
  isPinned,
}) => {
  const { providers, agents, refresh } = useData();
  const provider = providers.find((p) => p.id === entityId);
  const [showKey, setShowKey] = useState(false);
  const [keyInput, setKeyInput] = useState('');
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    reachable?: boolean;
    latencyMs?: number;
    errorMessage?: string;
  } | null>(null);
  const [savingToServer, setSavingToServer] = useState(false);
  const [serverKeyStatus, setServerKeyStatus] = useState<{
    hasKey: boolean;
    maskedKey: string | null;
    envVar: string | null;
  } | null>(null);
  const [showAgentModels, setShowAgentModels] = useState<Record<string, boolean>>({});

  // Agent model defaults state
  const [agentDefaults, setAgentDefaults] = useState<Record<string, string[]>>({});
  const [dirtyAgents, setDirtyAgents] = useState<Record<string, boolean>>({});
  const [savingDefaults, setSavingDefaults] = useState(false);

  // Load server-side key status on mount
  useEffect(() => {
    if (provider && provider.authScheme !== 'none') {
      apiFetch(`/api/settings/provider-credentials/${provider.id}`)
        .then(res => res.json())
        .then(data => setServerKeyStatus({ hasKey: data.configured, maskedKey: data.maskedPreview, envVar: null }))
        .catch(() => {});
    }
  }, [provider?.id]);

  useEffect(() => {
    if (provider) {
      const defaults: Record<string, string[]> = {};
      for (const agent of agents) {
        defaults[agent.id] = [...(agent.providerIds || [])];
      }
      setAgentDefaults((prev) => ({ ...prev, ...defaults }));
    }
  }, [provider?.id, agents]);

  if (!provider) return null;

  const hasServerKey = serverKeyStatus?.hasKey;
  const maskedKey = serverKeyStatus?.maskedKey;
  const needsKey = provider.authScheme !== 'none';
  const isLocal = provider.category === 'local';

  const handleSaveKeyToServer = async () => {
    const trimmed = keyInput.trim();
    if (!trimmed) return;
    setSavingToServer(true);
    try {
      const res = await apiFetch(`/api/settings/provider-credentials/${provider.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: trimmed })
      });
      if (!res.ok) throw new Error('Failed to save key');
      const result = await res.json();
      setKeyInput('');
      setSaved(true);
      setServerKeyStatus({ hasKey: true, maskedKey: result.maskedPreview, envVar: null });
      setTimeout(() => setSaved(false), 2000);
      refresh();
    } catch (err) {
      console.error('Failed to save key to server:', err);
    } finally {
      setSavingToServer(false);
    }
  };

  const handleRemoveKey = async () => {
    try {
      await apiFetch(`/api/settings/provider-credentials/${provider.id}`, { method: 'DELETE' });
      setServerKeyStatus(null);
      setTestResult(null);
      refresh();
    } catch (err) {
      console.error('Failed to delete key:', err);
    }
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    const result = await testProviderKey(provider.id);
    setTestResult(result);
    setTesting(false);
  };

  const handleRefresh = async () => {
    try {
      const res = await apiFetch(`/api/providers/${provider.id}/refresh`, {
        method: 'POST',
      });
      if (res.ok) refresh();
    } catch {}
  };

  const handleDefaultModelChange = async (modelId: string) => {
    try {
      await apiClient.updateProvider(provider.id, { defaultModel: modelId });
      refresh();
    } catch (err) {
      console.error('Failed to update default model:', err);
    }
  };

  const toggleAgentDefault = (agent: any) => {
    const current = agentDefaults[agent.id] || [];
    const alreadySet = current.includes(provider.id);
    const updated = alreadySet
      ? current.filter((id: string) => id !== provider.id)
      : [...current, provider.id];
    setAgentDefaults(prev => ({ ...prev, [agent.id]: updated }));
    setDirtyAgents(prev => ({ ...prev, [agent.id]: true }));
  };

  const saveAgentDefaults = async (agentId: string) => {
    setSavingDefaults(true);
    try {
      const ids = agentDefaults[agentId] || [];
      await apiClient.updateAgentProviderDefaults(agentId, ids);
      setDirtyAgents(prev => ({ ...prev, [agentId]: false }));
      refresh();
    } catch (err) {
      console.error('Failed to save agent defaults:', err);
    } finally {
      setSavingDefaults(false);
    }
  };

  const toggleAgentModelDropdown = (agentId: string) => {
    setShowAgentModels(prev => ({ ...prev, [agentId]: !prev[agentId] }));
  };

  const getProviderAccent = () => {
    const colorVar = `--color-prov-${provider.id.replace('prov-', '')}`;
    return `var(${colorVar})`;
  };

  const displayModels = provider.models || [];
  const activeModel = provider.defaultModel;

  // Find agents that could use this provider
  const assignedAgents = agents.filter((a) =>
    (agentDefaults[a.id] || a.providerIds || []).includes(provider.id)
  );
  const unassignedAgents = agents.filter(
    (a) => !(agentDefaults[a.id] || a.providerIds || []).includes(provider.id)
  );

  return (
    <DrawerShell
      title={provider.name}
      subtitle={
        provider.defaultModel
          ? `${provider.adapter} · Default: ${displayModels.find((m) => m.id === provider.defaultModel)?.displayName || provider.defaultModel}`
          : `Adapter: ${provider.adapter}`
      }
      onClose={onClose}
      onPin={onPin}
      isPinned={isPinned}
    >
      {/* STATUS SECTION */}
      <div className="drawer-section">
        <div className="drawer-section__label">Status</div>
        <div className="flex-row gap-2" style={{ alignItems: 'center', marginBottom: 8 }}>
          <StatusBadge status={provider.status} />
          <span className="text-xs text-dim">{provider.lastActivity}</span>
          <div
            style={{
              marginLeft: 'auto',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: '0.7rem',
              color: CATEGORY_COLORS[provider.category] || 'var(--text-tertiary)',
            }}
          >
            {CATEGORY_ICONS[provider.category] || <HardDrive size={14} />}
            {provider.category === 'local' ? 'Local Runtime' : provider.category === 'remote' ? 'Cloud API' : 'Infrastructure'}
          </div>
        </div>
        {provider.errorMessage && (
          <div
            style={{
              marginTop: 8,
              padding: '8px 10px',
              background: 'var(--color-error-bg)',
              color: 'var(--color-error)',
              borderRadius: 'var(--radius-sm)',
              fontSize: '0.75rem',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <AlertTriangle size={13} />
            {provider.errorMessage}
          </div>
        )}
        <div
          style={{
            marginTop: 8,
            display: 'flex',
            gap: 6,
            alignItems: 'center',
          }}
        >
          <button
            onClick={handleRefresh}
            className="btn btn-sm"
            title="Refresh provider status"
          >
            <RefreshCw size={12} /> Refresh
          </button>
          {needsKey && (
            <button
              onClick={handleTestConnection}
              disabled={testing}
              className="btn btn-sm"
              title={hasServerKey ? 'Test API connection' : 'Save a key first'}
              style={{ opacity: !hasServerKey ? 0.5 : 1 }}
            >
              {testing ? (
                <Activity size={12} className="animate-pulse" />
              ) : (
                <Wifi size={12} />
              )}
              {testing ? 'Testing...' : 'Test Connection'}
            </button>
          )}
        </div>
        {testResult && (
          <div
            style={{
              marginTop: 8,
              padding: '8px 10px',
              borderRadius: 'var(--radius-sm)',
              fontSize: '0.75rem',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              background: testResult.reachable
                ? 'var(--color-success-bg)'
                : 'var(--color-warning-bg)',
              color: testResult.reachable
                ? 'var(--color-success)'
                : 'var(--color-warning)',
            }}
          >
            {testResult.reachable ? (
              <>
                <Wifi size={13} />
                Connected — {testResult.latencyMs}ms
              </>
            ) : (
              <>
                <WifiOff size={13} />
                {testResult.errorMessage || 'Unreachable'}
              </>
            )}
          </div>
        )}
      </div>

      {/* API KEY MANAGEMENT */}
      {needsKey && (
        <div className="drawer-section">
          <div className="drawer-section__label">
            <Key size={13} style={{ marginRight: 6 }} />
            API Key
            {serverKeyStatus?.envVar && (
              <span
                className="font-mono text-xs"
                style={{ color: 'var(--text-tertiary)', marginLeft: 8 }}
              >
                → {serverKeyStatus.envVar}
              </span>
            )}
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginBottom: 10,
            }}
          >
            {hasServerKey ? (
              <CheckCircle size={14} color="var(--color-success)" />
            ) : (
              <XCircle size={14} color="var(--color-error)" />
            )}
            <span className="text-sm">
              {hasServerKey
                ? serverKeyStatus?.envVar
                  ? `Key saved to .env (${serverKeyStatus.envVar})`
                  : 'Key is configured'
                : 'No key stored'}
            </span>
            {serverKeyStatus?.maskedKey && (
              <span
                className="font-mono text-xs"
                style={{ color: 'var(--text-tertiary)', marginLeft: 'auto' }}
              >
                {serverKeyStatus.maskedKey}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <div style={{ position: 'relative', flex: 1 }}>
              <input
                type={showKey ? 'text' : 'password'}
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                placeholder={
                  hasServerKey
                    ? 'Replace existing key...'
                    : `Enter ${provider.name} API key...`
                }
                className="form-input"
                style={{
                  width: '100%',
                  height: '32px',
                  fontSize: '12px',
                  padding: '0 30px 0 8px',
                  fontFamily: 'monospace',
                }}
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                style={{
                  position: 'absolute',
                  right: 4,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--text-tertiary)',
                  padding: 4,
                }}
              >
                {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
            <button
              onClick={handleSaveKeyToServer}
              disabled={!keyInput.trim() || savingToServer}
              className="btn btn-primary"
              style={{
                height: '32px',
                padding: '0 12px',
                fontSize: '12px',
                opacity: keyInput.trim() ? 1 : 0.5,
              }}
            >
              {savingToServer ? (
                <RefreshCw size={12} className="animate-pulse" />
              ) : (
                <Save size={12} />
              )}
              Save
            </button>
            {hasServerKey && (
              <button
                onClick={handleRemoveKey}
                style={{
                  height: '32px',
                  padding: '0 12px',
                  fontSize: '12px',
                  background: 'transparent',
                  border: '1px solid var(--color-error)',
                  color: 'var(--color-error)',
                  borderRadius: '6px',
                  cursor: 'pointer',
                }}
              >
                <Trash2 size={12} style={{ marginRight: 4 }} />
                Clear
              </button>
            )}
          </div>
          {saved && (
            <div
              style={{
                marginTop: 6,
                fontSize: '11px',
                color: 'var(--color-success)',
              }}
            >
              Key saved to .env file and activated.
            </div>
          )}
        </div>
      )}

      {/* MODEL SELECTION */}
      {displayModels.length > 0 && (
        <div className="drawer-section">
          <div className="drawer-section__label">
            <Cpu size={13} style={{ marginRight: 6 }} />
            Default Model
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {displayModels.map((model) => (
              <label
                key={model.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '8px 10px',
                  borderRadius: 'var(--radius-sm)',
                  background:
                    activeModel === model.id
                      ? 'rgba(255,255,255,0.06)'
                      : 'transparent',
                  border: `1px solid ${
                    activeModel === model.id
                      ? 'var(--border-medium)'
                      : 'var(--border-subtle)'
                  }`,
                  cursor: 'pointer',
                  transition: 'all var(--transition-fast)',
                }}
              >
                <input
                  type="radio"
                  name={`model-${provider.id}`}
                  checked={activeModel === model.id}
                  onChange={() => handleDefaultModelChange(model.id)}
                  style={{ accentColor: getProviderAccent() }}
                />
                <div style={{ flex: 1 }}>
                  <div
                    style={{
                      fontSize: '0.8rem',
                      fontWeight: activeModel === model.id ? 600 : 400,
                    }}
                  >
                    {model.displayName || model.name}
                  </div>
                  <div
                    style={{
                      fontSize: '0.65rem',
                      color: 'var(--text-tertiary)',
                      display: 'flex',
                      gap: 10,
                      marginTop: 2,
                    }}
                  >
                    <span>{model.id}</span>
                    {model.contextLength && (
                      <span>{(model.contextLength / 1000).toFixed(0)}K ctx</span>
                    )}
                  </div>
                </div>
                {model.inputCost && (
                  <span
                    style={{
                      fontSize: '0.65rem',
                      color: 'var(--text-tertiary)',
                    }}
                  >
                    ${model.inputCost}/1M in
                  </span>
                )}
              </label>
            ))}
          </div>
        </div>
      )}

      {/* SCOPES */}
      {provider.scopes && provider.scopes.length > 0 && (
        <div className="drawer-section">
          <div className="drawer-section__label">Capabilities</div>
          <div className="flex-row flex-wrap gap-2">
            {provider.scopes.map((s) => (
              <ContextChip key={s} label={s} />
            ))}
          </div>
        </div>
      )}

      {/* AGENT ROUTING */}
      <div className="drawer-section">
        <div className="drawer-section__label">
          <Users size={13} style={{ marginRight: 6 }} />
          Agent Routing
        </div>
        <div className="flex-col gap-2">
          <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', marginBottom: 4 }}>
            Toggle which agents use this provider. Click Save to persist changes.
          </div>

          {/* Assigned Agents */}
          {assignedAgents.map((a) => {
            const isDirty = dirtyAgents[a.id];
            const isExpanded = showAgentModels[a.id];
            const activeInfo = getAgentActiveProvider(a, providers, provider);
            return (
              <div key={a.id}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '8px 10px',
                    background: isDirty ? 'rgba(255, 200, 50, 0.08)' : 'var(--color-success-bg)',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: '0.8rem',
                    border: `1px solid ${isDirty ? 'var(--color-warning)' : 'var(--color-success)'}`,
                    cursor: 'pointer',
                    transition: 'all var(--transition-fast)',
                    marginBottom: 4,
                  }}
                  onClick={() => toggleAgentDefault(a)}
                >
                  <div
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: '50%',
                      background: a.color || 'var(--text-tertiary)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: 600,
                      fontSize: '11px',
                      color: '#000',
                      flexShrink: 0,
                    }}
                  >
                    {a.avatar || a.name?.[0] || '?'}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 500 }}>{a.name}</div>
                    <div style={{ fontSize: '0.65rem', color: 'var(--text-tertiary)' }}>
                      Active: {activeInfo || 'No provider configured'}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    {!hasServerKey && needsKey && (
                      <AlertTriangle size={12} color="var(--color-warning)" title="No API key set" />
                    )}
                    {isDirty && (
                      <button
                        onClick={(e) => { e.stopPropagation(); saveAgentDefaults(a.id); }}
                        disabled={savingDefaults}
                        className="btn btn-sm"
                        style={{ padding: '2px 8px', fontSize: '11px' }}
                      >
                        {savingDefaults ? <RefreshCw size={10} className="animate-pulse" /> : <Save size={10} />}
                        Save
                      </button>
                    )}
                    <CheckCircle size={14} color="var(--color-success)" />
                  </div>
                </div>

                {/* Per-agent model selection */}
                {!isDirty && (
                  <button
                    onClick={() => toggleAgentModelDropdown(a.id)}
                    style={{
                      width: '100%',
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--text-tertiary)',
                      fontSize: '0.65rem',
                      padding: '2px 10px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                    }}
                  >
                    {isExpanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                    {isExpanded ? 'Hide provider chain' : `See ${a.name}'s full provider chain`}
                  </button>
                )}

                {isExpanded && !isDirty && (
                  <div style={{ padding: '6px 10px 6px 34px' }}>
                    <div style={{ fontSize: '0.65rem', color: 'var(--text-tertiary)', marginBottom: 4 }}>
                      All providers assigned to {a.name}:
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {(agentDefaults[a.id] || a.providerIds || []).map(pid => {
                        const p = providers.find(pr => pr.id === pid);
                        if (!p) return null;
                        const pActiveModel = p.models?.find(m => m.id === p.defaultModel)?.displayName || p.defaultModel;
                        return (
                          <div
                            key={pid}
                            style={{
                              fontSize: '0.65rem',
                              padding: '2px 6px',
                              borderRadius: '4px',
                              background: pid === provider.id ? 'rgba(255,255,255,0.08)' : 'transparent',
                              border: `1px solid ${pid === provider.id ? 'var(--border-medium)' : 'var(--border-subtle)'}`,
                              color: 'var(--text-secondary)',
                            }}
                          >
                            {p.name}: {pActiveModel || 'default'}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {/* Unassigned Agents */}
          {unassignedAgents.map((a) => (
            <div
              key={a.id}
              onClick={() => toggleAgentDefault(a)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 10px',
                background: 'var(--bg-surface)',
                borderRadius: 'var(--radius-sm)',
                fontSize: '0.8rem',
                border: '1px solid var(--border-subtle)',
                cursor: 'pointer',
                transition: 'all var(--transition-fast)',
                opacity: 0.7,
              }}
            >
              <div
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: '50%',
                  background: a.color || 'var(--text-tertiary)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 600,
                  fontSize: '11px',
                  color: '#000',
                  flexShrink: 0,
                }}
              >
                {a.avatar || a.name?.[0] || '?'}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 500 }}>{a.name}</div>
                <div style={{ fontSize: '0.65rem', color: 'var(--text-tertiary)' }}>
                  {a.capabilities?.slice(0, 2).join(', ') || 'General'}
                </div>
              </div>
              <span style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>
                + Assign
              </span>
            </div>
          ))}

          {agents.length === 0 && (
            <div
              style={{
                padding: 16,
                textAlign: 'center',
                color: 'var(--text-tertiary)',
                fontSize: '0.75rem',
                fontStyle: 'italic',
              }}
            >
              No agents registered yet.
            </div>
          )}
        </div>
      </div>

      {/* DESCRIPTION */}
      <div className="drawer-section">
        <div className="drawer-section__label">Description</div>
        <p className="text-sm text-secondary">{provider.description}</p>
      </div>
    </DrawerShell>
  );
};

export default ProviderDrawer;

