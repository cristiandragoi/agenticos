import React, { useEffect, useState } from 'react';
import { revenueClient } from '../../api/revenueClient';

interface MetricsSummary {
  totalOpportunities: number;
  countsByStage: Record<string, number>;
  averageOverallScore: number;
  failureRate: number;
  avgGenCost: number;
  totalAssets: number;
}

interface YieldMeasurement {
  id: string;
  opportunityId: string;
  expectedYield: number | null;
  actualYield: number | null;
  clicks: number | null;
  conversions: number | null;
  revenue: number | null;
  status: string;
  measuredAt: string;
}

export default function MetricsPanel() {
  const [summary, setSummary] = useState<MetricsSummary | null>(null);
  const [measurements, setMeasurements] = useState<YieldMeasurement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [metricsData, measurementsData] = await Promise.all([
        revenueClient.getMetrics(),
        Promise.resolve([]),
      ]);
      setSummary(metricsData);
      setMeasurements(measurementsData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load metrics');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const styles: {
    container: React.CSSProperties;
    heading: React.CSSProperties;
    summaryLine: React.CSSProperties;
    table: React.CSSProperties;
    th: React.CSSProperties;
    td: React.CSSProperties;
    button: React.CSSProperties;
  } = {
    container: { background: '#111318', color: 'white', padding: 16, fontFamily: 'sans-serif' },
    heading: { margin: '0 0 12px 0', fontSize: 18 },
    summaryLine: { display: 'flex', gap: 16, marginBottom: 16, fontSize: 14, flexWrap: 'wrap' },
    table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
    th: { textAlign: 'left', padding: 8, borderBottom: '1px solid rgba(255,255,255,0.1)' },
    td: { padding: 8, borderBottom: '1px solid rgba(255,255,255,0.1)' },
    button: { background: '#2a2d35', color: 'white', border: '1px solid rgba(255,255,255,0.1)', padding: '6px 12px', cursor: 'pointer', marginTop: 12 }
  };

  if (loading) return <div style={styles.container}>Loading Revenue Metrics...</div>;
  if (error) return <div style={styles.container}>Error: {error}</div>;

  return (
    <div style={styles.container}>
      <h2 style={styles.heading}>Revenue Metrics</h2>
      {summary && (
        <div style={styles.summaryLine}>
          <span>Total Opportunities: {summary.totalOpportunities}</span>
          <span>Avg Score: {summary.averageOverallScore.toFixed(2)}</span>
          <span>Failure Rate: {(summary.failureRate * 100).toFixed(1)}%</span>
          <span>Avg Gen Cost: ${summary.avgGenCost.toFixed(2)}</span>
          <span>Total Assets: {summary.totalAssets}</span>
        </div>
      )}
      <h3 style={{...styles.heading, fontSize: 16, marginTop: 16}}>Yield Measurements</h3>
      <table style={styles.table}>
        <thead>
          <tr>
            <th style={styles.th}>Opportunity</th>
            <th style={styles.th}>Expected Yield</th>
            <th style={styles.th}>Actual Yield</th>
            <th style={styles.th}>Revenue</th>
            <th style={styles.th}>Clicks</th>
            <th style={styles.th}>Conversions</th>
            <th style={styles.th}>Status</th>
          </tr>
        </thead>
        <tbody>
          {measurements.map(m => (
            <tr key={m.id}>
              <td style={styles.td}>{m.opportunityId}</td>
              <td style={styles.td}>{m.expectedYield ?? '-'}</td>
              <td style={styles.td}>{m.actualYield ?? '-'}</td>
              <td style={styles.td}>{m.revenue ?? '-'}</td>
              <td style={styles.td}>{m.clicks ?? '-'}</td>
              <td style={styles.td}>{m.conversions ?? '-'}</td>
              <td style={styles.td}>{m.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <button style={styles.button} onClick={loadData}>Refresh</button>
    </div>
  );
}
