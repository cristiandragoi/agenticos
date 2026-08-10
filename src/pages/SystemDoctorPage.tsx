import React, { useState, useEffect } from 'react';
import styled from 'styled-components';
import { apiFetch, apiUrl } from '../api/client';

const Container = styled.div`
  padding: 24px;
  max-width: 1200px;
  margin: 0 auto;
  color: white;
  font-family: 'Inter', sans-serif;
`;

const Header = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
`;

const Title = styled.h1`
  font-size: 24px;
  font-weight: 600;
  margin: 0;
  display: flex;
  align-items: center;
  gap: 12px;
`;

const Button = styled.button`
  background: #3b82f6;
  color: white;
  border: none;
  padding: 8px 16px;
  border-radius: 6px;
  font-weight: 500;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  transition: background 0.2s;

  &:hover {
    background: #2563eb;
  }
  
  &:disabled {
    background: #4b5563;
    cursor: not-allowed;
  }
`;

const StatusBadge = styled.span<{ status: 'Healthy' | 'Degraded' | 'Broken' }>`
  padding: 4px 12px;
  border-radius: 20px;
  font-size: 14px;
  font-weight: 600;
  background: ${props => 
    props.status === 'Healthy' ? 'rgba(16, 185, 129, 0.2)' :
    props.status === 'Degraded' ? 'rgba(245, 158, 11, 0.2)' :
    'rgba(239, 68, 68, 0.2)'};
  color: ${props => 
    props.status === 'Healthy' ? '#10b981' :
    props.status === 'Degraded' ? '#f59e0b' :
    '#ef4444'};
  border: 1px solid ${props => 
    props.status === 'Healthy' ? 'rgba(16, 185, 129, 0.3)' :
    props.status === 'Degraded' ? 'rgba(245, 158, 11, 0.3)' :
    'rgba(239, 68, 68, 0.3)'};
`;

const Grid = styled.div`
  display: grid;
  grid-template-columns: 1fr;
  gap: 16px;
`;

const CheckCard = styled.div<{ status: 'passed' | 'warning' | 'failed' | 'skipped' }>`
  background: #1f2937;
  border-left: 4px solid ${props => 
    props.status === 'passed' ? '#10b981' :
    props.status === 'warning' ? '#f59e0b' :
    props.status === 'skipped' ? '#6b7280' :
    '#ef4444'};
  border-radius: 8px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const CheckHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
`;

const CheckTitle = styled.div`
  font-weight: 600;
  font-size: 16px;
  display: flex;
  align-items: center;
  gap: 8px;
`;

const CheckStatus = styled.span<{ status: 'passed' | 'warning' | 'failed' | 'skipped' }>`
  font-size: 14px;
  font-weight: 500;
  text-transform: uppercase;
  color: ${props => 
    props.status === 'passed' ? '#10b981' :
    props.status === 'warning' ? '#f59e0b' :
    props.status === 'skipped' ? '#9ca3af' :
    '#ef4444'};
`;

const CheckSummary = styled.div`
  font-size: 14px;
  color: #d1d5db;
`;

const RecommendationBox = styled.div`
  margin-top: 8px;
  padding: 12px;
  background: rgba(59, 130, 246, 0.1);
  border-left: 3px solid #3b82f6;
  border-radius: 4px;
  font-size: 14px;
`;

const RepairAction = styled.div`
  margin-top: 8px;
`;

const Pre = styled.pre`
  background: #111827;
  padding: 12px;
  border-radius: 4px;
  font-size: 12px;
  overflow-x: auto;
  color: #9ca3af;
  margin-top: 12px;
