import React, { useState, useEffect } from 'react';
import { Settings2, ChevronDown, ChevronRight, Loader2, FolderGit2 } from 'lucide-react';
import { AgentRuntimeSelector } from '../agents/AgentRuntimeSelector';
import { apiFetch, apiUrl } from '../../api/client';

export interface RunSettingsValues {
  folderTree: string;
  workspacePath: string;
  baseUrl?: string;
  valProvider: string;
  approvalPolicy: string;
  routing?: {
    mode: 'automatic' | 'preferred' | 'forced';
    providerId: string;
    modelId: string | null;
  };
  executionProviderId?: string;
}

export function providerLabel(value: string): string {
  if (value === 'auto') return 'Automatic';
  if (value === 'ollama') return 'Ollama';
  if (value === 'omniRoute') return 'OmniRoute Cloud';
  return value || '—';
}

export function approvalLabel(value: string): string {
  if (value === 'auto') return 'Auto-approve safe actions';
  if (value === 'strict') return 'Require review';
  return value || '—';
}

function truncatePath(p: string, max = 48): string {
  if (!p) return '—';
  return p.length > max ? '…' + p.slice(-(max - 1)) : p;
}

interface Props {
  values: RunSettingsValues;
  onChange?: (patch: Partial<RunSettingsValues>) => void;
  /** Edit-mode workspace detection state */
  gitRoots?: string[];
  isDetecting?: boolean;
  workspaceError?: string | null;
  cwd?: string;
  /** Disable all inputs (e.g. while a run is active) */
  disabled?: boolean;
  defaultOpen?: boolean;
}

/**
 * Collapsible Run Settings section. Collapsed shows a compact one-line
 * summary (Repository · Execution · Validation · Approval). Editable
 * before a run starts; collapsed and read-only during an active run.
 */
