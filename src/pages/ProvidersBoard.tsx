// @ts-nocheck
import { useData } from '../store/dataStore';
import React, { useMemo } from 'react';
import { useDrawer } from '../store/appStore';
import EntityCard from '../components/ui/EntityCard';
import StatusBadge from '../components/ui/StatusBadge';
import ContextChip from '../components/ui/ContextChip';
import { loadProviderKeys, removeProviderKey } from '../store/providerKeys';
import { apiFetch, apiUrl } from '../api/client';
import {
  HardDrive, Cloud, Server, Key, CheckCircle, XCircle,
  AlertTriangle, Cpu, Globe, Shield, Activity, Wifi,
  WifiOff, RefreshCw, Zap, Monitor, Users, Bot,
} from 'lucide-react';

const PROVIDER_ICONS: Record<string, React.ReactNode> = {
  'prov-ollama': <Monitor size={16} />,
  'prov-openai': <Zap size={16} />,
  'prov-openrouter': <Globe size={16} />,
  'prov-anthropic': <Shield size={16} />,
  'prov-deepseek': <Cpu size={16} />,
  'prov-minimax': <Activity size={16} />,
  'prov-kimi': <Cpu size={16} />,
  'prov-qwen': <Cpu size={16} />,
  'prov-xai': <Zap size={16} />,
  'prov-mistral': <Cpu size={16} />,
  'prov-gemini': <Globe size={16} />,
  'prov-perplexity': <Activity size={16} />,
  'prov-fugu': <Globe size={16} />,
};

const CATEGORY_CONFIG = {
  local: {
    label: 'Local Runtimes',
    icon: <HardDrive size={14} color="var(--color-provider-local)" />,
    accent: 'var(--color-provider-local)',
    desc: 'Models running on your machine. No API keys required.',
  },
  remote: {
    label: 'Cloud / External Providers',
    icon: <Cloud size={14} color="var(--color-provider-remote)" />,
    accent: 'var(--color-provider-remote)',
    desc: 'External API services. Configure API keys for each provider.',
  },
  infra: {
    label: 'Infrastructure & Tools',
    icon: <Server size={14} color="var(--color-provider-infra)" />,
    accent: 'var(--color-provider-infra)',
    desc: 'Tools, storage, and system integrations.',
  },
};

/** Compute the effective provider+model for a given agent */
function computeAgentActiveModel(agent, providers) {
  const agentProvIds = agent.providerIds || [];
  const assigned = agentProvIds
    .map(pid => providers.find(p => p.id === pid))
    .filter(Boolean);
  if (assigned.length === 0) return { label: 'No provider', color: 'var(--color-error)', warning: true };
  
  // First local provider is "base"
  const local = assigned.find(p => p.category === 'local');
  if (local) {
    const model = local.models?.find(m => m.id === local.defaultModel)?.displayName || local.defaultModel || 'default';
    return { label: `${local.name}: ${model}`, color: 'var(--color-provider-local)', warning: false };
  }
  // First connected remote
  const connected = assigned.find(p => p.authScheme === 'none' || p.isConfigured);
  if (connected) {
    const model = connected.models?.find(m => m.id === connected.defaultModel)?.displayName || connected.defaultModel || 'default';
    return { label: `${connected.name}: ${model}`, color: 'var(--color-provider-remote)', warning: false };
  }
  // Assigned but no key
  const missingKey = assigned.find(p => p.authScheme !== 'none' && !p.isConfigured);
  if (missingKey) {
    return { label: `${missingKey.name} (no key)`, color: 'var(--color-warning)', warning: true };
  }
  return { label: 'No active provider', color: 'var(--text-tertiary)', warning: true };
}

