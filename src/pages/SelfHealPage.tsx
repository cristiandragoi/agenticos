import React, { useState, useEffect } from 'react';
import { apiFetch } from '../api/client';

// Types
interface Incident {
  incidentId: string;
  component: string;
  status: string;
  priority: string;
  symptom: string;
}

interface IncidentDetail extends Incident {
  diagnosis?: {
    rootCause: string;
    confidence: number;
    riskLevel: string;
    affectedFiles: string[];
    repairSteps: string[];
  };
  attempt?: {
    filesChanged: string[];
    diffPreview: string;
    testResults: string;
    argusVerdict: string;
  };
}

interface StatusResponse {
  status: string;
  activeIncidentCount: number;
}

const COLORS = {
  bg: '#0a0a0f',
  card: '#1e293b',
  border: '#334155',
  text: '#f8fafc',
  textMuted: '#94a3b8',
  cyan: '#22d3ee',
  green: '#22c55e',
  yellow: '#fbbf24',
  red: '#ef4444',
  orange: '#fb923c',
};

const STYLES = {
  page: {
    backgroundColor: COLORS.bg,
    color: COLORS.text,
    fontFamily: "'JetBrains Mono', 'Consolas', monospace",
    minHeight: '100vh',
    padding: '2rem',
    boxSizing: 'border-box' as const,
  },
  header: {
    color: COLORS.cyan,
    fontSize: '1.5rem',
    marginBottom: '2rem',
    fontWeight: 'bold',
    borderBottom: `1px solid ${COLORS.border}`,
    paddingBottom: '1rem',
  },
  card: {
    background: COLORS.card,
    border: `1px solid ${COLORS.border}`,
    borderRadius: 6,
    padding: '1.5rem',
    marginBottom: '1.5rem',
  },
  title: {
    fontSize: '1.1rem',
    marginBottom: '1rem',
    color: COLORS.cyan,
    fontWeight: 'bold',
  },
  input: {
    background: '#0f172a',
    border: `1px solid ${COLORS.border}`,
    color: COLORS.text,
    padding: '0.5rem',
    borderRadius: 4,
    fontFamily: 'inherit',
    width: '100%',
    marginBottom: '1rem',
    boxSizing: 'border-box' as const,
  },
  select: {
    background: '#0f172a',
    border: `1px solid ${COLORS.border}`,
    color: COLORS.text,
    padding: '0.5rem',
    borderRadius: 4,
    fontFamily: 'inherit',
    width: '100%',
    marginBottom: '1rem',
    boxSizing: 'border-box' as const,
  },
  button: {
    background: COLORS.cyan,
    color: '#000',
    border: 'none',
    padding: '0.5rem 1rem',
    borderRadius: 4,
    fontFamily: 'inherit',
    fontWeight: 'bold',
    cursor: 'pointer',
    marginRight: '0.5rem',
  },
  badge: {
    display: 'inline-block',
    padding: '0.25rem 0.5rem',
    borderRadius: 4,
    fontSize: '0.8rem',
    fontWeight: 'bold',
    color: '#000',
  },
  pre: {
    background: '#0f172a',
    padding: '1rem',
    borderRadius: 4,
    overflowX: 'auto' as const,
    fontSize: '0.9rem',
    border: `1px solid ${COLORS.border}`,
  }
};

const getStatusColor = (status: string) => {
  const s = status.toLowerCase();
  if (['detected', 'collecting_evidence', 'diagnosing'].includes(s)) return COLORS.yellow;
  if (['diagnosed', 'planning_repair'].includes(s)) return COLORS.cyan; // blue/cyan
  if (['repairing', 'testing', 'verifying'].includes(s)) return COLORS.cyan;
  if (['awaiting_approval'].includes(s)) return COLORS.orange;
  if (['deployed', 'resolved'].includes(s)) return COLORS.green;
  if (['failed', 'needs_human', 'rolled_back'].includes(s)) return COLORS.red;
  return COLORS.textMuted;
};

