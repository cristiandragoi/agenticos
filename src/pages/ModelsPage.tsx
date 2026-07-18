// @ts-nocheck
import { useData } from '../store/dataStore';
import React, { useMemo, useState } from 'react';
import EntityCard from '../components/ui/EntityCard';
import StatusBadge from '../components/ui/StatusBadge';
import ContextChip from '../components/ui/ContextChip';
import { useDrawer } from '../store/appStore';
import { providerKeyIsSet } from '../store/providerKeys';
import { apiClient } from '../api/client';
import {
  Bot, Key, Shield, Activity, Cpu, Database,
  CheckCircle, XCircle, AlertTriangle, ArrowRight,
  RefreshCw, Globe, Monitor, Server, Save,
  ChevronDown, Wifi, WifiOff,
} from 'lucide-react';

const CATEGORY_LABELS = {
  local: { label: 'Local', icon: <Monitor size={12} />, color: 'var(--color-provider-local)' },
  remote: { label: 'Cloud', icon: <Globe size={12} />, color: 'var(--color-provider-remote)' },
  infra: { label: 'Infra', icon: <Server size={12} />, color: 'var(--color-provider-infra)' },
};

/** Compute what provider+model an agent will actively use */
function computeAgentActiveModel(agent, providers) {
  const agentProvIds = agent.providerIds || [];
  const assigned = agentProvIds
    .map(pid => providers.find(p => p.id === pid))
    .filter(Boolean);
  if (assigned.length === 0) return { label: 'No provider', color: 'var(--color-error)', warning: true };
  
  // Prefer local (Ollama is "heartbeat")
  const local = assigned.find(p => p.category === 'local');
  if (local) {
    const model = local.models?.find(m => m.id === local.defaultModel)?.displayName || local.defaultModel || 'default';
    return { label: `${local.name}: ${model}`, color: 'var(--color-provider-local)', warning: false, local: true };
  }
  // First connected remote
  const connected = assigned.find(p => p.authScheme === 'none' || providerKeyIsSet(p.id));
  if (connected) {
    const model = connected.models?.find(m => m.id === connected.defaultModel)?.displayName || connected.defaultModel || 'default';
    return { label: `${connected.name}: ${model}`, color: 'var(--color-provider-remote)', warning: false };
  }
  const missingKey = assigned.find(p => p.authScheme !== 'none' && !providerKeyIsSet(p.id));
  if (missingKey) {
    return { label: `${missingKey.name} (no key)`, color: 'var(--color-warning)', warning: true };
  }
  return { label: 'No active provider', color: 'var(--text-tertiary)', warning: true };
}

