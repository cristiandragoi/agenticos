import React, { useEffect, useState } from 'react';
import { Activity, FolderGit2, Cpu, MessageSquare, ChevronDown, ChevronRight } from 'lucide-react';
import styles from '../../pages/JarvisStudio.module.css';
import { useCodexStore } from '../../store/codexStore';
import { providerLabel, approvalLabel } from '../codex/RunSettings';
import { apiFetch, apiUrl } from '../../api/client';

interface JarvisInspectorProps {
  activeConversation: any;
}

/**
 * Contextual right-hand inspector: only information relevant to the active
 * conversation and execution. Raw diagnostics live behind an expandable
 * section instead of dominating the panel.
 */
export const JarvisInspector: React.FC<JarvisInspectorProps> = ({ activeConversation }) => {
  const { runSettings } = useCodexStore();
  const [diagnostics, setDiagnostics] = useState<any>(null);
  const [diagOpen, setDiagOpen] = useState(false);

  useEffect(() => {
    apiFetch('/api/jarvis/diagnostics')
      .then(res => res.json())
      .then(setDiagnostics)
      .catch(console.error);
  }, []);

  const cardStyle: React.CSSProperties = {
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border-subtle)',
    borderRadius: 'var(--radius-md)',
    padding: '12px 16px'
  };

  const rowStyle: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    gap: '12px',
    fontSize: '12px',
    color: 'var(--text-secondary)',
    padding: '3px 0'
  };

  const valueStyle: React.CSSProperties = { color: 'var(--text-primary)', textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '60%' };

  return (
    <div className={styles.inspector} data-testid="jarvis-inspector">
      <div className={styles.inspectorHeader}>
        <h2 className={styles.sidebarTitle}>Context Inspector</h2>
      </div>
      <div className={styles.inspectorBody}>

        {/* Conversation */}
        <div className={styles.inspectorSection}>
          <div className={styles.inspectorLabel}>Conversation</div>
          <div style={cardStyle}>
            {activeConversation ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-primary)', fontSize: '13px', fontWeight: 600 }}>
                <MessageSquare size={14} style={{ color: 'var(--color-jarvis)', flexShrink: 0 }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{activeConversation.title}</span>
              </div>
            ) : (
              <span style={{ color: 'var(--text-tertiary)', fontSize: '13px' }}>No conversation selected</span>
            )}
          </div>
        </div>

        {/* Repository */}
        <div className={styles.inspectorSection}>
          <div className={styles.inspectorLabel}>Repository</div>
          <div style={cardStyle}>
            {runSettings.workspacePath ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'var(--color-success)', fontFamily: 'monospace' }} title={runSettings.workspacePath}>
                <FolderGit2 size={14} style={{ flexShrink: 0 }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{runSettings.workspacePath}</span>
              </div>
            ) : (
              <span style={{ color: 'var(--color-error)', fontSize: '12px', fontWeight: 600 }}>Select repository</span>
            )}
          </div>
        </div>

        {/* Linked execution */}
        <div className={styles.inspectorSection}>
          <div className={styles.inspectorLabel}>Execution</div>
          <div style={cardStyle}>
            {activeConversation?.activeRunId ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'var(--color-jarvis)' }}>
                <Activity size={12} style={{ flexShrink: 0 }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={activeConversation.activeRunId}>
                  Team run linked
                </span>
              </div>
            ) : (
              <span style={{ color: 'var(--text-tertiary)', fontSize: '12px' }}>No active run</span>
            )}
            <div style={{ ...rowStyle, marginTop: '8px' }}>
              <span>Execution provider</span>
              <span style={valueStyle}>{providerLabel(runSettings.routing?.providerId || 'auto')}</span>
            </div>
            <div style={rowStyle}>
              <span>Validation provider</span>
              <span style={valueStyle}>{providerLabel(runSettings.valProvider)}</span>
            </div>
            <div style={rowStyle}>
              <span>Approval policy</span>
              <span style={valueStyle}>{approvalLabel(runSettings.approvalPolicy)}</span>
            </div>
          </div>
        </div>

        {/* Diagnostics — expandable, de-emphasized */}
        <div className={styles.inspectorSection}>
          <button
            onClick={() => setDiagOpen(!diagOpen)}
            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}
            aria-label="Toggle diagnostics"
          >
            {diagOpen ? <ChevronDown size={12} color="var(--text-tertiary)" /> : <ChevronRight size={12} color="var(--text-tertiary)" />}
            <span className={styles.inspectorLabel} style={{ marginBottom: 0 }}>Diagnostics</span>
          </button>
          {diagOpen && (
            <div style={{ ...cardStyle, marginTop: '10px' }}>
              {diagnostics?.summary ? (
                <>
                  <div style={rowStyle}><span>Providers</span><span style={valueStyle}>{diagnostics.summary.connectedProviders} / {diagnostics.summary.totalProviders}</span></div>
                  <div style={rowStyle}><span>Runtimes</span><span style={valueStyle}>{diagnostics.summary.healthyRuntimes} / {diagnostics.summary.totalRuntimes}</span></div>
                  {diagnostics.services && Object.entries(diagnostics.services).map(([name, svc]: [string, any]) => (
                    <div key={name} style={rowStyle}><span style={{ textTransform: 'capitalize' }}>{name}</span><span style={valueStyle}>{svc.status}</span></div>
                  ))}
                </>
              ) : (
                <span style={{ color: 'var(--text-tertiary)', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Cpu size={12} /> Diagnostics unavailable
                </span>
              )}
            </div>
          )}
        </div>

      </div>
    </div>
  );
};
