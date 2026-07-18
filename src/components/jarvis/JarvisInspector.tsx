import React, { useEffect, useState } from 'react';
import { ShieldCheck, Server, Activity, Database } from 'lucide-react';
import styles from '../../pages/JarvisStudio.module.css';

interface JarvisInspectorProps {
  activeConversation: any;
}

export const JarvisInspector: React.FC<JarvisInspectorProps> = ({ activeConversation }) => {
  const [diagnostics, setDiagnostics] = useState<any>(null);

  useEffect(() => {
    fetch('/api/jarvis/diagnostics')
      .then(res => res.json())
      .then(setDiagnostics)
      .catch(console.error);
  }, []);

  return (
    <div className={styles.inspector}>
      <div className={styles.inspectorHeader}>
        <h2 className={styles.sidebarTitle}>Context Inspector</h2>
      </div>
      <div className={styles.inspectorBody}>
        
        <div className={styles.inspectorSection}>
          <div className={styles.inspectorLabel}>Active Conversation</div>
          <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', padding: '16px' }}>
            {activeConversation ? (
              <>
                <div style={{ fontWeight: 600, marginBottom: '4px', color: 'var(--text-primary)' }}>{activeConversation.title}</div>
                <div style={{ color: 'var(--text-tertiary)', fontSize: '12px' }}>
                  ID: <span style={{ fontFamily: 'monospace' }}>{activeConversation.id}</span>
                </div>
                {activeConversation.activeRunId && (
                  <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid var(--border-subtle)', color: 'var(--color-jarvis)', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Activity size={12} />
                    Active CodeX Goal linked
                  </div>
                )}
              </>
            ) : (
              <span style={{ color: 'var(--text-tertiary)', fontSize: '13px' }}>No conversation selected</span>
            )}
          </div>
        </div>

        <div className={styles.inspectorSection}>
          <div className={styles.inspectorLabel}>System Status</div>
          <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', padding: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
              <ShieldCheck size={16} color="var(--color-success)" />
              <span style={{ fontWeight: 600, color: 'var(--color-success)', fontSize: '13px' }}>SYSTEMS NOMINAL</span>
            </div>
            {diagnostics && diagnostics.summary && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Providers</span>
                  <span style={{ color: 'var(--text-primary)' }}>{diagnostics.summary.connectedProviders} / {diagnostics.summary.totalProviders}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Runtimes</span>
                  <span style={{ color: 'var(--text-primary)' }}>{diagnostics.summary.healthyRuntimes} / {diagnostics.summary.totalRuntimes}</span>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className={styles.inspectorSection}>
          <div className={styles.inspectorLabel}>Memory Reference</div>
          <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', padding: '16px', display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-tertiary)', fontSize: '13px' }}>
            <Database size={16} />
            Canonical Memory Ready
          </div>
        </div>

      </div>
    </div>
  );
};