const ModelsPage: React.FC = () => {
  const { agents, providers, isLoading, refresh } = useData();
  const drawer = useDrawer();
  const [savingAgent, setSavingAgent] = useState<string | null>(null);
  const [localEdits, setLocalEdits] = useState<Record<string, string[]>>({});

  if (isLoading) return null;

  const llmProviders = providers.filter((p) => p.kind === 'llm');
  const localProviders = llmProviders.filter((p) => p.category === 'local');
  const remoteProviders = llmProviders.filter((p) => p.category === 'remote');

  // Build agent→provider mapping with warnings
  const agentProviderMap = useMemo(() => {
    const map: Record< string, { agent: (typeof agents)[0]; providers: (typeof providers)[0][]; missingKeys: (typeof providers)[0][]; hasLocalBase: boolean; activeModel: ReturnType<typeof computeAgentActiveModel> } > = {};
    for (const agent of agents) {
      const agentProvs = (agent.providerIds || [])
        .map((pid: string) => providers.find((p) => p.id === pid))
        .filter(Boolean);
      const missingKeys = agentProvs.filter(
        (p: any) => p.authScheme !== 'none' && !providerKeyIsSet(p.id) && p.category === 'remote'
      );
      const hasLocalBase = agentProvs.some((p: any) => p.category === 'local');
      const activeModel = computeAgentActiveModel(agent, providers);
      map[agent.id] = { agent, providers: agentProvs, missingKeys, hasLocalBase, activeModel };
    }
    return map;
  }, [agents, providers]);

  const handleSaveAgentProviders = async (agentId: string, providerIds: string[]) => {
    setSavingAgent(agentId);
    try {
      await apiClient.updateAgentProviderDefaults(agentId, providerIds);
      refresh();
    } catch (err) {
      console.error('Failed to save agent routing:', err);
    } finally {
      setSavingAgent(null);
    }
  };

  const toggleProviderForAgent = (agentId: string, providerId: string) => {
    const current = localEdits[agentId] !== undefined
      ? localEdits[agentId]
      : (agents.find((a) => a.id === agentId)?.providerIds || []);
    const updated = current.includes(providerId)
      ? current.filter((id) => id !== providerId)
      : [...current, providerId];
    setLocalEdits({ ...localEdits, [agentId]: updated });
  };

  const hasUnsavedEdit = (agentId: string): boolean => {
    const original = agents.find((a) => a.id === agentId)?.providerIds || [];
    const edited = localEdits[agentId];
    if (!edited) return false;
    return JSON.stringify([...original].sort()) !== JSON.stringify([...edited].sort());
  };

  return (
    <div
      className="flex-col h-full"
      style={{
        backgroundImage:
          "linear-gradient(to bottom, rgba(10, 10, 12, 0.8), rgba(10, 10, 12, 0.95)), url('/bg/bg_models.png')",
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundAttachment: 'fixed',
      }}
    >
      <div className="page-header">
        <div className="page-header__title">
          <h1>Provider & Model Routing</h1>
          <p>
            Configure which LLM providers each agent uses, set default models,
            and see at a glance what model each agent will actually reply with.
          </p>
        </div>
      </div>

      {/* ─── AGENT → PROVIDER ROUTING TABLE ─── */}
      <div style={{ marginBottom: 28 }}>
        <h3
          style={{
            fontSize: '0.75rem',
            fontWeight: 600,
            color: 'var(--text-tertiary)',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            marginBottom: 12,
          }}
        >
          Agent → Provider Routing
        </h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {Object.values(agentProviderMap).map(({ agent, providers: agentProviders, missingKeys, hasLocalBase, activeModel }) => {
            const edit = localEdits[agent.id] !== undefined ? localEdits[agent.id] : (agent.providerIds || []);
            const isDirty = hasUnsavedEdit(agent.id);

            return (
              <div
                key={agent.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '12px 16px',
                  background: 'var(--bg-elevated)',
                  borderRadius: 'var(--radius-md)',
                  border: `1px solid ${
                    missingKeys.length > 0
                      ? 'var(--color-warning)'
                      : hasLocalBase
                      ? 'rgba(52, 211, 153, 0.3)'
                      : 'var(--border-subtle)'
                  }`,
                }}
              >
                {/* Agent Avatar */}
                <div
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: '50%',
                    background: agent.color || 'var(--text-tertiary)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 700,
                    fontSize: '13px',
                    color: '#000',
                    flexShrink: 0,
                  }}
                >
                  {agent.avatar || agent.name?.[0] || '?'}
                </div>

                {/* Agent Info */}
                <div style={{ minWidth: 110 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>
                    {agent.name}
                    {agent.id === 'agent-jarvis' && (
                      <span
                        style={{
                          marginLeft: 6,
                          fontSize: '0.6rem',
                          padding: '1px 5px',
                          borderRadius: '4px',
                          background: 'var(--color-jarvis)',
                          color: '#000',
                          fontWeight: 700,
                        }}
                      >
                        VOICE
                      </span>
                    )}
                  </div>
                  <StatusBadge status={agent.status} />
                </div>

                {/* Provider Pills */}
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                    {llmProviders.map((llm) => {
                      const isSelected = edit.includes(llm.id);
                      const hasKey = llm.authScheme === 'none' || providerKeyIsSet(llm.id);
                      const accentVar = `var(--color-prov-${llm.id.replace('prov-', '')})`;

                      return (
                        <div
                          key={llm.id}
                          onClick={() => toggleProviderForAgent(agent.id, llm.id)}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 4,
                            padding: '3px 8px',
                            borderRadius: '999px',
                            fontSize: '0.7rem',
                            cursor: 'pointer',
                            border: `1px solid ${
                              isSelected ? accentVar : 'var(--border-subtle)'
                            }`,
                            background: isSelected
                              ? `${accentVar}22`
                              : 'transparent',
                            opacity: isSelected || !isSelected ? 1 : 0.5,
                            transition: 'all var(--transition-fast)',
                          }}
                          title={`${isSelected ? 'Click to remove' : 'Click to assign'} ${llm.name}`}
                        >
                          {CATEGORY_LABELS[llm.category]?.icon}
                          <span>{llm.name}</span>
                          {isSelected && (
                            hasKey ? (
                              llm.category === 'local' ? (
                                <Monitor size={10} style={{ color: 'var(--color-provider-local)' }} />
                              ) : (
                                <CheckCircle size={10} color="var(--color-success)" />
                              )
                            ) : (
                              <AlertTriangle size={10} color="var(--color-warning)" />
                            )
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Active model indicator */}
                  <div
                    style={{
                      marginTop: 6,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      fontSize: '0.7rem',
                    }}
                  >
                    {activeModel.warning ? (
                      <WifiOff size={11} color="var(--color-warning)" />
                    ) : (
                      <Wifi size={11} color={activeModel.color} />
                    )}
                    <span style={{ color: activeModel.color }}>
                      <strong>Will reply with:</strong> {activeModel.label}
                    </span>
                    {missingKeys.length > 0 && (
                      <span style={{ color: 'var(--color-warning)', marginLeft: 8 }}>
                        <AlertTriangle size={10} style={{ marginRight: 2, verticalAlign: 'middle' }} />
                        Missing keys: {missingKeys.map((p: any) => p.name).join(', ')}
                      </span>
                    )}
                  </div>
                </div>

                {/* Save button */}
                {isDirty && (
                  <button
                    onClick={() => handleSaveAgentProviders(agent.id, edit)}
                    disabled={savingAgent === agent.id}
                    className="btn btn-primary btn-sm"
                    style={{ whiteSpace: 'nowrap' }}
                  >
                    {savingAgent === agent.id ? (
                      <RefreshCw size={12} className="animate-pulse" />
                    ) : (
                      <Save size={12} />
                    )}
                    Save
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ─── AVAILABLE LLMs ─── */}
      <div style={{ marginBottom: 24 }}>
        <h3
          style={{
            fontSize: '0.75rem',
            fontWeight: 600,
            color: 'var(--text-tertiary)',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            marginBottom: 12,
          }}
        >
          Available LLM Providers ({llmProviders.length})
        </h3>

        {/* Local section */}
        {localProviders.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                marginBottom: 10,
                fontSize: '0.8rem',
                fontWeight: 600,
                color: 'var(--color-provider-local)',
              }}
            >
              <Monitor size={14} />
              Local
              <span
                style={{
                  fontSize: '0.6rem',
                  color: 'var(--text-tertiary)',
                  fontWeight: 400,
                }}
              >
                No API keys required
              </span>
            </div>
            <div className="gallery-grid">
              {localProviders.map((llm) => (
                <ProviderMiniCard
                  key={llm.id}
                  provider={llm}
                  onClick={() => drawer.open('provider', llm.id)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Remote section */}
        <div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginBottom: 10,
              fontSize: '0.8rem',
              fontWeight: 600,
              color: 'var(--color-provider-remote)',
            }}
          >
            <Globe size={14} />
            Cloud / Remote
          </div>
          <div className="gallery-grid">
            {remoteProviders.map((llm) => (
              <ProviderMiniCard
                key={llm.id}
                provider={llm}
                onClick={() => drawer.open('provider', llm.id)}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

/* ─── Sub-component: Provider Mini Card ─── */
const ProviderMiniCard: React.FC<{ provider: any; onClick: () => void }> = ({
  provider,
  onClick,
}) => {
  const hasKey = providerKeyIsSet(provider.id);
  const needsKey = provider.authScheme !== 'none';
  const accentVar = `var(--color-prov-${provider.id.replace('prov-', '')})`;
  const catColor = provider.category === 'local'
    ? 'var(--color-provider-local)'
    : provider.category === 'remote'
    ? 'var(--color-provider-remote)'
    : 'var(--color-provider-infra)';

  return (
    <EntityCard
      title={provider.name}
      subtitle={`Default: ${provider.defaultModel || provider.adapter}`}
      preview={
        hasKey
          ? `API key configured · ${provider.models?.length || 0} models`
          : needsKey
          ? 'No API key — click to configure'
          : `${provider.models?.length || 0} models · No auth needed`
      }
      status={provider.status}
      accent={accentVar}
      tags={[
        provider.category,
        ...(provider.scopes || []).slice(0, 2),
        hasKey ? 'Key set' : needsKey ? 'No key' : 'No auth',
      ]}
      meta={[
        {
          icon: <Bot size={14} />,
          label: `${provider.models?.length || 0} models`,
        },
        {
          icon: hasKey ? (
            <CheckCircle size={14} color="var(--color-success)" />
          ) : needsKey ? (
            <XCircle size={14} color="var(--color-warning)" />
          ) : (
            <Key size={14} />
          ),
          label: hasKey
            ? 'Key active'
            : needsKey
            ? 'Key missing'
            : provider.authScheme,
        },
      ]}
      onClick={onClick}
    />
  );
};

export default ModelsPage;
