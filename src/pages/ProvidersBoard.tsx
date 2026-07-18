// @ts-nocheck
import { useData } from '../store/dataStore';
import React, { useMemo } from 'react';
import { useDrawer } from '../store/appStore';
import EntityCard from '../components/ui/EntityCard';
import StatusBadge from '../components/ui/StatusBadge';
import ContextChip from '../components/ui/ContextChip';
import { providerKeyIsSet, getMaskedKey } from '../store/providerKeys';
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
  const connected = assigned.find(p => p.authScheme === 'none' || providerKeyIsSet(p.id));
  if (connected) {
    const model = connected.models?.find(m => m.id === connected.defaultModel)?.displayName || connected.defaultModel || 'default';
    return { label: `${connected.name}: ${model}`, color: 'var(--color-provider-remote)', warning: false };
  }
  // Assigned but no key
  const missingKey = assigned.find(p => p.authScheme !== 'none' && !providerKeyIsSet(p.id));
  if (missingKey) {
    return { label: `${missingKey.name} (no key)`, color: 'var(--color-warning)', warning: true };
  }
  return { label: 'No active provider', color: 'var(--text-tertiary)', warning: true };
}

const ProvidersBoard: React.FC = () => {
  const { providers, agents, isLoading } = useData();
  const drawer = useDrawer();

  if (isLoading) return null;

  const grouped = useMemo(() => {
    const groups: Record<string, typeof providers> = { local: [], remote: [], infra: [] };
    for (const p of providers) {
      const cat = p.category || 'remote';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(p);
    }
    const statusOrder = { connected: 0, 'needs-auth': 1, disconnected: 2, error: 3, experimental: 4, disabled: 5 };
    for (const key of Object.keys(groups)) {
      groups[key].sort((a, b) => (statusOrder[a.status] ?? 99) - (statusOrder[b.status] ?? 99));
    }
    return groups;
  }, [providers]);

  const renderProviderCard = (p: any) => {
    const hasKey = providerKeyIsSet(p.id);
    const needsKey = p.authScheme !== 'none';
    const maskedKey = hasKey ? getMaskedKey(p.id) : null;
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
          const modelInfo = computeAgentActiveModel(agent, providers);
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