`;

interface DiagnosticCheckResult {
  id: string;
  status: 'passed' | 'warning' | 'failed' | 'skipped';
  summary: string;
  durationMs: number;
  details: any;
  recommendation?: string | null;
}

interface DiagnosticReport {
  overallStatus: 'Healthy' | 'Degraded' | 'Broken';
  timestamp: string;
  checks: DiagnosticCheckResult[];
  firstFailingBoundary?: string;
  originalError?: any;
}

export default function SystemDoctorPage() {
  const [report, setReport] = useState<DiagnosticReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSummary = async () => {
    try {
      const res = await apiFetch('/api/diagnostics/summary');
      if (res.ok) {
        const data = await res.json();
        setReport(data);
      }
    } catch (err) {
      console.error('Failed to fetch summary', err);
    }
  };

  useEffect(() => {
    fetchSummary();
  }, []);

  const runDiagnostics = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/api/diagnostics/run', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to run diagnostics');
      } else {
        setReport(data);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleRepairCodeX = async () => {
    if (!window.confirm('Apply automatic repair for CodeX provider assignment?')) return;
    
    try {
      const res = await apiFetch('/api/diagnostics/repair/fix-codex-assignment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newProviderId: 'prov-ollama', newModelId: 'qwen3.5:4b' })
      });
      const data = await res.json();
      if (res.ok) {
        alert('Repair applied successfully. Running diagnostics again...');
        runDiagnostics();
      } else {
        alert(`Repair failed: ${data.error}`);
      }
    } catch (err: any) {
      alert(`Repair error: ${err.message}`);
    }
  };

  return (
    <Container>
      <Header>
        <Title>
          🩺 AgenticOS Doctor
          {report && <StatusBadge status={report.overallStatus}>{report.overallStatus}</StatusBadge>}
        </Title>
        <Button onClick={runDiagnostics} disabled={loading}>
          {loading ? 'Running...' : 'Run Diagnostics'}
        </Button>
      </Header>

      {error && (
        <CheckCard status="failed" style={{ marginBottom: 16 }}>
          <CheckHeader>
            <CheckTitle>Execution Error</CheckTitle>
          </CheckHeader>
          <CheckSummary>{error}</CheckSummary>
        </CheckCard>
      )}

      {report && (
        <>
          <div style={{ marginBottom: 24, fontSize: 14, color: '#9ca3af' }}>
            Last run: {new Date(report.timestamp).toLocaleString()}
          </div>
          <Grid>
            {report.checks.map(check => (
              <CheckCard key={check.id} status={check.status}>
                <CheckHeader>
                  <CheckTitle>
                    {check.id}
                    <span style={{ fontSize: 12, color: '#6b7280', fontWeight: 'normal' }}>
                      {check.durationMs}ms
                    </span>
                  </CheckTitle>
                  <CheckStatus status={check.status}>{check.status}</CheckStatus>
                </CheckHeader>
                <CheckSummary>{check.summary}</CheckSummary>
                
                {check.recommendation && (
                  <RecommendationBox>
                    <strong>💡 Recommendation:</strong> {check.recommendation}
                  </RecommendationBox>
                )}
                
                {check.id === 'ASSIGNMENT_AGENT_CODEX' && check.status !== 'passed' && (
                  <RepairAction>
                    <Button onClick={handleRepairCodeX} style={{ background: '#059669' }}>
                      Auto-Repair Assignment
                    </Button>
                  </RepairAction>
                )}
                
                {check.status === 'failed' && check.details && (
                  <Pre>{JSON.stringify(check.details, null, 2)}</Pre>
                )}
              </CheckCard>
            ))}
          </Grid>
          
          {report.firstFailingBoundary && (
            <div style={{ marginTop: 32 }}>
              <h3 style={{ borderBottom: '1px solid #374151', paddingBottom: 8 }}>First Failing Boundary</h3>
              <p style={{ color: '#ef4444', fontFamily: 'monospace' }}>{report.firstFailingBoundary}</p>
            </div>
          )}
          
          {report.originalError && (
            <div style={{ marginTop: 24 }}>
              <h3 style={{ borderBottom: '1px solid #374151', paddingBottom: 8 }}>Original Error Trace</h3>
              <Pre>{JSON.stringify(report.originalError, null, 2)}</Pre>
            </div>
          )}
        </>
      )}
      
      {!report && !error && !loading && (
        <div style={{ textAlign: 'center', padding: '64px 0', color: '#6b7280' }}>
          No diagnostic report available. Click "Run Diagnostics" to check system health.
        </div>
      )}
    </Container>
  );
}
