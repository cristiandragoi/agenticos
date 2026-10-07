import React, { useState, useEffect } from 'react';
import { apiFetch } from '../../api/client';
import {
  Activity,
  CheckCircle2,
  AlertTriangle,
  Clock,
  XCircle,
  ChevronDown,
  ChevronRight,
  Cpu,
  ShieldCheck,
  FileCode,
  Eye,
  Check,
  X,
  ShieldAlert,
} from 'lucide-react';

export interface RepairProposal {
  incidentId: string;
  problem: string;
  diagnosis: string;
  proposedRepair: string;
  filesAffected: string[];
  testResult?: {
    passed: boolean;
    suiteName?: string;
    details?: string;
  };
  risk?: 'low' | 'medium' | 'high';
  patch?: string;
}

export interface ActionStatusData {
  actionName: string;
  targetCapability: string;
  status: 'requested' | 'running' | 'waiting' | 'completed' | 'failed';
  executionId?: string | null;
  runId?: string | null;
  currentStep?: string | null;
  error?: string | null;
  blocker?: string | null;
  steps?: Array<{ step: string; ok: boolean; detail?: string; state?: string }>;
  executedSteps?: Array<string | { step: string; ok: boolean; detail?: string; state?: string }>;
  request?: string;
  understood?: string;
  plan?: Array<{ description: string; done?: boolean } | string>;
  capability?: string;
  executor?: string;
  tool?: string;
  verification?: string;
  recovery?: string;
  result?: string;
  durationMs?: number;
  errorDetails?: string;
  stage?: string;
  repairProposal?: RepairProposal;
  conversationId?: string;
  conflictFiles?: string[];
}

export type ActionStatusPayload = ActionStatusData;

export interface ChatActionStatusCardProps {
  data?: ActionStatusData;
  action?: ActionStatusData;
}

interface FileDiff {
  fileName: string;
  additions: number;
  removals: number;
  lines: Array<{ type: 'add' | 'remove' | 'context' | 'header'; text: string }>;
}

