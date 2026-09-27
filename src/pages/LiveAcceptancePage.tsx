import React, { useState, useEffect, useRef } from 'react';
import { CheckCircle2, XCircle, AlertTriangle, Shield, Camera, Monitor, Compass, Play, RefreshCw, Eye, Image as ImageIcon } from 'lucide-react';
import { apiFetch, apiUrl } from '../api/client';

interface AcceptanceTest {
  id: string;
  stepLetter: string;
  title: string;
  description: string;
  commandExample: string;
  requiredCapability: string;
  status: 'PENDING' | 'WAITING_FOR_USER_COMMAND' | 'EXECUTING' | 'WAITING_HUMAN_VERDICT' | 'PASSED' | 'FAILED' | 'RECOVERING';
  associatedGoalId?: string;
  lastEvidence: any[];
  humanVerdict?: 'CORRECT' | 'WRONG';
  notes?: string;
  passedAt?: string;
}

interface AcceptanceState {
  activeTestId: string;
  activeTest?: AcceptanceTest;
  activeGoal?: any;
  tests: AcceptanceTest[];
  passedCount: number;
  totalCount: number;
  allPassed: boolean;
  permissions: Record<string, string>;
  mode: string;
  timestamp: string;
}

export const LiveAcceptancePage: React.FC = () => {
  const [state, setState] = useState<AcceptanceState | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [feedbackNote, setFeedbackNote] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const pollRef = useRef<any>(null);

  const fetchState = async () => {
    try {
      const res = await apiFetch('/api/control-plane/live-acceptance');
      if (res.ok) {
        const data = await res.json();
        setState(data);
        setErrorMsg(null);
      }
    } catch (e: any) {
      setErrorMsg(`Failed to connect to Control Plane: ${e?.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchState();
    pollRef.current = setInterval(fetchState, 1500);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const handleSelectTest = async (testId: string) => {
    try {
      await apiFetch('/api/control-plane/live-acceptance/select-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ testId }),
      });
      fetchState();
    } catch (e) {
      console.error(e);
    }
  };

  const handleFeedback = async (verdict: 'CORRECT' | 'WRONG') => {
    if (!state?.activeTest) return;
    setActionLoading(true);
    setErrorMsg(null);
    try {
      const res = await apiFetch('/api/control-plane/live-acceptance/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          testId: state.activeTest.id,
          verdict,
          notes: feedbackNote || undefined,
        }),
      });
      const data = await res.json();
      if (!data.success) {
        setErrorMsg(data.message);
      } else {
        setFeedbackNote('');
      }
      fetchState();
    } catch (e: any) {
      setErrorMsg(e?.message || 'Feedback submission failed');
    } finally {
      setActionLoading(false);
    }
  };

  const activeTest = state?.activeTest;
  const activeGoal = state?.activeGoal;

  // Find screenshot evidence if present
  const screenshotEvidence = activeGoal?.evidence?.find((e: any) => e.type === 'screenshot');
  const screenshotArtifact = screenshotEvidence?.value;
  const screenshotUrl = screenshotArtifact?.fileName
    ? apiUrl(`/api/control-plane/artifacts/screenshots/${screenshotArtifact.fileName}`)
    : null;

  // Find camera frame evidence if present
  const cameraEvidence = activeGoal?.evidence?.find((e: any) => e.type === 'visual_frame');
  const cameraData = cameraEvidence?.value;

  // Find window observation evidence if present
  const windowEvidence = activeGoal?.evidence?.find((e: any) => e.type === 'window');

  return (
    <div style={{ padding: '24px', background: '#0b0f19', color: '#f1f5f9', minHeight: '100%', overflowY: 'auto' }}>
      {/* ─── Header ─── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px', borderBottom: '1px solid #1e293b', paddingBottom: '16px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#22c55e', boxShadow: '0 0 10px #22c55e' }} />
            <h1 style={{ fontSize: '24px', fontWeight: 700, margin: 0, letterSpacing: '0.05em' }}>
              LIVE ACCEPTANCE MODE
            </h1>
            <span style={{ background: '#3b82f6', color: '#fff', fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '4px' }}>
              HUMAN-IN-THE-LOOP
            </span>
          </div>
          <p style={{ color: '#94a3b8', fontSize: '14px', marginTop: '6px', margin: 0 }}>
            Physical computer control, perception, and autonomous self-heal verified by real human observation.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{ background: '#1e293b', padding: '8px 16px', borderRadius: '8px', textAlign: 'center' }}>
            <div style={{ fontSize: '12px', color: '#94a3b8' }}>Verified Passed</div>
            <div style={{ fontSize: '20px', fontWeight: 700, color: state?.allPassed ? '#22c55e' : '#38bdf8' }}>
              {state?.passedCount || 0} / {state?.totalCount || 8}
            </div>
          </div>
          <button
            onClick={fetchState}
            style={{ background: '#334155', border: 'none', color: '#fff', padding: '10px 14px', borderRadius: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
      </div>

      {errorMsg && (
        <div style={{ background: 'rgba(239, 68, 68, 0.15)', border: '1px solid #ef4444', borderRadius: '8px', padding: '12px 16px', marginBottom: '20px', color: '#fca5a5', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <AlertTriangle size={18} />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* ─── Active Test Stage ─── */}
      {activeTest && (
        <div style={{ background: '#131b2e', border: '1px solid #2563eb', borderRadius: '12px', padding: '24px', marginBottom: '28px', boxShadow: '0 8px 30px rgba(37, 99, 235, 0.15)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ background: '#2563eb', color: '#fff', fontSize: '13px', fontWeight: 700, padding: '4px 10px', borderRadius: '6px' }}>
                STEP {activeTest.stepLetter}
              </span>
              <h2 style={{ fontSize: '20px', fontWeight: 700, margin: 0 }}>{activeTest.title}</h2>
            </div>
            <span style={{
              background: activeTest.status === 'PASSED' ? '#166534' : activeTest.status === 'RECOVERING' ? '#854d0e' : activeTest.status === 'EXECUTING' ? '#1e40af' : '#334155',
              color: '#fff',
              fontSize: '12px',
              fontWeight: 700,
              padding: '4px 12px',
              borderRadius: '20px',
              textTransform: 'uppercase',
              letterSpacing: '0.05em'
            }}>
              {activeTest.status.replace(/_/g, ' ')}
            </span>
          </div>

          <p style={{ color: '#cbd5e1', fontSize: '15px', marginBottom: '16px' }}>{activeTest.description}</p>

          {/* Voice instruction prompt for user */}
          <div style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: '8px', padding: '14px 18px', marginBottom: '20px' }}>
            <div style={{ fontSize: '12px', color: '#38bdf8', fontWeight: 600, textTransform: 'uppercase', marginBottom: '4px' }}>
              Speak this command to Jarvis or type in chat:
            </div>
            <div style={{ fontSize: '16px', color: '#f8fafc', fontWeight: 600, fontFamily: 'monospace' }}>
              {activeTest.commandExample}
            </div>
          </div>

          {/* Active Goal Info & Verification Trace */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', marginBottom: '20px' }}>
            <div style={{ background: '#0f172a', padding: '12px', borderRadius: '8px', border: '1px solid #1e293b' }}>
              <div style={{ fontSize: '11px', color: '#64748b' }}>GOAL ID</div>
              <div style={{ fontSize: '13px', fontWeight: 600, color: '#e2e8f0', marginTop: '2px', wordBreak: 'break-all' }}>
                {activeTest.associatedGoalId || 'Awaiting turn…'}
              </div>
            </div>
            <div style={{ background: '#0f172a', padding: '12px', borderRadius: '8px', border: '1px solid #1e293b' }}>
              <div style={{ fontSize: '11px', color: '#64748b' }}>CAPABILITY</div>
              <div style={{ fontSize: '13px', fontWeight: 600, color: '#38bdf8', marginTop: '2px' }}>
                {activeTest.requiredCapability}
              </div>
            </div>
            <div style={{ background: '#0f172a', padding: '12px', borderRadius: '8px', border: '1px solid #1e293b' }}>
              <div style={{ fontSize: '11px', color: '#64748b' }}>PERMISSION STATE</div>
              <div style={{ fontSize: '13px', fontWeight: 600, color: '#22c55e', marginTop: '2px' }}>
                {state?.permissions?.[activeTest.requiredCapability] || 'allowed'} (persisted)
              </div>
            </div>
            <div style={{ background: '#0f172a', padding: '12px', borderRadius: '8px', border: '1px solid #1e293b' }}>
              <div style={{ fontSize: '11px', color: '#64748b' }}>EVIDENCE COUNT</div>
              <div style={{ fontSize: '13px', fontWeight: 600, color: '#e2e8f0', marginTop: '2px' }}>
                {activeGoal?.evidence?.length || 0} artifacts verified
              </div>
            </div>
          </div>

          {/* Independent Physical Evidence Display */}
          {activeGoal && (
            <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: '8px', padding: '16px', marginBottom: '20px' }}>
              <div style={{ fontSize: '13px', fontWeight: 700, color: '#94a3b8', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Shield size={16} color="#38bdf8" /> INDEPENDENT PHYSICAL EVIDENCE AUDIT
              </div>

              {/* Screenshot Evidence Preview */}
              {screenshotArtifact && (
                <div style={{ marginTop: '12px', background: '#1e293b', padding: '12px', borderRadius: '6px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', color: '#38bdf8', fontSize: '13px', fontWeight: 600 }}>
                    <ImageIcon size={16} /> Screenshot Artifact ({screenshotArtifact.byteSize} bytes, {screenshotArtifact.width}x{screenshotArtifact.height})
                  </div>
                  <div style={{ fontSize: '11px', color: '#94a3b8', wordBreak: 'break-all', marginBottom: '10px' }}>
                    SHA256: {screenshotArtifact.sha256} | Path: {screenshotArtifact.artifactPath}
                  </div>
                  {screenshotUrl && (
                    <img
                      src={screenshotUrl}
                      alt="Captured Desktop"
                      style={{ maxWidth: '100%', maxHeight: '280px', borderRadius: '6px', border: '1px solid #334155', objectFit: 'contain' }}
                    />
                  )}
                </div>
              )}

              {/* Camera Sensor Evidence */}
              {cameraData && (
                <div style={{ marginTop: '12px', background: '#1e293b', padding: '12px', borderRadius: '6px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', color: '#a855f7', fontSize: '13px', fontWeight: 600 }}>
                    <Camera size={16} /> Live Physical Camera Frame ({cameraData.width}x{cameraData.height})
                  </div>
                  <div style={{ fontSize: '11px', color: '#cbd5e1', marginBottom: '4px' }}>
                    Device: {cameraData.device || cameraData.physicalDeviceId} | Source: {cameraData.source}
                  </div>
                  <div style={{ fontSize: '11px', color: '#94a3b8', wordBreak: 'break-all' }}>
                    Frame SHA256: {cameraData.sha256 || cameraData.frameSha256}
                  </div>
                </div>
              )}

              {/* Window UI Automation Observation */}
              {windowEvidence && (
                <div style={{ marginTop: '12px', background: '#1e293b', padding: '12px', borderRadius: '6px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px', color: '#38bdf8', fontSize: '13px', fontWeight: 600 }}>
                    <Monitor size={16} /> Desktop Observation ({windowEvidence.value?.controlCount} UI Controls)
                  </div>
                  <div style={{ fontSize: '12px', color: '#cbd5e1', marginBottom: '4px' }}>
                    Window: <strong>{windowEvidence.value?.windowTitle}</strong> (Process: {windowEvidence.value?.process}, HWND: {windowEvidence.value?.hwnd})
                  </div>
                  {windowEvidence.value?.textPreview && (
                    <div style={{ fontSize: '11px', color: '#94a3b8', background: '#0b0f19', padding: '8px', borderRadius: '4px', maxHeight: '100px', overflowY: 'auto' }}>
                      {windowEvidence.value?.textPreview}
                    </div>
                  )}
                </div>
              )}

              {/* Raw Response Text if available */}
              {activeGoal.finalResponseText && (
                <div style={{ marginTop: '12px', padding: '10px', background: '#131b2e', borderRadius: '6px', fontSize: '13px', color: '#f1f5f9' }}>
                  <strong>Jarvis Answer:</strong> {activeGoal.finalResponseText}
                </div>
              )}
            </div>
          )}

          {/* User Observation Buttons (Section 24) */}
          <div style={{ borderTop: '1px solid #1e293b', paddingTop: '18px' }}>
            <div style={{ fontSize: '13px', fontWeight: 600, color: '#e2e8f0', marginBottom: '10px' }}>
              HUMAN OBSERVATION VERDICT:
            </div>
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
              <button
                disabled={actionLoading || activeTest.status === 'PASSED'}
                onClick={() => handleFeedback('CORRECT')}
                style={{
                  background: activeTest.status === 'PASSED' ? '#166534' : '#15803d',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '8px',
                  padding: '12px 24px',
                  fontWeight: 700,
                  fontSize: '14px',
                  cursor: activeTest.status === 'PASSED' ? 'default' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  opacity: actionLoading ? 0.6 : 1,
                }}
              >
                <CheckCircle2 size={18} /> REAL RESULT CORRECT
              </button>

              <button
                disabled={actionLoading}
                onClick={() => handleFeedback('WRONG')}
                style={{
                  background: '#b91c1c',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '8px',
                  padding: '12px 24px',
                  fontWeight: 700,
                  fontSize: '14px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  opacity: actionLoading ? 0.6 : 1,
                }}
              >
                <XCircle size={18} /> REAL RESULT WRONG
              </button>

              <input
                type="text"
                placeholder="Optional correction / feedback (e.g. 'Wrong window was foregrounded')..."
                value={feedbackNote}
                onChange={(e) => setFeedbackNote(e.target.value)}
                style={{
                  flex: 1,
                  minWidth: '260px',
                  background: '#0f172a',
                  border: '1px solid #334155',
                  color: '#fff',
                  padding: '12px 14px',
                  borderRadius: '8px',
                  fontSize: '13px',
                }}
              />
            </div>
            <div style={{ fontSize: '11px', color: '#64748b', marginTop: '8px' }}>
              Clicking <strong>REAL RESULT WRONG</strong> marks verification invalid and automatically moves GoalRun into <strong>RECOVERING</strong>.
            </div>
          </div>
        </div>
      )}

      {/* ─── Acceptance Sequence Checklist (Steps A - H) ─── */}
      <div style={{ background: '#131b2e', border: '1px solid #1e293b', borderRadius: '12px', padding: '20px', marginBottom: '28px' }}>
        <h3 style={{ fontSize: '16px', fontWeight: 700, margin: '0 0 16px 0', color: '#f1f5f9' }}>
          ACCEPTANCE TEST SEQUENCE (A – H)
        </h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {state?.tests.map((t) => {
            const isSelected = t.id === state.activeTestId;
            return (
              <div
                key={t.id}
                onClick={() => handleSelectTest(t.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '14px 18px',
                  background: isSelected ? 'rgba(37, 99, 235, 0.15)' : '#0f172a',
                  border: isSelected ? '1px solid #3b82f6' : '1px solid #1e293b',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                  <span style={{
                    width: '28px',
                    height: '28px',
                    borderRadius: '6px',
                    background: t.status === 'PASSED' ? '#166534' : '#1e293b',
                    color: t.status === 'PASSED' ? '#4ade80' : '#94a3b8',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 700,
                    fontSize: '13px'
                  }}>
                    {t.status === 'PASSED' ? '✓' : t.stepLetter}
                  </span>
                  <div>
                    <div style={{ fontSize: '14px', fontWeight: 600, color: isSelected ? '#38bdf8' : '#e2e8f0' }}>
                      {t.title}
                    </div>
                    <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>
                      {t.commandExample}
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <span style={{
                    background: t.status === 'PASSED' ? '#14532d' : t.status === 'RECOVERING' ? '#713f12' : '#1e293b',
                    color: t.status === 'PASSED' ? '#86efac' : t.status === 'RECOVERING' ? '#fde047' : '#94a3b8',
                    fontSize: '11px',
                    fontWeight: 700,
                    padding: '3px 8px',
                    borderRadius: '4px',
                    textTransform: 'uppercase'
                  }}>
                    {t.status}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ─── Persistent Capability Permissions Overview ─── */}
      <div style={{ background: '#131b2e', border: '1px solid #1e293b', borderRadius: '12px', padding: '20px' }}>
        <h3 style={{ fontSize: '16px', fontWeight: 700, margin: '0 0 12px 0', color: '#f1f5f9' }}>
          PERSISTENT CAPABILITY PERMISSION STORE (14 CAPABILITIES)
        </h3>
        <p style={{ color: '#94a3b8', fontSize: '13px', margin: '0 0 16px 0' }}>
          All capabilities persistently authorized by user profile and durably stored in SQLite across restarts.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '10px' }}>
          {state?.permissions && Object.entries(state.permissions).map(([cap, perm]) => (
            <div key={cap} style={{ background: '#0f172a', padding: '10px 14px', borderRadius: '6px', border: '1px solid #1e293b', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '12px', fontFamily: 'monospace', color: '#cbd5e1' }}>{cap}</span>
              <span style={{ fontSize: '11px', fontWeight: 700, color: perm === 'allowed' ? '#22c55e' : '#f87171', background: perm === 'allowed' ? '#052e16' : '#450a0a', padding: '2px 6px', borderRadius: '4px' }}>
                {perm}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default LiveAcceptancePage;