const SelfHealPage: React.FC = () => {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [selectedIncident, setSelectedIncident] = useState<IncidentDetail | null>(null);
  const [error, setError] = useState('');

  // Form state
  const [formComponent, setFormComponent] = useState('');
  const [formSymptom, setFormSymptom] = useState('');
  const [formDomain, setFormDomain] = useState('renderer');
  const [formPriority, setFormPriority] = useState('medium');

  const fetchStatus = async () => {
    try {
      const res = await apiFetch('/self-heal/status');
      if (res.ok) setStatus(await res.json());
    } catch (e) {
      console.error('Failed to fetch status', e);
    }
  };

  const fetchIncidents = async () => {
    try {
      const res = await apiFetch('/self-heal/incidents');
      if (!res.ok) throw new Error('Failed to load incidents');
      const data = await res.json();
      setIncidents(data.incidents ?? []);
    } catch (e) {
      setError(String(e));
    }
  };

  useEffect(() => {
    fetchStatus();
    fetchIncidents();
    const timer = setInterval(() => { void fetchStatus(); void fetchIncidents(); }, 3000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!selectedIncident) return;
    const timer = setInterval(() => { void handleSelectIncident(selectedIncident.incidentId); }, 3000);
    return () => clearInterval(timer);
  }, [selectedIncident?.incidentId]);

  const handleCreateIncident = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await apiFetch('/self-heal/incidents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          component: formComponent,
          symptom: formSymptom,
          failureDomain: formDomain,
          priority: formPriority,
        }),
      });
      if (res.ok) {
        setFormComponent('');
        setFormSymptom('');
        fetchIncidents();
        fetchStatus();
      } else { setError((await res.json()).error || 'Could not create incident'); }
    } catch (e) {
      console.error('Failed to create incident', e);
    }
  };

  const handleSelectIncident = async (id: string) => {
    try {
      const res = await apiFetch(`/self-heal/incidents/${id}`);
      if (res.ok) {
        const data = await res.json();
        const attempt = data.attempts?.at(-1);
        setSelectedIncident({
          ...data.incident,
          status: data.currentState ?? data.incident.status,
          diagnosis: data.diagnoses?.at(-1),
          attempt: attempt ? {
            ...attempt,
            diffPreview: attempt.fullDiff || attempt.diffSummary,
            testResults: attempt.testReport?.overallVerdict || 'Not available',
          } : undefined,
        });
      }
    } catch (e) {
      console.error('Failed to fetch incident details', e);
    }
  };

  const handleAction = async (id: string, action: string) => {
    try {
      setError('');
      const res = await apiFetch(`/self-heal/incidents/${id}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (res.ok) {
        handleSelectIncident(id); // refresh
        fetchIncidents();
      } else { setError((await res.json()).error || `Could not ${action} incident`); }
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <div style={STYLES.page}>
      <div style={STYLES.header}>SELF-HEAL ENGINEERING SUPERVISOR</div>
      {error && <div role="alert" style={{ color: COLORS.red, marginBottom: '1rem' }}>{error}</div>}

      {/* System Status */}
      <div style={{ ...STYLES.card, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={STYLES.title}>System Status</div>
          <div>Supervisor: <span style={{ color: status?.status === 'healthy' ? COLORS.green : COLORS.red }}>{status?.status?.toUpperCase() || 'CONNECTING'}</span></div>
          <div>Active Incidents: {status?.activeIncidentCount ?? 0}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={STYLES.title}>Deployment</div>
          <div style={{ color: COLORS.textMuted }}>Approval does not install a repair.</div>
          <div style={{ color: COLORS.textMuted }}>This version requires manual deployment.</div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '2rem' }}>
        {/* Left Column: Form & List */}
        <div style={{ flex: 1 }}>
          <div style={STYLES.card}>
            <div style={STYLES.title}>Create Incident</div>
            <form onSubmit={handleCreateIncident}>
              <input 
                style={STYLES.input} 
                placeholder="Component (e.g., LiveKitConnector)" 
                value={formComponent} 
                onChange={e => setFormComponent(e.target.value)} 
                required 
              />
              <textarea 
                style={{ ...STYLES.input, minHeight: '80px' }} 
                placeholder="Symptom (e.g., connection drops after 30s)" 
                value={formSymptom} 
                onChange={e => setFormSymptom(e.target.value)} 
                required 
              />
              <div style={{ display: 'flex', gap: '1rem' }}>
                <select style={STYLES.select} value={formDomain} onChange={e => setFormDomain(e.target.value)}>
                  <option value="renderer">Renderer</option>
                  <option value="backend">Backend</option>
                  <option value="voice">Voice</option>
                  <option value="database">Database</option>
                  <option value="livekit">LiveKit</option>
                  <option value="model_gateway">Model Gateway</option>
                </select>
                <select style={STYLES.select} value={formPriority} onChange={e => setFormPriority(e.target.value)}>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="critical">Critical</option>
                </select>
              </div>
              <button type="submit" style={STYLES.button}>CREATE INCIDENT</button>
            </form>
          </div>

          <div style={STYLES.title}>Active Incidents</div>
          {incidents.length === 0 ? (
            <div style={{ color: COLORS.textMuted }}>No incidents reported.</div>
          ) : (
            incidents.map(inc => (
              <div 
                key={inc.incidentId} 
                style={{ ...STYLES.card, cursor: 'pointer', borderColor: selectedIncident?.incidentId === inc.incidentId ? COLORS.cyan : COLORS.border }}
                onClick={() => handleSelectIncident(inc.incidentId)}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                  <strong>{inc.component}</strong>
                  <span style={{ ...STYLES.badge, backgroundColor: getStatusColor(inc.status) }}>
                    {inc.status}
                  </span>
                </div>
                <div style={{ color: COLORS.textMuted, fontSize: '0.9rem', marginBottom: '0.5rem' }}>
                  ID: {inc.incidentId} | Priority: <span style={{ color: inc.priority === 'critical' ? COLORS.red : COLORS.textMuted }}>{inc.priority.toUpperCase()}</span>
                </div>
                <div style={{ fontSize: '0.9rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {inc.symptom}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Right Column: Details */}
        <div style={{ flex: 1 }}>
          {selectedIncident ? (
            <div style={STYLES.card}>
              <div style={STYLES.title}>Incident Details: {selectedIncident.incidentId}</div>
              <div style={{ marginBottom: '1rem' }}>
                <span style={{ ...STYLES.badge, backgroundColor: getStatusColor(selectedIncident.status) }}>
                  {selectedIncident.status}
                </span>
              </div>
              <p><strong>Component:</strong> {selectedIncident.component}</p>
              <p><strong>Priority:</strong> {selectedIncident.priority}</p>
              <p><strong>Symptom:</strong></p>
              <div style={STYLES.pre}>{selectedIncident.symptom}</div>

              {selectedIncident.diagnosis && (
                <div style={{ marginTop: '1.5rem', borderTop: `1px solid ${COLORS.border}`, paddingTop: '1rem' }}>
                  <div style={{ color: COLORS.cyan, fontWeight: 'bold', marginBottom: '0.5rem' }}>Diagnosis</div>
                  <p><strong>Root Cause:</strong> {selectedIncident.diagnosis.rootCause}</p>
                  <p><strong>Risk Level:</strong> {selectedIncident.diagnosis.riskLevel}</p>
                  <p><strong>Confidence:</strong> {selectedIncident.diagnosis.confidence}%</p>
                  <p><strong>Affected Files:</strong></p>
                  <ul style={{ margin: '0.5rem 0', paddingLeft: '1.5rem' }}>
                    {selectedIncident.diagnosis.affectedFiles.map(f => <li key={f}>{f}</li>)}
                  </ul>
                </div>
              )}

              {selectedIncident.attempt && (
                <div style={{ marginTop: '1.5rem', borderTop: `1px solid ${COLORS.border}`, paddingTop: '1rem' }}>
                  <div style={{ color: COLORS.cyan, fontWeight: 'bold', marginBottom: '0.5rem' }}>Repair Attempt</div>
                  <p><strong>Test Results:</strong> {selectedIncident.attempt.testResults}</p>
                  <p><strong>Argus Verdict:</strong> {selectedIncident.attempt.argusVerdict}</p>
                  <p><strong>Diff Preview:</strong></p>
                  <pre style={STYLES.pre}>{selectedIncident.attempt.diffPreview}</pre>
                </div>
              )}

              <div style={{ marginTop: '1.5rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <button style={{ ...STYLES.button, backgroundColor: COLORS.cyan }} onClick={() => handleAction(selectedIncident.incidentId, 'diagnose')}>DIAGNOSE</button>
                <button style={{ ...STYLES.button, backgroundColor: COLORS.yellow }} onClick={() => handleAction(selectedIncident.incidentId, 'repair')}>REPAIR</button>
                <button style={{ ...STYLES.button, backgroundColor: COLORS.green }} onClick={() => handleAction(selectedIncident.incidentId, 'approve')}>APPROVE</button>
                <button style={{ ...STYLES.button, backgroundColor: COLORS.red }} onClick={() => handleAction(selectedIncident.incidentId, 'reject')}>REJECT</button>
              </div>
            </div>
          ) : (
            <div style={{ ...STYLES.card, textAlign: 'center', color: COLORS.textMuted }}>
              Select an incident to view details.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SelfHealPage;