const ProvidersBoard: React.FC = () => {
  const { providers, agents, providerCredentials, isLoading, refresh } = useData();
  const drawer = useDrawer();
  const [migrationError, setMigrationError] = React.useState<string | null>(null);

  
  const [legacyKeys, setLegacyKeys] = React.useState<Record<string, any>>({});
  
  React.useEffect(() => {
    setLegacyKeys(loadProviderKeys());
  }, []);

  const handleRetryMigration = async () => {
    setMigrationError(null);
    let hasFailure = false;
    let needsRefresh = false;
    const mapLegacyIdToCanonical = (id: string) => {
      if (id === 'prov-openrouter') return 'omniroot';
      if (id === 'prov-anthropic') return 'ninerouter';
      if (id === 'prov-ollama') return 'ollama';
      if (id === 'prov-openai') return 'openai';
      return id.replace('prov-', '');
    };

    const promises = Object.entries(legacyKeys).map(async ([id, entry]) => {
      if (entry.keyValue) {
        const canonicalId = mapLegacyIdToCanonical(id);
        try {
          const res = await apiFetch(`/api/settings/provider-credentials/${canonicalId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ apiKey: entry.keyValue })
          });
          if (!res.ok) throw new Error('Backend refused migration');
          removeProviderKey(id);
          needsRefresh = true;
        } catch (err) {
          hasFailure = true;
        }
      }
    });

    await Promise.all(promises);
    setLegacyKeys(loadProviderKeys());
    if (hasFailure) {
      setMigrationError('Secure backend migration failed. Some keys remain unencrypted in your browser storage. Please try again or check backend logs.');
    } else {
      setMigrationError(null);
    }
    if (needsRefresh) refresh();
  };

  const handleClearLegacy = () => {
    for (const id of Object.keys(legacyKeys)) {
      removeProviderKey(id);
    }
    setLegacyKeys({});
    setMigrationError(null);
  };


  if (isLoading) return null;

  const providersWithStatus = useMemo(() => {
    return providers.map(p => {
      const canonicalId = p.id === 'prov-openrouter' ? 'omniroot' : 
                         p.id === 'prov-anthropic' ? 'ninerouter' : 
                         p.id.replace('prov-', '');
      const cred = providerCredentials?.[canonicalId];
      return {
        ...p,
        isConfigured: cred?.configured || false,
        maskedKeyPreview: cred?.maskedPreview || null
      };
    });
  }, [providers, providerCredentials]);

  const grouped = useMemo(() => {
    const groups: Record<string, typeof providersWithStatus> = { local: [], remote: [], infra: [] };
    for (const p of providersWithStatus) {
      const cat = p.category || 'remote';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(p);
    }
    const statusOrder = { connected: 0, 'needs-auth': 1, disconnected: 2, error: 3, experimental: 4, disabled: 5 };
    for (const key of Object.keys(groups)) {
      groups[key].sort((a, b) => (statusOrder[a.status] ?? 99) - (statusOrder[b.status] ?? 99));
    }
    return groups;
  }, [providersWithStatus]);

  const renderProviderCard = (p: any) => {
    const hasKey = p.isConfigured;
    const needsKey = p.authScheme !== 'none';
    const maskedKey = hasKey ? p.maskedKeyPreview : null;
    const usedBy = (p.usedByAgentDefaults || []).map((aid: string) => agents.find((a: any) => a.id === aid)).filter(Boolean);
    const accentVar = `var(--color-prov-${p.id.replace('prov-', '')})`;
    
    // Find agents that actually have this provider assigned
    const assignedAgents = agents.filter(a => (a.providerIds || []).includes(p.id));

    return (
      <EntityCard
        key={p.id}
        title={p.name}
        subtitle={
          p.defaultModel
            ? `Default: ${p.models?.find((m: any) => m.id === p.defaultModel)?.displayName || p.defaultModel}`
            : p.adapter
        }
        preview={
          p.status === 'error' && p.errorMessage
            ? p.errorMessage
            : p.models
              ? `${p.models.length} model${p.models.length !== 1 ? 's' : ''} · ${p.kind.toUpperCase()}`
              : p.description
        }
        status={p.status}
        accent={accentVar}
        tags={[
          ...(p.scopes || []).slice(0, 3),
          needsKey ? (hasKey ? '✓ Key configured' : '⚠ No key') : 'No auth needed',
        ]}
        meta={[
          {
            icon: p.category === 'local' ? <Monitor size={14} /> : p.category === 'remote' ? <Globe size={14} /> : <Server size={14} />,
            label: p.category,
          },
          {
            icon: needsKey ? (
              hasKey ? (
                <CheckCircle size={14} color="var(--color-success)" />
              ) : (
                <XCircle size={14} color="var(--color-warning)" />
              )
            ) : (
              <Key size={14} />
            ),
            label: maskedKey || (needsKey ? 'Key missing' : p.authScheme),
          },
          {
            icon: <Users size={14} />,
            label: assignedAgents.length > 0
              ? `${assignedAgents.length} agent${assignedAgents.length !== 1 ? 's' : ''}: ${assignedAgents.map(a => a.avatar || a.name[0]).join('')}`
              : 'Unassigned',
          },
        ].filter(Boolean)}
        onClick={() => drawer.open('provider', p.id)}
      />
    );
  };

  return (
    <div
      className="flex-col h-full"
      style={{
        backgroundImage:
          "linear-gradient(to bottom, rgba(10, 10, 12, 0.8), rgba(10, 10, 12, 0.95)), url('/bg/bg_providers.png')",
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundAttachment: 'fixed',
      }}
    >
        <div className="page-header">
        <div className="page-header__title">
          <h1>Providers & API Keys</h1>
          <p>
            All LLM providers, API keys, and model routing in one place.
            Click any provider to configure keys and model preferences.
          </p>
        </div>
        <div className="page-header__actions">
          <div className="status-pill">
            <Activity size={12} />
            {providers.filter((p) => p.status === 'connected').length}/{providers.length} connected
          </div>
        </div>
      </div>

      
      {Object.keys(legacyKeys).length > 0 && (
        <div style={{ padding: 16, background: 'rgba(255, 60, 60, 0.1)', border: '1px solid var(--color-error)', borderRadius: 8, marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--color-error)', fontWeight: 'bold', marginBottom: 8 }}>
            <AlertTriangle size={16} /> Legacy insecure keys detected
          </div>
          <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
            Some provider keys are still stored in plain-text local storage. They must be migrated to the backend OS vault for security.
          </p>
          {migrationError && <p style={{ color: 'var(--color-error)', fontSize: '0.8rem', marginTop: 4 }}>{migrationError}</p>}
          <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
            <button className="btn btn-primary" onClick={handleRetryMigration}>Retry secure migration</button>
            <button className="btn btn-danger" onClick={handleClearLegacy}>Remove insecure local keys</button>
          </div>
        </div>
      )}

      {/* ─── AGENT STATUS BAR ─── */}
      <div
        style={{
          marginBottom: 20,
          display: 'flex',
          gap: 8,
          flexWrap: 'wrap',
        }}
      >
        {agents.filter(a => a.status === 'active').map(agent => {
          const modelInfo = computeAgentActiveModel(agent, providersWithStatus);
          return (
            <div
              key={agent.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 12px',
                borderRadius: '8px',
                background: 'var(--bg-elevated)',
                border: `1px solid ${modelInfo.warning ? 'var(--color-warning)' : 'var(--border-subtle)'}`,
                fontSize: '0.75rem',
              }}
            >
              <div
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: '50%',
                  background: agent.color,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 700,
                  fontSize: '10px',
                  color: '#000',
                  flexShrink: 0,
                }}
              >
                {agent.avatar || agent.name[0]}
              </div>
              <div>
                <div style={{ fontWeight: 600, fontSize: '0.7rem' }}>{agent.name}</div>
                <div style={{ fontSize: '0.6rem', color: modelInfo.color, marginTop: 1 }}>
                  <Wifi size={9} style={{ marginRight: 3, verticalAlign: 'middle' }} />
                  {modelInfo.label}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {Object.entries(CATEGORY_CONFIG).map(([catKey, config]) => {
        const items = grouped[catKey];
        if (!items || items.length === 0) return null;
        return (
          <div key={catKey} style={{ marginBottom: 28 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                marginBottom: 14,
                padding: '0 4px',
              }}
            >
              {config.icon}
              <h3
                style={{
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  color: config.accent,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  margin: 0,
                }}
              >
                {config.label}
              </h3>
              <span
                style={{
                  fontSize: '0.65rem',
                  padding: '1px 7px',
                  borderRadius: '999px',
                  background: 'rgba(255,255,255,0.05)',
                  color: 'var(--text-tertiary)',
                }}
              >
                {items.length}
              </span>
              <span style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)', marginLeft: 4 }}>
                {config.desc}
              </span>
            </div>
            <div className="gallery-grid">{items.map(renderProviderCard)}</div>
          </div>
        );
      })}
    </div>
  );
};

export default ProvidersBoard;