export const RunSettings: React.FC<Props> = ({
  values, onChange, gitRoots = [], isDetecting = false, workspaceError = null, cwd = '',
  disabled = false, defaultOpen = false
}) => {
  const [open, setOpen] = useState(defaultOpen);
  const [providers, setProviders] = useState<any[]>([]);
  const [catalogError, setCatalogError] = useState(false);
  const editable = !disabled && !!onChange;

  useEffect(() => {
    apiFetch('/api/providers')
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const body = await response.json();
        const providers = Array.isArray(body)
          ? body
          : Array.isArray(body.providers)
            ? body.providers
            : [];
        setProviders(providers.filter((provider: any) => provider.kind === 'llm' && provider.status === 'connected'));
      })
      .catch(err => {
        console.error('Failed to load providers:', err);
        setCatalogError(true);
      });
  }, []);

  const inputCls = "w-full bg-[#1e1e1e] border border-[#333333] text-[#cccccc] text-[12px] p-2 focus:outline-none focus:border-emerald-500 h-[34px] disabled:opacity-60 disabled:cursor-not-allowed";
  const labelCls = "block text-[10px] font-bold text-[#858585] uppercase tracking-widest mb-1.5";

  const renderRoutingSummary = () => {
    if (!values.routing) return <span className="text-[#888]">Loading...</span>;
    const { mode, providerId, modelId } = values.routing;
    
    // Fallback logic matches user's rules
    const fallbackStatus = mode === 'forced' ? 'Disabled' : 'Enabled';
    
    return (
      <span className="flex items-center flex-wrap gap-x-2 gap-y-1">
        <span className="text-[#858585]">Planning Provider:</span> {providerId || 'None'}
        <span className="text-[#555]">·</span>
        <span className="text-[#858585]">Execution Provider:</span> {values.executionProviderId || 'auto'}
        <span className="text-[#555]">·</span>
        <span className="text-[#858585]">Planning Model:</span> {modelId || 'Default'}
        <span className="text-[#555]">·</span>
        <span className="text-[#858585]">Routing Mode:</span> <span className="capitalize">{mode}</span>
        <span className="text-[#555]">·</span>
        <span className="text-[#858585]">Validation Provider:</span> {providerLabel(values.valProvider)}
        <span className="text-[#555]">·</span>
        <span className="text-[#858585]">Fallback:</span> <span className={fallbackStatus === 'Enabled' ? 'text-emerald-400' : 'text-amber-400'}>{fallbackStatus}</span>
      </span>
    );
  };

  return (
    <div className="bg-[#252526] border border-[#333333] rounded-md" data-testid="codex-run-settings">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-[#2d2d2d] transition-colors rounded-md"
      >
        {open ? <ChevronDown size={14} className="text-[#858585]" /> : <ChevronRight size={14} className="text-[#858585]" />}
        <Settings2 size={13} className="text-[#858585]" />
        <span className="text-[11px] font-bold text-[#858585] uppercase tracking-widest shrink-0">Run Settings</span>
        {!open && (
          <span className="text-[12px] text-[#cccccc] ml-2 flex items-center">
            {renderRoutingSummary()}
          </span>
        )}
      </button>

      {open && (
        <div className="px-3 pb-3 pt-1 grid grid-cols-2 md:grid-cols-5 gap-3 border-t border-[#333333]">
          <div className="col-span-2 md:col-span-1">
            <label className={labelCls}>Selected Folder Tree</label>
            <input
              type="text"
              value={values.folderTree}
              onChange={e => onChange?.({ folderTree: e.target.value })}
              disabled={!editable}
              className={`${inputCls} font-mono`}
              placeholder={cwd || 'Enter path…'}
            />
          </div>
          <div className="col-span-2 md:col-span-1">
            <label className={labelCls}>Repository Root</label>
            {isDetecting ? (
              <div className={`${inputCls} font-mono flex items-center gap-2 text-[#858585]`}>
                <Loader2 size={12} className="animate-spin" /> Detecting…
              </div>
            ) : gitRoots.length === 0 ? (
              <input
                type="text"
                value={values.workspacePath}
                onChange={e => onChange?.({ workspacePath: e.target.value })}
                disabled={!editable}
                className={`${inputCls} font-mono ${workspaceError ? 'border-[#552222] text-[#ff8888]' : ''}`}
                placeholder={workspaceError || 'No repo detected'}
              />
            ) : gitRoots.length === 1 ? (
              <div className={`${inputCls} font-mono truncate text-[#88ffaa] border-[#225533] bg-[#1a2e22]`} title={gitRoots[0]}>
                {gitRoots[0]}
              </div>
            ) : (
              <select
                value={values.workspacePath}
                onChange={e => onChange?.({ workspacePath: e.target.value })}
                disabled={!editable}
                className={`${inputCls} font-mono`}
              >
                {gitRoots.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            )}
          </div>
          <div className="col-span-2 md:col-span-2">
            <label className={labelCls}>Planning Runtime</label>
            <div className={disabled ? 'opacity-60 pointer-events-none' : ''}>
              <AgentRuntimeSelector 
                agentId="agent-codex" 
                onAssignmentChange={(assignment) => {
                  if (onChange) {
                    onChange({
                      routing: {
                        mode: assignment.routingMode,
                        providerId: assignment.providerId,
                        modelId: assignment.modelId
                      }
                    });
                  }
                }}
              />
            </div>
          </div>
          <div>
            <label className={labelCls}>Execution Provider</label>
            <select
              value={values.executionProviderId || 'auto'}
              onChange={e => onChange?.({ executionProviderId: e.target.value })}
              disabled={!editable}
              className={inputCls}
            >
              <option value="auto">Automatic — choose a capable execution provider</option>
              <option value="none">Plan Only — no tool execution</option>
              {catalogError ? (
                <option value="" disabled>Provider catalog unavailable</option>
              ) : (
                providers.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))
              )}
            </select>
          </div>
          <div>
            <label className={labelCls}>Validation Provider</label>
            <select
              value={values.valProvider}
              onChange={e => onChange?.({ valProvider: e.target.value })}
              disabled={!editable}
              className={inputCls}
            >
              <option value="auto">Automatic (Execution Provider)</option>
              <option value="omniRoute">OmniRoute (Cloud)</option>
              <option value="ollama">Ollama (Local)</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>Approval Policy</label>
            <select
              value={values.approvalPolicy}
              onChange={e => onChange?.({ approvalPolicy: e.target.value })}
              disabled={!editable}
              className={inputCls}
            >
              <option value="auto">Auto-Approve Safe</option>
              <option value="strict">Require Review</option>
            </select>
          </div>
        </div>
      )}
    </div>
  );
};
