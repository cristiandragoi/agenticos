import React, { useEffect, useRef, useState } from 'react';
import { API_BASE } from '../../api/client';
import { uiDiagnostics } from '../../diagnostics/uiSnapshot';
import { AlertTriangle, Save, Server, Loader2 } from 'lucide-react';


interface Props {
  agentId: string;
  onAssignmentChange?: (assignment: AgentProviderAssignment) => void;
  className?: string;
}

export interface AgentProviderAssignment {
  agentId: string;
  providerId: string;
  modelId: string | null;
  routingMode: 'automatic' | 'preferred' | 'forced';
  enabled: boolean;
}

export const AgentRuntimeSelector: React.FC<Props> = ({ agentId, onAssignmentChange, className = '' }) => {
  const [assignment, setAssignment] = useState<AgentProviderAssignment | null>(null);
  const [providers, setProviders] = useState<any[]>([]);
  const [models, setModels] = useState<any[]>([]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedMode, setSelectedMode] = useState<'automatic' | 'preferred' | 'forced'>('automatic');
  const [selectedProviderId, setSelectedProviderId] = useState<string>('');
  const [selectedModelId, setSelectedModelId] = useState<string>('');

  // Track whether user has made any deliberate selection change
  const [userTouched, setUserTouched] = useState(false);
  const [testingRouting, setTestingRouting] = useState(false);
  const [testResult, setTestResult] = useState<any>(null);

  /** TEST ROUTING (PRIORITY 2): tiny safe runtime request with the SAVED
   *  assignment — saving config alone is not proof execution uses it. */
  const handleTestRouting = async () => {
    if (testingRouting) return;
    setTestingRouting(true);
    setTestResult(null);
    try {
      const res = await fetch(`${API_BASE}/settings/agent-provider-assignments/${agentId}/test`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) setTestResult({ result: 'FAIL', reason: data?.error || `HTTP ${res.status}` });
      else setTestResult(data);
    } catch (err: any) {
      setTestResult({ result: 'FAIL', reason: err?.message || 'Request failed' });
    } finally {
      setTestingRouting(false);
    }
  };

  // Diagnostic: report the user-selected provider/model the selector renders.
  useEffect(() => {
    uiDiagnostics.setSelected(selectedProviderId || null, selectedModelId || null, 'agent-runtime-selector');
  }, [selectedProviderId, selectedModelId]);

  // Stale-request guard: cancel in-flight fetch on agentId change or unmount (handles StrictMode double-invoke)
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    // Cancel any previous in-flight request
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);
    setAssignment(null);
    setUserTouched(false);

    const fetchData = async () => {
      try {
        // Load assignment
        const assignRes = await fetch(
          `${API_BASE}/settings/agent-provider-assignments/${agentId}`,
          { signal: controller.signal }
        );

        if (assignRes.ok) {
          const currentAssignment: AgentProviderAssignment = await assignRes.json();
          setAssignment(currentAssignment);
          setSelectedMode(currentAssignment.routingMode);
          setSelectedProviderId(currentAssignment.providerId || '');
          setSelectedModelId(currentAssignment.modelId || '');
          if (onAssignmentChange) onAssignmentChange(currentAssignment);
        } else if (assignRes.status === 404) {
          // Not configured — expected state, not an error. Do not log.
          setAssignment(null);
          setSelectedMode('automatic');
          setSelectedProviderId('');
          setSelectedModelId('');
          if (onAssignmentChange) onAssignmentChange({
            agentId,
            providerId: '',
            modelId: null,
            routingMode: 'automatic',
            enabled: true
          });
        } else {
          // Non-404 HTTP failure — surface it visibly
          const text = await assignRes.text().catch(() => '');
          setError(`Failed to load assignment (HTTP ${assignRes.status})${text ? ': ' + text : ''}`);
        }

        // Load providers list (independent of assignment)
        const provRes = await fetch(`${API_BASE}/providers`, { signal: controller.signal });
        if (provRes.ok) {
          const provs = await provRes.json();
          setProviders(provs);
        }
      } catch (err: any) {
        if (err.name === 'AbortError') return; // stale request cancelled — do nothing
        setError(err.message || 'Failed to load configuration');
      } finally {
        // Only update loading state if this request is still current
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    };

    fetchData();

    return () => {
      controller.abort();
    };
  }, [agentId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!selectedProviderId || selectedMode === 'automatic') {
      setModels([]);
      if (selectedMode === 'automatic') {
        setSelectedModelId('');
      }
      return;
    }

    const controller = new AbortController();
    const fetchModels = async () => {
      try {
        const res = await fetch(`${API_BASE}/providers/${selectedProviderId}/models`, { signal: controller.signal });
        if (res.ok) {
          const data = await res.json();
          setModels(data.models || []);
        } else {
          setModels([]);
        }
      } catch (err: any) {
        if (err.name !== 'AbortError') {
          setModels([]); // fail silently — model list is non-critical
        }
      }
    };
    fetchModels();
    return () => controller.abort();
  }, [selectedProviderId, selectedMode]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const payload = {
        providerId: selectedProviderId || 'omniroot',
        modelId: selectedModelId || null,
        routingMode: selectedMode,
        enabled: true
      };

      const res = await fetch(`${API_BASE}/settings/agent-provider-assignments/${agentId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Failed to save assignment (HTTP ${res.status})${text ? ': ' + text : ''}`);
      }

      const updated = await res.json();
      setAssignment(updated);
      setUserTouched(false);
      if (onAssignmentChange) onAssignmentChange(updated);

    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className={`flex items-center gap-2 text-slate-400 text-sm ${className}`}>
        <Loader2 size={14} className="animate-spin" /> Loading config...
      </div>
    );
  }

  // Check if current configured model is missing from discovered list
  const isModelMissing = selectedMode !== 'automatic' && selectedModelId && models.length > 0 && !models.some(m => m.id === selectedModelId);

  // Dirty: show Save when user has made a deliberate change OR when creating a new non-automatic assignment
  const isNewAssignment = assignment === null;
  const isDirty = userTouched && (
    isNewAssignment
      ? (selectedMode !== 'automatic' && !!selectedProviderId)
      : (
          assignment?.routingMode !== selectedMode ||
          (assignment?.providerId || '') !== selectedProviderId ||
          (assignment?.modelId || '') !== selectedModelId
        )
  );

  return (
    <div className={`flex items-center gap-3 ${className} flex-wrap`}>
      <Server size={14} className="text-slate-400" />

      {isNewAssignment && !error && (
        <span className="text-xs text-slate-500 italic">Not configured &mdash;</span>
      )}

      <select
        value={selectedMode}
        onChange={e => { setSelectedMode(e.target.value as any); setUserTouched(true); }}
        className="bg-transparent text-slate-300 text-sm font-medium outline-none cursor-pointer border border-slate-700/50 rounded px-2 py-1 hover:border-slate-500 transition-colors"
      >
        <option value="automatic">Automatic Routing</option>
        <option value="preferred">Preferred Provider</option>
        <option value="forced">Forced Provider (No Fallback)</option>
      </select>

      {selectedMode !== 'automatic' && (
        <select
          value={selectedProviderId}
          onChange={e => { setSelectedProviderId(e.target.value); setUserTouched(true); }}
          className="bg-transparent text-slate-300 text-sm font-medium outline-none cursor-pointer border border-slate-700/50 hover:border-slate-500 rounded px-2 py-1 max-w-[150px] truncate transition-colors"
        >
          <option value="" disabled>Select Provider...</option>
          {providers.map(p => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      )}

      {selectedMode !== 'automatic' && selectedProviderId && (
        <select
          value={selectedModelId}
          onChange={e => { setSelectedModelId(e.target.value); setUserTouched(true); }}
          className={`bg-transparent text-sm font-medium outline-none cursor-pointer border hover:border-slate-500 rounded px-2 py-1 max-w-[180px] truncate transition-colors ${isModelMissing ? 'text-orange-400 border-orange-500/50' : 'text-slate-300 border-slate-700/50'}`}
        >
          <option value="" disabled>Select Model...</option>
          {isModelMissing && (
            <option value={selectedModelId} className="text-orange-400" disabled>
              Missing: {selectedModelId}
            </option>
          )}
          {models.map(m => (
            <option key={m.id} value={m.id}>{m.name || m.id}</option>
          ))}
        </select>
      )}

      {isDirty && (
        <button
          onClick={handleSave}
          disabled={saving || (selectedMode !== 'automatic' && (!selectedProviderId || !selectedModelId))}
          className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50 transition-colors"
        >
          {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
          Save
        </button>
      )}

      {!isDirty && (
        <button
          data-testid="test-routing-button"
          onClick={handleTestRouting}
          disabled={testingRouting || !selectedProviderId}
          className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 text-slate-200 disabled:opacity-50 transition-colors"
          title="Perform a tiny safe runtime request with the saved assignment to verify execution actually resolves where configured"
        >
          {testingRouting ? <Loader2 size={12} className="animate-spin" /> : <Server size={12} />}
          TEST ROUTING
        </button>
      )}

      {testResult && (
        <div data-testid="test-routing-result" className="flex flex-col gap-0.5 text-xs border border-slate-700 rounded p-2 mt-1 bg-slate-900/60" style={{ fontSize: 11 }}>
          <div>
            <span className="text-slate-400">Configured:</span>{' '}
            {testResult.configured?.provider || '(unset)'}{testResult.configured?.model ? ` / ${testResult.configured.model}` : ''}
          </div>
          <div>
            <span className="text-slate-400">Resolved:</span>{' '}
            {testResult.resolved ? `${testResult.resolved.provider || '(unset)'}${testResult.resolved.model ? ` / ${testResult.resolved.model}` : ''}` : '(none)'}
          </div>
          <div style={{ color: testResult.result === 'PASS' ? '#4ade80' : testResult.result === 'FALLBACK' ? '#f59e0b' : testResult.result === 'SKIPPED' ? '#94a3b8' : '#f87171' }}>
            Result: {testResult.result}
            {typeof testResult.latencyMs === 'number' ? ` · Latency: ${testResult.latencyMs}ms` : ''}
          </div>
          {testResult.reason && <div className="text-slate-500">Reason: {testResult.reason}</div>}
        </div>
      )}

      {error && <span className="text-red-400 text-xs" role="alert">{error}</span>}

      {isModelMissing && (
        <div className="flex items-center gap-1 text-orange-400 text-xs" title="The configured model was not found in the provider's model list. Please choose a replacement.">
          <AlertTriangle size={12} />
          Invalid Model
        </div>
      )}
    </div>
  );
};
