import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { argusClient } from '../../api/argusClient';

interface Contract {
  id: string;
  goalId: string;
  status: string;
  createdAt: string;
}

interface ArgusVerification {
  id: string;
  contractId: string;
  evidenceLevel: string;
  status: string;
}

interface Defect {
  severity: string;
  status: string;
  description: string;
}

interface Assignment {
  providerId: string;
  modelId: string | null;
  routingMode: string;
}

const styles: Record<string, CSSProperties> = {
  panel: {
    background: '#111318',
    color: '#fff',
    fontFamily: 'sans-serif',
    padding: 16,
  },
  heading: {
    fontSize: 18,
    margin: '0 0 12px 0',
  },
  summary: {
    display: 'flex',
    gap: 16,
    fontSize: 14,
    marginBottom: 12,
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: 14,
  },
  th: {
    border: '1px solid rgba(255,255,255,0.1)',
    padding: 8,
    textAlign: 'left',
  },
  td: {
    border: '1px solid rgba(255,255,255,0.1)',
    padding: 8,
  },
  badge: {
    padding: '2px 8px',
    borderRadius: 4,
    fontSize: 12,
    color: '#111318',
  },
  error: {
    color: 'red',
  },
  defects: {
    marginTop: 16,
  },
  defectTitle: {
    fontSize: 16,
    marginBottom: 8,
  },
};

const statusColors: Record<string, string> = {
  implementation_ready: 'yellow',
  verifying: 'blue',
  verification_failed: 'red',
  correcting: 'orange',
  verified_complete: 'green',
};

const severityColors: Record<string, string> = {
  critical: 'red',
  major: 'orange',
};

export function ArgusPanel() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [defects, setDefects] = useState<Defect[]>([]);
  const [verifications, setVerifications] = useState<ArgusVerification[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [contractsData, assignmentData] = await Promise.all([
          argusClient.listContracts(),
          argusClient.getAssignment(),
        ]);
        if (cancelled) return;
        setContracts(contractsData);
        setAssignment(assignmentData);
        const failed = contractsData.filter((c: Contract) => c.status === 'verification_failed');
        if (failed.length > 0) {
          const defectsData = await argusClient.listDefects();
          if (!cancelled) setDefects(defectsData);
        }
        const verificationData = await Promise.all(
          contractsData.slice(0, 10).map(async (c) => {
            try {
              const detail = await argusClient.getContract(c.id);
              return (detail.verifications || []) as ArgusVerification[];
            } catch {
              return [] as ArgusVerification[];
            }
          }),
        );
        if (!cancelled) setVerifications(verificationData.flat());
        if (!cancelled) setLoading(false);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setLoading(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return <div style={styles.panel}>Loading ARGUS status...</div>;
  }

  if (error) {
    return <div style={styles.panel}><div style={styles.error}>{error}</div></div>;
  }

  const assignmentLine = assignment
    ? `Provider: ${assignment.providerId} · Model: ${assignment.modelId} · Routing: ${assignment.routingMode}`
    : 'No assignment';

  const latestEvidence = (contractId: string): string => {
    const vs = verifications.filter((v) => v.contractId === contractId);
    if (vs.length === 0) return '—';
    return vs[vs.length - 1].evidenceLevel || '—';
  };

  return (
    <div style={styles.panel}>
      <h2 style={styles.heading}>ARGUS — Independent Verification</h2>
      <div style={styles.summary}>{assignmentLine}</div>
      <table style={styles.table}>
        <thead>
          <tr>
            <th style={styles.th}>Contract ID</th>
            <th style={styles.th}>Goal ID</th>
            <th style={styles.th}>Status</th>
            <th style={styles.th}>Evidence Level</th>
            <th style={styles.th}>Created</th>
          </tr>
        </thead>
        <tbody>
          {contracts.map((c) => (
            <tr key={c.id}>
              <td style={styles.td}>{c.id}</td>
              <td style={styles.td}>{c.goalId}</td>
              <td style={styles.td}>
                <span style={{ ...styles.badge, background: statusColors[c.status] || 'gray' }}>
                  {c.status}
                </span>
              </td>
              <td style={styles.td}>{latestEvidence(c.id)}</td>
              <td style={styles.td}>{c.createdAt}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {defects.length > 0 && (
        <div style={styles.defects}>
          <h3 style={styles.defectTitle}>Defects</h3>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Severity</th>
                <th style={styles.th}>Status</th>
                <th style={styles.th}>Description</th>
              </tr>
            </thead>
            <tbody>
              {defects.map((d, i) => (
                <tr key={i}>
                  <td style={styles.td}>
                    <span style={{ ...styles.badge, background: severityColors[d.severity] || 'gray' }}>
                      {d.severity}
                    </span>
                  </td>
                  <td style={styles.td}>{d.status}</td>
                  <td style={styles.td}>{d.description.length > 120 ? d.description.slice(0, 120) + '...' : d.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default ArgusPanel;
