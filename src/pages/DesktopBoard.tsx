import React, { useEffect, useState } from 'react';
import AgentTile from '../components/ui/AgentTile';
import { Cpu, Database, Webhook, Bot, Shield, Globe, HardDrive, X, Terminal } from 'lucide-react';
import { useChat } from '../store/appStore';
import { obsidianAdapter } from '../api/obsidianAdapter';
import KanbanContainer from '../components/kanban/KanbanContainer';
import QwythosDashboard from './QwythosDashboard';

const DesktopBoard: React.FC = () => {
  const chat = useChat();
  const [obsidianPending, setObsidianPending] = useState(obsidianAdapter.getPendingCount());
  const [obsidianFailed, setObsidianFailed] = useState(obsidianAdapter.getFailedCount());
  const [showApify, setShowApify] = useState(false);
  const [showQwythos, setShowQwythos] = useState(false);

  useEffect(() => {
    const handleUpdate = () => {
      setObsidianPending(obsidianAdapter.getPendingCount());
      setObsidianFailed(obsidianAdapter.getFailedCount());
    };
    obsidianAdapter.subscribe(handleUpdate);
    return () => {};
  }, []);

  const getObsidianStatus = () => {
    if (obsidianFailed > 0) return 'error';
    if (obsidianPending > 0) return 'syncing';
    return 'idle';
  };

  const handleOpenJarvis = () => {
    chat.setTarget('agent-jarvis');
    if (!chat.isExpanded) chat.toggleExpanded();
  };

  const handleOpenApify = () => {
    setShowApify(true);
  };

  return (
    <div style={{ padding: '24px 32px', height: '100%', overflowY: 'auto' }}>
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: '2rem', fontWeight: 700, letterSpacing: '-0.03em', color: 'var(--text-primary)' }}>
          Agentic Workspace
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
          Your autonomous tools and integrations, ready to deploy.
        </p>
      </div>

      <div style={{ display: 'grid', gap: '32px', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
        
        {/* Active Agents Column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Core Agents
          </div>
          <AgentTile 
            id="jarvis"
            name="Jarvis"
            description="Primary multimodal assistant. Handles code generation, file ops, and general tasks."
            icon={Bot}
            colorVar="var(--color-jarvis)"
            status="active"
            tags={['System', 'LLM']}
            onClick={handleOpenJarvis}
          />
          <AgentTile 
            id="qwythos"
            name="Qwythos Workspace"
            description="Local-first agentic workspace. Inspect agents, run pipelines, and control Agentic OS."
            icon={Terminal}
            colorVar="#8b5cf6"
            status="active"
            tags={['Local', 'Agentic']}
            onClick={() => setShowQwythos(true)}
          />
          <AgentTile 
            id="athena"
            name="Unavailable agent"
            description="Specialized in data analysis, vector search, and long-term memory aggregation."
            icon={Cpu}
            colorVar="var(--color-athena)"
            status="idle"
            tags={['Analytics']}
          />
          <AgentTile 
            id="sentinel"
            name="Sentinel"
            description="Monitors background tasks, system health, and scheduled cron jobs."
            icon={Shield}
            colorVar="var(--color-sentinel)"
            status="active"
            tags={['Monitoring']}
          />
        </div>

        {/* Knowledge & Storage Column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Knowledge & Storage
          </div>
          <AgentTile 
            id="obsidian"
            name="Obsidian Vault"
            description="Your local markdown vault synced via Syncthing. Hermes reads this automatically."
            icon={Database}
            colorVar="var(--color-obsidian)"
            status={getObsidianStatus()}
            tags={['Local', 'Syncthing']}
          />
          <AgentTile 
            id="local-fs"
            name="Local Workspace"
            description="Direct access to the C:\Users\Cris workspace files and Antigravity OS data."
            icon={HardDrive}
            colorVar="var(--color-hermes)"
            status="idle"
            tags={['FileSystem']}
          />
        </div>

        {/* External Tools Column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            External Integrations
          </div>
          <AgentTile 
            id="apify"
            name="Apify Console"
            description="Web scraping and automation actors. Extract data from any website."
            icon={Globe}
            colorVar="var(--color-apify)"
            status="active"
            tags={['Web', 'Scraping']}
            onClick={handleOpenApify}
          />
          <AgentTile 
            id="webhooks"
            name="Webhook Relays"
            description="Listen for external events from Stripe, GitHub, or custom triggers."
            icon={Webhook}
            colorVar="var(--color-info)"
            status="idle"
            tags={['Triggers']}
          />
        </div>

      </div>

      {/* Kanban Board Container */}
      <KanbanContainer />

      {/* Qwythos Workspace Modal */}
      {showQwythos && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'var(--bg-overlay)',
          zIndex: 9000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backdropFilter: 'blur(8px)',
        }}>
          <div style={{
            width: '90%',
            maxWidth: '1100px',
            height: '80%',
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-lg)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            boxShadow: 'var(--shadow-xl)',
            animation: 'fadeSlideUp 0.3s ease-out',
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px 20px',
              borderBottom: '1px solid var(--border-subtle)',
              background: 'var(--bg-surface)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Terminal size={18} color="#8b5cf6" />
                <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>Qwythos Workspace</span>
              </div>
              <button
                onClick={() => setShowQwythos(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-tertiary)',
                  cursor: 'pointer',
                  padding: 4,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 'var(--radius-xs)',
                }}
              >
                <X size={18} />
              </button>
            </div>
            <QwythosDashboard />
          </div>
        </div>
      )}

      {/* Apify Modal Overlay */}
      {showApify && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'var(--bg-overlay)',
          zIndex: 9000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backdropFilter: 'blur(8px)',
        }}>
          <div style={{
            width: '90%',
            maxWidth: '1200px',
            height: '85%',
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-lg)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            boxShadow: 'var(--shadow-xl)',
            animation: 'fadeSlideUp 0.3s ease-out',
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px 20px',
              borderBottom: '1px solid var(--border-subtle)',
              background: 'var(--bg-surface)'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Globe size={18} color="var(--color-apify)" />
                <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>Apify Console</span>
              </div>
              <button 
                onClick={() => setShowApify(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-tertiary)',
                  cursor: 'pointer',
                  padding: 4,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 'var(--radius-xs)',
                }}
              >
                <X size={18} />
              </button>
            </div>
            
            <iframe 
              src="https://console.apify.com" 
              style={{ flex: 1, width: '100%', border: 'none', background: '#fff' }}
              title="Apify Console"
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default DesktopBoard;
