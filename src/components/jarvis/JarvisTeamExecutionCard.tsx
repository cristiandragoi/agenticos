import React, { useState, useEffect } from 'react';
import { ExternalLink, PlayCircle, StopCircle, Loader2 } from 'lucide-react';
import styles from '../../pages/JarvisStudio.module.css';
import { apiClient } from '../../api/client';
import TeamTimeline from '../teams/TeamTimeline';
import TeamArtifactsPanel from '../teams/TeamArtifactsPanel';

interface JarvisTeamExecutionCardProps {
  runId: string;
  teamId?: string;
}

export const JarvisTeamExecutionCard: React.FC<JarvisTeamExecutionCardProps> = ({ 
  runId,
  teamId
}) => {
  const [run, setRun] = useState<any>(null);
  const [team, setTeam] = useState<any>(null);
  const [reports, setReports] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [now, setNow] = useState(Date.now());

  const fetchData = async () => {
    try {
      const runData = await apiClient.get(`/api/teams/runs/${runId}`);
      setRun(runData);

      if (runData?.teamId) {
        const teamData = await apiClient.get(`/api/teams/${runData.teamId}`);
        setTeam(teamData);
      }

      const reportData = await apiClient.get(`/api/teams/runs/${runId}/reports`);
      if (reportData?.reports) setReports(reportData.reports);

    } catch (err) {
      console.error('Failed to fetch execution state:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();

    // Poll if still active
    const interval = setInterval(() => {
      if (run?.status !== 'completed' && run?.status !== 'failed') {
        fetchData();
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [runId, run?.status]);

  const isTerminal = run?.status === 'completed' || run?.status === 'failed';

  useEffect(() => {
    if (!run || isTerminal) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [run?.id, isTerminal]);

  if (isLoading) {
    return (
      <div style={{ padding: '16px', display: 'flex', gap: '8px', alignItems: 'center', color: 'var(--text-secondary)' }}>
        <Loader2 size={16} className="animate-spin" />
        Loading execution state...
      </div>
    );
  }

  if (!run || !team) {
    return (
      <div style={{ padding: '16px', color: 'var(--color-error)' }}>
        Execution data not found for run: {runId}
      </div>
    );
  }

  const getStatusColor = () => {
    switch (run.status) {
      case 'running': return 'var(--color-jarvis)';
      case 'paused': return 'var(--color-warning)';
      case 'completed': return 'var(--color-success)';
      case 'failed': return 'var(--color-error)';
      default: return 'var(--text-tertiary)';
    }
  };

  const currentAgentDef = (team.teamSheet?.agents || []).find((a: any) => a.id === run.currentAgent);
  const elapsed = (() => {
    const start = new Date(run.createdAt).getTime();
    if (isNaN(start)) return '';
    const ms = Math.max(0, (isTerminal ? new Date(run.updatedAt || now).getTime() : now) - start);
    const s = Math.floor(ms / 1000) % 60;
    const m = Math.floor(ms / 60000);
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  })();

  return (
    <div style={{
      border: `1px solid ${getStatusColor()}`,
      borderRadius: '8px',
      background: 'rgba(255,255,255,0.02)',
      marginTop: '12px',
      marginBottom: '12px',
      overflow: 'hidden',
      width: '100%',
      display: 'flex',
      flexDirection: 'column'
    }}>
      {/* Header */}
      <div style={{
        padding: '16px',
        borderBottom: '1px solid var(--border-color)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '12px',
        flexWrap: 'wrap',
        background: `rgba(255,255,255,0.02)`
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
          <div style={{ 
            width: '12px', height: '12px', borderRadius: '50%', flexShrink: 0,
            background: getStatusColor(),
            boxShadow: isTerminal ? 'none' : `0 0 8px ${getStatusColor()}`
          }} />
          <div style={{ minWidth: 0 }}>
            <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)', overflowWrap: 'anywhere' }}>
              {team.name}
            </h3>
            <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
              Status: <span style={{ color: getStatusColor(), textTransform: 'capitalize' }}>{run.status}</span>
              {currentAgentDef && !isTerminal && (
                <span> · Agent: <span style={{ color: 'var(--text-primary)' }}>{currentAgentDef.name || currentAgentDef.role}</span></span>
              )}
              {elapsed && <span> · {elapsed}</span>}
            </p>
          </div>
        </div>
        
        <a 
          href={`#/teams/${team.id}`}
          className={styles.actionBtn}
          style={{ textDecoration: 'none', display: 'flex', gap: '6px', flexShrink: 0 }}
        >
          <ExternalLink size={14} /> Open Details
        </a>
      </div>

      {/* Main Body */}
      <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', minHeight: '300px' }}>
        
        {/* Left: Timeline */}
        <div style={{ flex: '1 1 280px', minWidth: 0, padding: '16px', borderRight: '1px solid var(--border-color)', overflowY: 'auto' }}>
          <TeamTimeline team={team} run={run} />
          
          {reports.length > 0 && (() => {
            const latest = reports[reports.length - 1];
            const passed = latest.passed === true || latest.passed === 1;
            let issues: any[] = [];
            try {
              const raw = typeof latest.blocking_issues === 'string' ? JSON.parse(latest.blocking_issues) : latest.blocking_issues;
              issues = Array.isArray(raw) ? raw : [];
            } catch { issues = []; }
            const issueText = (issue: any) =>
              typeof issue === 'string'
                ? issue
                : `${issue?.name || 'Blocking issue'}${issue?.evidence ? ` — ${issue.evidence}` : ''}`;

            return (
              <div style={{
                marginTop: '24px', padding: '16px', borderRadius: '8px',
                background: passed ? 'rgba(16, 185, 129, 0.1)' : 'rgba(244, 63, 94, 0.08)',
                border: `1px solid ${passed ? 'var(--color-success)' : 'var(--color-error)'}`
              }}>
                <h4 style={{ margin: '0 0 8px 0', color: passed ? 'var(--color-success)' : 'var(--color-error)' }}>
                  {passed ? 'Verification Passed' : 'Verification Failed'}
                </h4>
                {passed ? (
                  <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
                    {latest.evidence || 'All verification checks passed.'}
                  </p>
                ) : (
                  <ul style={{ margin: 0, paddingLeft: '18px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    {issues.length > 0
                      ? issues.map((issue: any, i: number) => (
                          <li key={i} style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>{issueText(issue)}</li>
                        ))
                      : <li style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>{latest.evidence || 'Verification did not pass.'}</li>}
                  </ul>
                )}
              </div>
            );
          })()}
        </div>

        {/* Right: Artifacts */}
        <div style={{ flex: '1 1 280px', minWidth: 0, background: 'rgba(0,0,0,0.1)' }}>
          <TeamArtifactsPanel team={team} runId={run.id} />
        </div>

      </div>

      {/* Controls */}
      <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border-color)', display: 'flex', gap: '8px', justifyContent: 'flex-end', background: 'rgba(0,0,0,0.2)' }}>
        {run.status === 'running' && (
          <button className={styles.actionBtn} onClick={() => apiClient.post(`/api/teams/runs/${run.id}/pause`)}>
            <StopCircle size={14} /> Pause
          </button>
        )}
        {run.status === 'paused' && (
          <button className={styles.actionBtn} onClick={() => apiClient.post(`/api/teams/runs/${run.id}/resume`)}>
            <PlayCircle size={14} /> Resume
          </button>
        )}
      </div>

    </div>
  );
};