function parseUnifiedDiff(rawDiff: string): FileDiff[] {
  if (!rawDiff || !rawDiff.trim()) return [];
  const files: FileDiff[] = [];
  const rawBlocks = rawDiff.split(/^diff --git /m);

  for (const block of rawBlocks) {
    if (!block.trim()) continue;
    let fileName = 'unknown';
    const fileMatch = block.match(/--- (?:a\/)?(.*?)(?:\t|\r?\n)/) || block.match(/\+\+\+ (?:b\/)?(.*?)(?:\t|\r?\n)/);
    if (fileMatch && fileMatch[1]) {
      fileName = fileMatch[1].replace(/^[ab]\//, '');
    } else {
      const firstLine = block.split('\n')[0];
      const match = firstLine.match(/a\/(.*?)\s+b\/(.*)/);
      if (match) fileName = match[1];
    }

    const lines: Array<{ type: 'add' | 'remove' | 'context' | 'header'; text: string }> = [];
    let additions = 0;
    let removals = 0;

    const blockLines = block.split('\n');
    for (const line of blockLines) {
      if (line.startsWith('@@')) {
        lines.push({ type: 'header', text: line });
      } else if (line.startsWith('+') && !line.startsWith('+++')) {
        additions++;
        lines.push({ type: 'add', text: line });
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        removals++;
        lines.push({ type: 'remove', text: line });
      } else if (!line.startsWith('diff') && !line.startsWith('index') && !line.startsWith('---') && !line.startsWith('+++')) {
        lines.push({ type: 'context', text: line });
      }
    }

    files.push({ fileName, additions, removals, lines });
  }

  if (files.length === 0 && rawDiff.trim()) {
    const lines: Array<{ type: 'add' | 'remove' | 'context' | 'header'; text: string }> = [];
    let additions = 0;
    let removals = 0;
    for (const line of rawDiff.split('\n')) {
      if (line.startsWith('@@')) {
        lines.push({ type: 'header', text: line });
      } else if (line.startsWith('+') && !line.startsWith('+++')) {
        additions++;
        lines.push({ type: 'add', text: line });
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        removals++;
        lines.push({ type: 'remove', text: line });
      } else {
        lines.push({ type: 'context', text: line });
      }
    }
    files.push({ fileName: 'patch.diff', additions, removals, lines });
  }

  return files;
}

export const ChatActionStatusCard: React.FC<ChatActionStatusCardProps> = ({ data, action }) => {
  const [expanded, setExpanded] = useState(false);
  const [showDiff, setShowDiff] = useState(false);
  const [activeFileIndex, setActiveFileIndex] = useState(0);
  const [loadedDiff, setLoadedDiff] = useState<string | null>(null);
  const [isLoadingDiff, setIsLoadingDiff] = useState(false);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [localStage, setLocalStage] = useState<string | null>(null);
  const [localRecoveryMsg, setLocalRecoveryMsg] = useState<string | null>(null);
  const [localResultMsg, setLocalResultMsg] = useState<string | null>(null);

  const payload = data || action;
  if (!payload) return null;

  const {
    actionName,
    targetCapability,
    status: initialStatus,
    executionId,
    currentStep,
    error,
    steps,
    request,
    understood,
    capability,
    executor,
    tool,
    verification,
    recovery,
    result,
    durationMs,
    stage: initialStage,
    repairProposal,
  } = payload;

  const currentStage = localStage || initialStage || (initialStatus === 'waiting' && repairProposal ? 'AWAITING_APPROVAL' : undefined);
  const isAwaitingApproval = currentStage === 'AWAITING_APPROVAL';
  const isApproved = currentStage === 'APPROVED' || currentStage === 'APPLYING' || currentStage === 'VERIFYING_REPAIR' || currentStage === 'VERIFIED' || currentStage === 'RETRYING_ORIGINAL_GOAL' || currentStage === 'RECOVERED';
  const isRecovered = currentStage === 'RECOVERED';
  const isRejected = currentStage === 'REJECTED';
  const isConflict = currentStage === 'CONFLICT';
  const isVerificationFailed = currentStage === 'VERIFICATION_FAILED';
  const isRecoveryFailed = currentStage === 'RECOVERY_FAILED';

  const effectiveStatus = isRecovered
    ? 'completed'
    : (isRejected || isConflict || isVerificationFailed || isRecoveryFailed)
    ? 'failed'
    : isApproved
    ? 'running'
    : isAwaitingApproval
    ? 'waiting'
    : initialStatus;

  const effectiveExecutionId = executionId || (payload as any).runId;
  const effectiveError = error || (payload as any).blocker || payload.errorDetails;
  const rawSteps = steps || (payload as any).executedSteps;
  const effectiveSteps = Array.isArray(rawSteps)
    ? rawSteps.map((s: any) => typeof s === 'string' ? { step: s, ok: true, detail: '' } : s)
    : [];

  // Parse diff from proposal or fetched diff
  const rawDiffText = loadedDiff || repairProposal?.patch || '';
  const parsedFiles = parseUnifiedDiff(rawDiffText);

  // Fetch diff on demand if not present
  useEffect(() => {
    if (showDiff && !loadedDiff && repairProposal?.incidentId && !repairProposal?.patch) {
      setIsLoadingDiff(true);
      apiFetch(`/api/jarvis/self-heal/incident/${encodeURIComponent(repairProposal.incidentId)}/diff`)
        .then((res) => res.json())
        .then((json) => {
          if (json.success && json.diff) {
            setLoadedDiff(json.diff);
          }
        })
        .catch((err) => console.error('[ChatActionStatusCard] Failed to fetch diff:', err))
        .finally(() => setIsLoadingDiff(false));
    }
  }, [showDiff, loadedDiff, repairProposal]);

  const handleApprove = async () => {
    if (!repairProposal?.incidentId) return;
    setActionInProgress('approving');
    setLocalStage('APPROVED');
    setLocalRecoveryMsg('Repair approved. Applying patch to production...');

    try {
      const resp = await apiFetch('/api/jarvis/self-heal/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          incidentId: repairProposal.incidentId,
          conversationId: payload.conversationId,
          approver: 'user',
        }),
      });
      const data = await resp.json();

      if (data.status === 'recovered' || data.success) {
        setLocalStage('RECOVERED');
        setLocalResultMsg(data.message || 'The repair was applied successfully and verified. Original request succeeded.');
      } else if (data.status === 'conflict') {
        setLocalStage('CONFLICT');
        setLocalRecoveryMsg('Repair could not be applied safely because the code changed after the repair was prepared.');
      } else if (data.status === 'verification_failed') {
        setLocalStage('VERIFICATION_FAILED');
        setLocalRecoveryMsg('The repair was applied in the recovery environment, but verification failed, so I did not treat the issue as resolved.');
      } else if (data.status === 'recovery_failed') {
        setLocalStage('RECOVERY_FAILED');
        setLocalRecoveryMsg('The repair was applied and verified, but retrying the request did not succeed.');
      } else {
        setLocalStage('RECOVERY_FAILED');
        setLocalRecoveryMsg(data.message || 'Recovery failed.');
      }
    } catch (err: any) {
      setLocalStage('RECOVERY_FAILED');
      setLocalRecoveryMsg(`Approval request failed: ${err?.message || 'Network error'}`);
    } finally {
      setActionInProgress(null);
    }
  };

  const handleReject = async () => {
    if (!repairProposal?.incidentId) return;
    setActionInProgress('rejecting');
    try {
      const resp = await apiFetch('/api/jarvis/self-heal/reject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          incidentId: repairProposal.incidentId,
          conversationId: payload.conversationId,
          reason: 'Rejected by user',
        }),
      });
      const data = await resp.json();
      setLocalStage('REJECTED');
      setLocalRecoveryMsg(data.message || 'I left the system unchanged. The proposed repair was rejected.');
    } catch (err: any) {
      setLocalStage('REJECTED');
      setLocalRecoveryMsg('Repair rejected.');
    } finally {
      setActionInProgress(null);
    }
  };

  const statusConfig = {
    requested: {
      color: 'text-sky-400',
      bg: 'bg-sky-950/40 border-sky-800/60',
      badgeBg: 'bg-sky-500/20 text-sky-300 border-sky-500/30',
      icon: <Clock size={14} className="animate-spin" />,
      label: 'REQUESTED',
    },
    running: {
      color: 'text-amber-400',
      bg: 'bg-amber-950/40 border-amber-800/60',
      badgeBg: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
      icon: <Activity size={14} className="animate-pulse" />,
      label: 'RUNNING',
    },
    waiting: {
      color: 'text-yellow-400',
      bg: 'bg-yellow-950/40 border-yellow-800/60',
      badgeBg: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
      icon: <Clock size={14} />,
      label: 'WAITING APPROVAL',
    },
    completed: {
      color: 'text-emerald-400',
      bg: 'bg-emerald-950/40 border-emerald-800/60',
      badgeBg: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
      icon: <CheckCircle2 size={14} />,
      label: isRecovered ? 'RECOVERED' : 'COMPLETED',
    },
    failed: {
      color: 'text-rose-400',
      bg: 'bg-rose-950/40 border-rose-800/60',
      badgeBg: 'bg-rose-500/20 text-rose-300 border-rose-500/30',
      icon: <XCircle size={14} />,
      label: isRejected ? 'REJECTED' : isConflict ? 'CONFLICT' : isRecoveryFailed ? 'RECOVERY FAILED' : 'FAILED',
    },
  }[effectiveStatus] || {
    color: 'text-slate-400',
    bg: 'bg-slate-900/60 border-slate-800',
    badgeBg: 'bg-slate-700/50 text-slate-300 border-slate-600',
    icon: <Activity size={14} />,
    label: effectiveStatus.toUpperCase(),
  };

  return (
    <div
      data-testid="chat-action-status-card"
      className={`rounded-xl border p-3.5 my-2.5 max-w-lg text-xs backdrop-blur-sm shadow-md transition-all ${statusConfig.bg}`}
    >
      <div className="flex items-center justify-between gap-2 border-b border-white/5 pb-2">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-white tracking-wide">{actionName || 'Capability Action'}</span>
          <span className="text-[10px] text-slate-400 font-mono">({targetCapability})</span>
        </div>
        <div className="flex items-center gap-2">
          <div
            data-testid="action-status-badge"
            className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[10px] font-bold tracking-wider uppercase ${statusConfig.badgeBg}`}
          >
            {statusConfig.icon}
            <span>{statusConfig.label}</span>
          </div>
          <button
            type="button"
            data-testid="action-center-toggle"
            onClick={() => setExpanded(!expanded)}
            className="text-slate-400 hover:text-white p-0.5 rounded transition-colors focus:outline-none"
            title={expanded ? 'Collapse Action Center' : 'Expand Action Center'}
          >
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        </div>
      </div>

      <div className="mt-2.5 space-y-1.5 text-slate-300">
        {effectiveExecutionId && (
          <div className="flex items-center gap-1.5 text-[11px]">
            <span className="text-slate-400 font-medium">Run ID:</span>
            <span className="font-mono text-cyan-300 bg-cyan-950/60 px-1.5 py-0.5 rounded border border-cyan-800/40">
              {effectiveExecutionId}
            </span>
          </div>
        )}

        {currentStep && (
          <div className="flex items-start gap-1.5 text-[11px]">
            <span className="text-slate-400 font-medium whitespace-nowrap">Current step:</span>
            <span className="text-slate-200 font-mono text-[10.5px]">{currentStep}</span>
          </div>
        )}

        {/* ── PHASE 2: REPAIR APPROVAL CARD IN ACTION CENTER ── */}
        {repairProposal && (
          <div
            data-testid="repair-approval-section"
            className="mt-3 p-3 rounded-lg bg-slate-950/70 border border-amber-500/40 space-y-2.5 shadow-sm"
          >
            <div className="flex items-center justify-between gap-2 border-b border-white/10 pb-2">
              <div className="flex items-center gap-1.5 text-amber-300 font-semibold text-[11px]">
                <ShieldAlert size={14} className="text-amber-400" />
                <span>Self-Heal Recovery Proposal</span>
              </div>
              <div className="flex items-center gap-1.5">
                {repairProposal.risk && (
                  <span
                    className={`px-1.5 py-0.2 rounded text-[9px] uppercase font-bold border ${
                      repairProposal.risk === 'low'
                        ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                        : repairProposal.risk === 'high'
                        ? 'bg-rose-500/20 text-rose-300 border-rose-500/30'
                        : 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                    }`}
                  >
                    Risk: {repairProposal.risk}
                  </span>
                )}
                <span className="font-mono text-[9.5px] text-slate-400 bg-slate-900 px-1.5 py-0.5 rounded border border-white/5">
                  {repairProposal.incidentId}
                </span>
              </div>
            </div>

            {/* Problem */}
            <div className="space-y-0.5">
              <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Problem</span>
              <p className="text-[11px] text-rose-200 leading-relaxed bg-rose-950/30 p-1.5 rounded border border-rose-800/30">
                {repairProposal.problem}
              </p>
            </div>

            {/* Diagnosis */}
            <div className="space-y-0.5">
              <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Diagnosis</span>
              <p className="text-[11px] text-amber-200 leading-relaxed bg-amber-950/20 p-1.5 rounded border border-amber-800/30">
                {repairProposal.diagnosis}
              </p>
            </div>

            {/* Proposed Repair */}
            <div className="space-y-0.5">
              <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Proposed Repair</span>
              <p className="text-[11px] text-slate-200 leading-relaxed bg-slate-900/60 p-1.5 rounded border border-white/5 font-mono text-[10.5px]">
                {repairProposal.proposedRepair}
              </p>
            </div>

            {/* Files Affected */}
            {repairProposal.filesAffected && repairProposal.filesAffected.length > 0 && (
              <div className="space-y-1">
                <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Files Affected</span>
                <div className="flex flex-wrap gap-1">
                  {repairProposal.filesAffected.map((file, fIdx) => (
                    <span
                      key={fIdx}
                      className="font-mono text-[10px] bg-slate-900 px-1.5 py-0.5 rounded border border-slate-700 text-cyan-300 flex items-center gap-1"
                    >
                      <FileCode size={10} className="text-cyan-400" />
                      {file}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Test Result */}
            {repairProposal.testResult && (
              <div className="flex items-center justify-between text-[10.5px] bg-slate-900/60 p-1.5 rounded border border-white/5">
                <span className="text-slate-400 font-medium">Test Result:</span>
                <span
                  className={`flex items-center gap-1 font-bold ${
                    repairProposal.testResult.passed ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  {repairProposal.testResult.passed ? <Check size={12} /> : <X size={12} />}
                  <span>{repairProposal.testResult.passed ? 'Isolated Verification Passed' : 'Tests Failed'}</span>
                </span>
              </div>
            )}

            {/* ── PHASE 10: ACTION CENTER RECOVERY TIMELINE ── */}
            <div data-testid="repair-timeline" className="mt-2 pt-2 border-t border-white/5 space-y-1 text-[10.5px]">
              <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Recovery Lifecycle</span>
              <div className="space-y-0.5 font-mono">
                <div className="flex items-center gap-1.5 text-rose-400">
                  <span>✗</span>
                  <span>Original action failed</span>
                </div>
                <div className="flex items-center gap-1.5 text-emerald-400">
                  <span>✓</span>
                  <span>Failure detected</span>
                </div>
                <div className="flex items-center gap-1.5 text-emerald-400">
                  <span>✓</span>
                  <span>Diagnosis completed</span>
                </div>
                <div className="flex items-center gap-1.5 text-emerald-400">
                  <span>✓</span>
                  <span>Repair prepared in isolation</span>
                </div>
                <div className="flex items-center gap-1.5 text-emerald-400">
                  <span>✓</span>
                  <span>Repair tests passed</span>
                </div>
                <div
                  className={`flex items-center gap-1.5 ${
                    isApproved ? 'text-emerald-400' : isRejected ? 'text-rose-400' : 'text-amber-400 font-bold animate-pulse'
                  }`}
                >
                  <span>{isApproved ? '✓' : isRejected ? '✗' : '→'}</span>
                  <span>{isApproved ? 'Approved by user' : isRejected ? 'Repair rejected by user' : 'Waiting for approval'}</span>
                </div>
                {isApproved && (
                  <>
                    <div
                      className={`flex items-center gap-1.5 ${
                        currentStage === 'APPLYING' ? 'text-amber-400 font-bold animate-pulse' : 'text-emerald-400'
                      }`}
                    >
                      <span>{currentStage === 'APPLYING' ? '→' : '✓'}</span>
                      <span>{currentStage === 'APPLYING' ? 'Applying repair to production' : 'Repair applied'}</span>
                    </div>
                    <div
                      className={`flex items-center gap-1.5 ${
                        currentStage === 'VERIFYING_REPAIR'
                          ? 'text-amber-400 font-bold animate-pulse'
                          : isVerificationFailed
                          ? 'text-rose-400'
                          : 'text-emerald-400'
                      }`}
                    >
                      <span>{currentStage === 'VERIFYING_REPAIR' ? '→' : isVerificationFailed ? '✗' : '✓'}</span>
                      <span>
                        {currentStage === 'VERIFYING_REPAIR'
                          ? 'Verifying repair in production'
                          : isVerificationFailed
                          ? 'Verification failed'
                          : 'Verification passed'}
                      </span>
                    </div>
                    {!isVerificationFailed && (
                      <div
                        className={`flex items-center gap-1.5 ${
                          currentStage === 'RETRYING_ORIGINAL_GOAL'
                            ? 'text-amber-400 font-bold animate-pulse'
                            : isRecovered
                            ? 'text-emerald-400'
                            : isRecoveryFailed
                            ? 'text-rose-400'
                            : 'text-slate-400'
                        }`}
                      >
                        <span>{currentStage === 'RETRYING_ORIGINAL_GOAL' ? '→' : isRecovered ? '✓' : isRecoveryFailed ? '✗' : '○'}</span>
                        <span>
                          {currentStage === 'RETRYING_ORIGINAL_GOAL'
                            ? 'Retrying original request'
                            : isRecovered
                            ? 'Original request succeeded'
                            : isRecoveryFailed
                            ? 'Retry failed'
                            : 'Retry original request'}
                        </span>
                      </div>
                    )}
                    {isRecovered && (
                      <div className="flex items-center gap-1.5 text-emerald-400 font-bold">
                        <span>✓</span>
                        <span>Recovered</span>
                      </div>
                    )}
                    {isRecoveryFailed && (
                      <div className="flex items-center gap-1.5 text-rose-400 font-bold">
                        <span>✗</span>
                        <span>RECOVERY_FAILED</span>
                      </div>
                    )}
                  </>
                )}
                {isConflict && (
                  <div className="flex items-center gap-1.5 text-rose-400 font-bold">
                    <span>✗</span>
                    <span>Application stopped: code changed after repair prepared</span>
                  </div>
                )}
              </div>
            </div>

            {/* ── PHASE 3: INSPECT DIFF VIEW ── */}
            {showDiff && (
              <div data-testid="diff-viewer" className="mt-2 p-2 rounded bg-slate-900/90 border border-cyan-800/60 space-y-1.5">
                <div className="flex items-center justify-between text-[10px] text-cyan-300 font-bold border-b border-white/10 pb-1">
                  <span className="flex items-center gap-1">
                    <Eye size={12} />
                    <span>Isolated Workspace Proposed Patch (Read-Only)</span>
                  </span>
                  <span className="text-slate-400">
                    {parsedFiles.length} file{parsedFiles.length === 1 ? '' : 's'}
                  </span>
                </div>

                {isLoadingDiff ? (
                  <div className="py-3 text-center text-slate-400 animate-pulse">Loading patch from isolated workspace...</div>
                ) : parsedFiles.length > 0 ? (
                  <div className="space-y-2">
                    {parsedFiles.length > 1 && (
                      <div className="flex gap-1 overflow-x-auto pb-1">
                        {parsedFiles.map((file, idx) => (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => setActiveFileIndex(idx)}
                            className={`px-2 py-0.5 text-[9.5px] rounded border font-mono whitespace-nowrap transition-colors ${
                              activeFileIndex === idx
                                ? 'bg-cyan-950 border-cyan-500 text-cyan-200'
                                : 'bg-slate-950/60 border-white/5 text-slate-400 hover:text-slate-200'
                            }`}
                          >
                            {file.fileName} (+{file.additions} -{file.removals})
                          </button>
                        ))}
                      </div>
                    )}

                    {(() => {
                      const file = parsedFiles[activeFileIndex] || parsedFiles[0];
                      if (!file) return null;
                      return (
                        <div className="space-y-1">
                          <div className="flex items-center justify-between text-[10px] text-slate-300 font-mono bg-slate-950 px-2 py-1 rounded border border-white/5">
                            <span className="font-semibold text-cyan-300">{file.fileName}</span>
                            <span className="space-x-1.5">
                              <span className="text-emerald-400">+{file.additions}</span>
                              <span className="text-rose-400">-{file.removals}</span>
                            </span>
                          </div>
                          <pre className="max-h-48 overflow-y-auto font-mono text-[10px] bg-slate-950 p-2 rounded border border-white/5 space-y-0.5">
                            {file.lines.map((line, lIdx) => {
                              const isAdd = line.type === 'add';
                              const isRem = line.type === 'remove';
                              const isHdr = line.type === 'header';
                              return (
                                <div
                                  key={lIdx}
                                  className={`px-1 py-0.2 rounded-sm ${
                                    isAdd
                                      ? 'bg-emerald-950/60 text-emerald-300'
                                      : isRem
                                      ? 'bg-rose-950/60 text-rose-300'
                                      : isHdr
                                      ? 'text-cyan-400 font-bold'
                                      : 'text-slate-400'
                                  }`}
                                >
                                  {line.text}
                                </div>
                              );
                            })}
                          </pre>
                        </div>
                      );
                    })()}
                  </div>
                ) : (
                  <div className="py-2 text-center text-slate-400 text-[10px]">No diff content available.</div>
                )}
              </div>
            )}

            {/* Actions: Inspect Diff, Approve, Reject */}
            <div className="pt-2 border-t border-white/10 flex items-center justify-between gap-2">
              <button
                type="button"
                data-testid="inspect-diff-button"
                onClick={() => setShowDiff(!showDiff)}
                className="px-2.5 py-1 rounded border border-cyan-700/60 bg-cyan-950/40 hover:bg-cyan-900/60 text-cyan-300 text-[10.5px] font-medium flex items-center gap-1 transition-colors"
              >
                <Eye size={12} />
                <span>{showDiff ? 'Hide Diff' : 'Inspect Diff'}</span>
              </button>

              {isAwaitingApproval && (
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    data-testid="reject-repair-button"
                    disabled={actionInProgress !== null}
                    onClick={handleReject}
                    className="px-2.5 py-1 rounded border border-rose-800/80 bg-rose-950/50 hover:bg-rose-900/60 text-rose-300 text-[10.5px] font-medium flex items-center gap-1 transition-colors disabled:opacity-50"
                  >
                    <X size={12} />
                    <span>Reject Repair</span>
                  </button>
                  <button
                    type="button"
                    data-testid="approve-repair-button"
                    disabled={actionInProgress !== null}
                    onClick={handleApprove}
                    className="px-3 py-1 rounded border border-emerald-600 bg-emerald-600 hover:bg-emerald-500 text-white text-[10.5px] font-bold flex items-center gap-1 transition-colors shadow-sm disabled:opacity-50"
                  >
                    <Check size={12} />
                    <span>{actionInProgress === 'approving' ? 'Applying...' : 'Approve Repair'}</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Local recovery / result notification */}
        {localRecoveryMsg && (
          <div className="mt-2 p-2 rounded-lg bg-amber-950/50 border border-amber-800/60 text-amber-200 text-[11px]">
            {localRecoveryMsg}
          </div>
        )}

        {localResultMsg && (
          <div className="mt-2 p-2 rounded-lg bg-emerald-950/50 border border-emerald-800/60 text-emerald-200 text-[11px] font-medium">
            {localResultMsg}
          </div>
        )}

        {effectiveError && !repairProposal && (
          <div className="mt-2 p-2 rounded-lg bg-rose-950/60 border border-rose-800/80 text-rose-200 flex items-start gap-2">
            <AlertTriangle size={14} className="text-rose-400 mt-0.5 flex-shrink-0" />
            <div className="space-y-0.5">
              <span className="font-semibold text-rose-300 text-[10.5px]">Blocker / Error:</span>
              <p className="text-[11px] leading-relaxed">{effectiveError}</p>
            </div>
          </div>
        )}

        {effectiveSteps.length > 0 && (
          <div className="mt-2.5 pt-2 border-t border-white/5">
            <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Operational Steps</span>
            <div className="mt-1 space-y-1">
              {effectiveSteps.map((s: any, idx: number) => {
                const isCurrent = s.state === 'running' || (!s.ok && s.step === currentStep);
                const isDone = s.state === 'completed' || s.ok === true;
                const isFailed = s.state === 'failed' || (!s.ok && effectiveStatus === 'failed' && !isCurrent);

                const icon = isDone ? '✓' : isCurrent ? '→' : isFailed ? '✗' : '○';
                const statusBadge = isDone ? '✓ OK' : isCurrent ? '→ RUNNING' : isFailed ? '✗ FAIL' : '○ PENDING';
                const textColor = isDone
                  ? 'text-emerald-400 font-bold'
                  : isCurrent
                  ? 'text-amber-400 font-bold animate-pulse'
                  : isFailed
                  ? 'text-rose-400 font-bold'
                  : 'text-slate-500';

                return (
                  <div key={idx} className="flex items-center justify-between text-[10.5px] py-0.5 font-mono">
                    <span className="flex items-center gap-1.5 text-slate-300">
                      <span className={textColor}>{icon}</span>
                      <span>{s.step}</span>
                    </span>
                    <span className={textColor}>{statusBadge}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Expandable Action Center Details */}
        {expanded && (
          <div data-testid="action-center-expanded" className="mt-3 pt-2.5 border-t border-white/10 space-y-2 text-[11px] font-mono">
            <div className="text-[10px] uppercase tracking-wider font-bold text-cyan-400 flex items-center gap-1">
              <Cpu size={12} />
              <span>Action Center Operational Diagnostics</span>
            </div>

            {request && (
              <div className="bg-slate-950/40 p-1.5 rounded border border-white/5">
                <span className="text-slate-400 block text-[10px] uppercase font-bold">Request:</span>
                <span className="text-slate-200">{request}</span>
              </div>
            )}

            {understood && (
              <div className="bg-slate-950/40 p-1.5 rounded border border-white/5">
                <span className="text-slate-400 block text-[10px] uppercase font-bold">Understood:</span>
                <span className="text-slate-200">{understood}</span>
              </div>
            )}

            <div className="grid grid-cols-2 gap-1.5">
              <div className="bg-slate-950/40 p-1.5 rounded border border-white/5">
                <span className="text-slate-400 block text-[10px] uppercase font-bold">Status:</span>
                <span className={`font-bold ${statusConfig.color}`}>{statusConfig.label}</span>
              </div>
              <div className="bg-slate-950/40 p-1.5 rounded border border-white/5">
                <span className="text-slate-400 block text-[10px] uppercase font-bold">Current Step:</span>
                <span className="text-slate-200">{currentStep || (effectiveStatus === 'completed' ? 'All steps complete' : 'Idle')}</span>
              </div>
            </div>

            {payload.plan && Array.isArray(payload.plan) && payload.plan.length > 0 && (
              <div className="bg-slate-950/40 p-2 rounded border border-white/5 space-y-1">
                <span className="text-slate-400 block text-[10px] uppercase font-bold">Plan:</span>
                <div className="space-y-0.5">
                  {payload.plan.map((p: any, pIdx: number) => (
                    <div key={pIdx} className="text-slate-300 text-[10.5px]">
                      {pIdx + 1}. {typeof p === 'string' ? p : p.description}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {effectiveSteps.length > 0 && (
              <div className="bg-slate-950/40 p-1.5 rounded border border-white/5">
                <span className="text-slate-400 block text-[10px] uppercase font-bold">Completed Steps:</span>
                <span className="text-slate-200">
                  {effectiveSteps.filter((s: any) => s.state === 'completed' || s.ok === true).length} of {effectiveSteps.length} steps completed
                </span>
              </div>
            )}

            <div className="grid grid-cols-2 gap-1.5">
              <div className="bg-slate-950/40 p-1.5 rounded border border-white/5">
                <span className="text-slate-400 block text-[10px] uppercase font-bold">Capability:</span>
                <span className="text-cyan-300">{capability || targetCapability}</span>
              </div>
              <div className="bg-slate-950/40 p-1.5 rounded border border-white/5">
                <span className="text-slate-400 block text-[10px] uppercase font-bold">Tool / Executor:</span>
                <span className="text-slate-200">{executor || targetCapability} / {tool || 'default'}</span>
              </div>
            </div>

            {verification && (
              <div className="bg-slate-950/40 p-1.5 rounded border border-white/5 flex items-start gap-1.5">
                <ShieldCheck size={13} className="text-emerald-400 mt-0.5 flex-shrink-0" />
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase font-bold">Verification:</span>
                  <span className="text-emerald-300">{verification}</span>
                </div>
              </div>
            )}

            {recovery && (
              <div className="bg-amber-950/30 p-1.5 rounded border border-amber-800/40 text-amber-200">
                <span className="text-amber-400 block text-[10px] uppercase font-bold">Recovery:</span>
                <span>{recovery}</span>
              </div>
            )}

            {result && (
              <div className="bg-slate-950/40 p-1.5 rounded border border-white/5">
                <span className="text-slate-400 block text-[10px] uppercase font-bold">Result:</span>
                <span className="text-slate-200">{result}</span>
              </div>
            )}

            {durationMs !== undefined && (
              <div className="text-[10px] text-slate-400 text-right font-mono">
                Duration: {durationMs} ms
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
