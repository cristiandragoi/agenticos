import React, { useState } from 'react';
import { useData } from '../store/dataStore';
import KanbanContainer from '../components/kanban/KanbanContainer';
import { Terminal, Settings, List, CheckCircle2, AlertCircle, Loader2, Clock, Zap, ChevronDown, Mic, MicOff } from 'lucide-react';

const PROVIDERS = [
  { id: 'agent-hermes',   label: 'Hermes (auto)',   color: '#d4a373' },
  { id: 'prov-anthropic', label: 'Anthropic Claude', color: '#c084fc' },
  { id: 'prov-deepseek',  label: 'DeepSeek',         color: '#60a5fa' },
  { id: 'prov-qwen',      label: 'Qwen',             color: '#34d399' },
  { id: 'prov-xai',       label: 'xAI Grok',         color: '#f97316' },
];

export default function HermesWorkspacePanel() {
  const { runs, agents } = useData();
  const [selectedProvider, setSelectedProvider] = useState(PROVIDERS[0]);
  const [showProviderMenu, setShowProviderMenu] = useState(false);
  const [voiceMode, setVoiceMode] = useState(true);

  // Derive "recent activity" specifically for Hermes
  const hermesRuns = runs.filter(r => r.agentId === 'agent-hermes').slice(0, 10);
  const hermesAgent = agents.find(a => a.id === 'agent-hermes');

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden', backgroundColor: 'var(--bg-default)' }}>
      {/* Main Content Area (Kanban) */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        
        {/* Header */}
        <div style={{ 
          padding: '24px 32px', 
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
              <Terminal size={28} color="var(--color-hermes, #d4a373)" />
              <h1 style={{ fontSize: '2rem', fontWeight: 700, letterSpacing: '-0.03em', color: 'var(--text-primary)', margin: 0 }}>
                Hermes Workspace
              </h1>
            </div>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', margin: 0 }}>
              Primary Orchestrator & Task Execution Agent.
            </p>
          </div>

          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            {/* Voice Toggle */}
            <button 
              onClick={() => setVoiceMode(!voiceMode)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '8px 16px', borderRadius: 8, fontSize: '0.8rem',
                background: voiceMode ? 'rgba(212, 163, 115, 0.15)' : 'var(--bg-elevated)', 
                border: `1px solid ${voiceMode ? 'var(--color-hermes)' : 'var(--border-subtle)'}`,
                color: voiceMode ? 'var(--color-hermes)' : 'var(--text-secondary)',
                cursor: 'pointer', fontWeight: 600,
                transition: 'all 0.2s'
              }}
            >
              {voiceMode ? <Mic size={14} /> : <MicOff size={14} />}
              Voice {voiceMode ? 'On' : 'Off'}
            </button>

            {/* Provider Selector */}
            <div style={{ position: 'relative' }}>
              <button
                onClick={() => setShowProviderMenu(v => !v)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '8px 16px', borderRadius: 8, fontSize: '0.8rem',
                  background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
                  color: selectedProvider.color, cursor: 'pointer', fontWeight: 600,
                }}
              >
                <Zap size={14} />
                {selectedProvider.label}
                <ChevronDown size={14} />
              </button>
              
              {showProviderMenu && (
                <div style={{
                  position: 'absolute', right: 0, top: '110%', zIndex: 9999,
                  background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
                  borderRadius: 8, overflow: 'hidden', minWidth: 200,
                  boxShadow: 'var(--shadow-xl)',
                }}>
                  {PROVIDERS.map(p => (
                    <button
                      key={p.id}
                      onClick={() => { setSelectedProvider(p); setShowProviderMenu(false); }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        width: '100%', padding: '10px 16px', background: 'none',
                        border: 'none', cursor: 'pointer', fontSize: '0.8rem',
                        color: p.id === selectedProvider.id ? p.color : 'var(--text-secondary)',
                        fontWeight: p.id === selectedProvider.id ? 700 : 400,
                      }}
                    >
                      <div style={{ width: 8, height: 8, borderRadius: '50%', background: p.color, flexShrink: 0 }} />
                      {p.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Kanban Board Area */}
        <div style={{ flex: 1, padding: '0 32px', overflowY: 'auto' }}>
          <KanbanContainer />
        </div>
      </div>

      {/* Side Context Panel */}
      <div style={{ 
        width: '380px', 
        borderLeft: '1px solid var(--border-subtle)', 
        background: 'var(--bg-surface)',
        display: 'flex', 
        flexDirection: 'column'
      }}>
        <div style={{ padding: '20px', borderBottom: '1px solid var(--border-subtle)' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, margin: '0 0 16px 0', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Settings size={16} color="var(--color-hermes)" />
            Orchestration Context
          </h3>
          
          {/* System Prompt snippet */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: 8 }}>
              Active System Prompt
            </div>
            <div style={{ 
              fontSize: '0.8rem', 
              color: 'var(--text-secondary)', 
              background: 'var(--bg-elevated)', 
              padding: '12px', 
              borderRadius: '8px',
              border: '1px solid var(--border-subtle)',
              maxHeight: '120px',
              overflowY: 'auto',
              lineHeight: 1.5
            }}>
              "You are Hermes, an AI agent in Agentic OS. You have access to tools that let you: Execute shell commands, Read/Write files, Search files, Search the web. You are helpful, knowledgeable, and direct. You execute tasks step by step..."
            </div>
          </div>

          {/* Capabilities & Tools */}
          <div>
            <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: 8 }}>
              Loaded Tools
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {hermesAgent?.toolIds?.map((t: string) => (
                <span key={t} style={{ 
                  fontSize: '0.7rem', padding: '4px 8px', borderRadius: '4px',
                  background: 'rgba(212, 163, 115, 0.1)', color: 'var(--color-hermes)',
                  border: '1px solid rgba(212, 163, 115, 0.2)'
                }}>
                  {t.replace('tool-', '')}
                </span>
              ))}
            </div>
          </div>
        </div>

        <div style={{ flex: 1, padding: '20px', overflowY: 'auto' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, margin: '0 0 16px 0', display: 'flex', alignItems: 'center', gap: 8 }}>
            <List size={16} color="var(--color-hermes)" />
            Recent Executions
          </h3>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {hermesRuns.length === 0 ? (
              <div style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)' }}>No recent runs for Hermes.</div>
            ) : (
              hermesRuns.map((run: any) => (
                <div key={run.id} style={{ 
                  background: 'var(--bg-elevated)', 
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '8px', 
                  padding: '12px' 
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                    <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                      {run.input ? `"${run.input}"` : 'Autonomous Task'}
                    </div>
                    {run.status === 'completed' && <CheckCircle2 size={14} color="#22c55e" />}
                    {run.status === 'failed' && <AlertCircle size={14} color="#ef4444" />}
                    {run.status === 'running' && <Loader2 size={14} className="spin" color="var(--color-hermes)" />}
                    {run.status === 'queued' && <Clock size={14} color="var(--text-tertiary)" />}
                  </div>
                  
                  {run.output && (
                    <div style={{ 
                      fontSize: '0.75rem', 
                      color: 'var(--text-secondary)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis'
                    }}>
                      {run.output}
                    </div>
                  )}

                  {run.errorMessage && (
                    <div style={{ 
                      marginTop: 6,
                      fontSize: '0.75rem', 
                      color: '#ef4444',
                      background: 'rgba(239, 68, 68, 0.1)',
                      padding: '4px 8px',
                      borderRadius: '4px'
                    }}>
                      Error: {run.errorMessage}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
