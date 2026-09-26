import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useJarvisRuntime } from '../context/JarvisRuntimeContext';
import {
  TrendingUp, ShieldCheck, DollarSign, Target, Clock, AlertTriangle,
  RefreshCw, CheckCircle2, Package, Building2, Layers, Activity,
  Lock, Check, X, ChevronRight, GitBranch, Eye, ArrowRight, Play,
  Sparkles, Award, Cpu, AlertCircle, FileText, CheckCircle
} from 'lucide-react';
import { revenueOperatorClient } from '../api/revenueOperatorClient';
import { useProjects } from '../store/projectStore';
import type {
  RevenueMission, RevenueExperiment, RevenueLedgerEntry, RevenueHumanGate,
  RevenueMissionTrace, RevenueKpiBreakdown, RevenueKpiKey, RevenueBoard,
  RevenueBoardCard, RevenueLiveExecutionRow, RevenueGateQueueItem,
  RevenueExperimentTrace, RevenueOpportunity
} from '../api/revenueOperatorClient';

type Tab = 'portfolio' | 'opportunities' | 'mission' | 'overview' | 'digital_products' | 'german_sme' | 'pipeline' | 'ledger' | 'gates';

const fmtEur = (v: number | null | undefined): string => `€${(v ?? 0).toFixed(2)}`;
const fmtDate = (iso: string | null | undefined): string =>
  iso ? iso.slice(0, 19).replace('T', ' ') : '—';

function StatusBadge({ status }: { status: string }) {
  const s = String(status || '').toUpperCase();
  const tone =
    ['RUNNING', 'PUBLISHING', 'LIVE', 'SCALING', 'CONVERTED'].includes(s) ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30' :
    ['QUEUED', 'DISCOVERED', 'VALIDATING', 'APPROVED', 'EVALUATED'].includes(s) ? 'bg-slate-700/60 text-slate-300 border-slate-600/50' :
    ['COMPLETED', 'WON', 'VERIFIED_COMPLETE', 'PASS'].includes(s) ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' :
    ['FAILED', 'KILLED', 'LOST', 'BLOCKED', 'REJECTED'].includes(s) ? 'bg-rose-500/20 text-rose-300 border-rose-500/30' :
    ['VERIFIED', 'RESOLVED', 'SHORTLISTED'].includes(s) ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
    'bg-indigo-500/10 text-indigo-300 border-indigo-500/20';
  return <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border whitespace-nowrap ${tone}`}>{s}</span>;
}

function fmtElapsed(ms: number | null): string {
  if (ms == null) return '—';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

// ── Opportunity Detail Modal ────────────────────────────────────────────────
const OpportunityModal: React.FC<{
  opportunity: RevenueOpportunity;
  onClose: () => void;
  onConvert: (opp: RevenueOpportunity) => Promise<void>;
  converting: boolean;
}> = ({ opportunity, onClose, onConvert, converting }) => {
  const b = opportunity.scoreBreakdown;
  const isSeed = opportunity.source === 'sample_seed' || String(opportunity.notes || '').includes('SAMPLE/SEED');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="bg-[#12151c] border border-slate-700 rounded-2xl w-[780px] max-w-full max-h-[90vh] overflow-y-auto shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
        data-testid="opportunity-modal"
      >
        {/* Header */}
        <div className="p-6 border-b border-slate-800 flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
              <StatusBadge status={opportunity.status} />
              <span className="px-2 py-0.5 rounded bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 text-[10px] font-semibold uppercase">
                {opportunity.category.replace(/_/g, ' ')}
              </span>
              <span className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase border ${
                isSeed ? 'bg-amber-500/10 border-amber-500/30 text-amber-300' : 'bg-cyan-500/10 border-cyan-500/30 text-cyan-300'
              }`}>
                {isSeed ? 'SAMPLE/SEED DATA' : 'LIVE DISCOVERED'}
              </span>
            </div>
            <h2 className="text-lg font-bold text-white leading-snug">{opportunity.title}</h2>
            {opportunity.sourceUrl && (
              <a href={opportunity.sourceUrl} target="_blank" rel="noreferrer" className="text-xs text-cyan-400 hover:underline mt-1 inline-block">
                {opportunity.sourceUrl}
              </a>
            )}
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white p-1 rounded hover:bg-slate-800">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-6 flex-1 text-xs">
          {/* Description */}
          {opportunity.description && (
            <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 text-slate-300 leading-relaxed">
              {opportunity.description}
            </div>
          )}

          {/* Deterministic Score Card */}
          <div className="bg-[#151922] border border-slate-800 rounded-xl p-5" data-testid="score-breakdown-card">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Award size={18} className="text-amber-400" />
                <h3 className="text-sm font-bold text-white uppercase tracking-wider">Deterministic Revenue Score</h3>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-2xl font-extrabold text-emerald-400">{opportunity.score}</span>
                <span className="text-slate-500 font-bold">/ 100</span>
              </div>
            </div>

            {b ? (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <div className="bg-slate-900/80 border border-slate-800/80 rounded-lg p-2.5">
                  <div className="text-[10px] text-slate-400">Revenue Potential</div>
                  <div className="text-sm font-bold text-emerald-400 mt-1">+{b.revenuePotentialPts} <span className="text-[9px] text-slate-500 font-normal">/ 25</span></div>
                </div>
                <div className="bg-slate-900/80 border border-slate-800/80 rounded-lg p-2.5">
                  <div className="text-[10px] text-slate-400">Time to Revenue</div>
                  <div className="text-sm font-bold text-cyan-400 mt-1">+{b.timeToRevenuePts} <span className="text-[9px] text-slate-500 font-normal">/ 20</span></div>
                </div>
                <div className="bg-slate-900/80 border border-slate-800/80 rounded-lg p-2.5">
                  <div className="text-[10px] text-slate-400">Automation Potential</div>
                  <div className="text-sm font-bold text-indigo-400 mt-1">+{b.automationPotentialPts} <span className="text-[9px] text-slate-500 font-normal">/ 20</span></div>
                </div>
                <div className="bg-slate-900/80 border border-slate-800/80 rounded-lg p-2.5">
                  <div className="text-[10px] text-slate-400">Low Capital Req.</div>
                  <div className="text-sm font-bold text-teal-400 mt-1">+{b.lowCapitalPts} <span className="text-[9px] text-slate-500 font-normal">/ 15</span></div>
                </div>
                <div className="bg-slate-900/80 border border-slate-800/80 rounded-lg p-2.5">
                  <div className="text-[10px] text-slate-400">Confidence</div>
                  <div className="text-sm font-bold text-sky-400 mt-1">+{b.confidencePts} <span className="text-[9px] text-slate-500 font-normal">/ 10</span></div>
                </div>
                <div className="bg-slate-900/80 border border-slate-800/80 rounded-lg p-2.5">
                  <div className="text-[10px] text-slate-400">Manual Workload</div>
                  <div className="text-sm font-bold text-rose-400 mt-1">-{b.manualWorkloadPenalty} <span className="text-[9px] text-slate-500 font-normal">penalty</span></div>
                </div>
                <div className="bg-slate-900/80 border border-slate-800/80 rounded-lg p-2.5 col-span-2">
                  <div className="text-[10px] text-slate-400">Risk / Difficulty</div>
                  <div className="text-sm font-bold text-rose-400 mt-1">-{b.riskPenalty} <span className="text-[9px] text-slate-500 font-normal">penalty</span></div>
                </div>
              </div>
            ) : (
              <pre className="bg-slate-950 p-3 rounded text-slate-300 font-mono text-[11px] whitespace-pre-wrap">
                {opportunity.scoreExplanation}
              </pre>
            )}
          </div>

          {/* Key Metrics Grid */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-3.5">
              <span className="text-[10px] text-slate-400 uppercase font-semibold">Est. Revenue</span>
              <div className="text-base font-bold text-emerald-400 mt-1">€{opportunity.estimatedRevenue.toLocaleString()}</div>
            </div>
            <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-3.5">
              <span className="text-[10px] text-slate-400 uppercase font-semibold">Required Capital</span>
              <div className="text-base font-bold text-slate-200 mt-1">€{opportunity.estimatedCost.toLocaleString()}</div>
            </div>
            <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-3.5">
              <span className="text-[10px] text-slate-400 uppercase font-semibold">Time to First Revenue</span>
              <div className="text-base font-bold text-cyan-300 mt-1">{opportunity.estimatedTimeToRevenueDays} days</div>
            </div>
          </div>

          {/* Evidence & Assumptions */}
          <div className="space-y-3">
            <h4 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
              <FileText size={14} className="text-indigo-400" /> Evidence & Notes
            </h4>
            <div className="bg-slate-900/40 border border-slate-800/80 rounded-xl p-4 space-y-2">
              {opportunity.notes && (
                <div className="text-slate-300 font-medium">{opportunity.notes}</div>
              )}
              {opportunity.evidence && opportunity.evidence.length > 0 ? (
                <ul className="list-disc list-inside space-y-1 text-slate-400">
                  {opportunity.evidence.map((ev: any, idx: number) => (
                    <li key={idx}>
                      <strong className="text-slate-300">{ev.type || 'Fact'}:</strong> {ev.detail || JSON.stringify(ev)}
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="text-slate-500 italic">No additional evidence items attached.</div>
              )}
            </div>
          </div>

          {/* Recommended Next Action */}
          <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-4 flex items-start gap-3">
            <Sparkles size={18} className="text-emerald-400 shrink-0 mt-0.5" />
            <div>
              <div className="text-xs font-bold text-emerald-300">Recommended Agentic Execution Strategy</div>
              <p className="text-[11px] text-emerald-200/80 mt-1 leading-relaxed">
                Convert into a Revenue Mission to trigger Hermes for task decomposition, CodeX for technical delivery/automation, and Argus for deliverable verification. Budget limit is strictly capped at €{opportunity.estimatedCost}.
              </p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-5 border-t border-slate-800 bg-[#0e1117] flex items-center justify-between">
          <button onClick={onClose} className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-semibold">
            Close
          </button>
          {opportunity.status === 'CONVERTED' ? (
            <div className="flex items-center gap-2 text-cyan-400 font-semibold text-xs">
              <CheckCircle size={16} /> Converted to Active Mission
            </div>
          ) : (
            <button
              onClick={() => onConvert(opportunity)}
              disabled={converting}
              data-testid="convert-opportunity-btn"
              className="flex items-center gap-2 px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-colors cursor-pointer shadow-md disabled:opacity-50"
            >
              {converting ? <RefreshCw size={14} className="animate-spin" /> : <Play size={14} fill="currentColor" />}
              CONVERT TO REVENUE MISSION
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

// ── Opportunity Pipeline Tab ────────────────────────────────────────────────
const OpportunityPipelineView: React.FC<{
  opportunities: RevenueOpportunity[];
  onSelectOpportunity: (opp: RevenueOpportunity) => void;
  onSeed: () => Promise<void>;
  seeding: boolean;
}> = ({ opportunities, onSelectOpportunity, onSeed, seeding }) => {
  const [selectedCategory, setSelectedCategory] = useState<string>('all');

  const categories = [
    { key: 'all', label: 'All Opportunities' },
    { key: 'freelance_contract', label: 'Freelance AI Contracts' },
    { key: 'sme_ai_automation', label: 'SME Automation' },
    { key: 'utility_apps', label: 'Utility Applications' },
    { key: 'digital_products', label: 'Digital Products' },
    { key: 'lead_generation', label: 'Lead Generation' },
  ];

  const filtered = selectedCategory === 'all'
    ? opportunities
    : opportunities.filter((o) => o.category === selectedCategory);

  return (
    <div className="space-y-6" data-testid="opportunity-pipeline-view">
      {/* Header Bar */}
      <div className="flex items-center justify-between flex-wrap gap-4 bg-[#151921] border border-slate-800 rounded-xl p-4">
        <div>
          <h2 className="text-sm font-bold text-white flex items-center gap-2">
            <TrendingUp size={16} className="text-emerald-400" /> Commercial Opportunity Pipeline
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Ranked deterministically by expected revenue, turnaround speed, automation potential, and low capital requirement.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onSeed}
            disabled={seeding}
            data-testid="seed-opportunities-btn"
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-indigo-600/80 hover:bg-indigo-500 text-white text-xs font-semibold transition-colors disabled:opacity-50"
          >
            {seeding ? <RefreshCw size={13} className="animate-spin" /> : <Sparkles size={13} />} Seed Sample Dataset
          </button>
        </div>
      </div>

      {/* Category Pills */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {categories.map((c) => (
          <button
            key={c.key}
            onClick={() => setSelectedCategory(c.key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors border ${
              selectedCategory === c.key
                ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      {/* Opportunities List */}
      <div className="space-y-3">
        {filtered.map((opp, idx) => {
          const isSeed = opp.source === 'sample_seed' || String(opp.notes || '').includes('SAMPLE/SEED');
          const isHigh = opp.score >= 75;

          return (
            <div
              key={opp.id}
              onClick={() => onSelectOpportunity(opp)}
              data-testid={`opportunity-card-${opp.id}`}
              className="bg-[#151921] border border-slate-800 hover:border-slate-600 rounded-xl p-5 transition-all cursor-pointer flex flex-col md:flex-row md:items-center justify-between gap-5 shadow-sm hover:shadow-md"
            >
              {/* Left Column: Rank, Title, Metadata */}
              <div className="flex items-start gap-4 flex-1">
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center font-extrabold text-sm shrink-0 border ${
                  idx === 0 ? 'bg-amber-500/20 border-amber-500/40 text-amber-300' :
                  idx === 1 ? 'bg-slate-700/40 border-slate-600 text-slate-200' :
                  idx === 2 ? 'bg-amber-800/20 border-amber-700/30 text-amber-400' :
                  'bg-slate-800 border-slate-700 text-slate-400'
                }`}>
                  #{idx + 1}
                </div>
                <div className="space-y-1.5 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <StatusBadge status={opp.status} />
                    <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-300 uppercase font-semibold">
                      {opp.category.replace(/_/g, ' ')}
                    </span>
                    <span className={`text-[10px] px-2 py-0.5 rounded border uppercase font-medium ${
                      isSeed ? 'bg-amber-500/10 border-amber-500/20 text-amber-300' : 'bg-cyan-500/10 border-cyan-500/20 text-cyan-300'
                    }`}>
                      {isSeed ? 'Sample Seed' : 'Live'}
                    </span>
                  </div>
                  <h3 className="text-sm font-bold text-white leading-snug">{opp.title}</h3>
                  <p className="text-xs text-slate-400 line-clamp-2">{opp.description}</p>
                </div>
              </div>

              {/* Right Column: Score & Metrics */}
              <div className="flex items-center gap-6 shrink-0 pt-3 md:pt-0 border-t md:border-t-0 border-slate-800/80">
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div className="bg-slate-900/60 border border-slate-800/80 rounded-lg px-3 py-1.5">
                    <div className="text-[9px] text-slate-400 uppercase font-semibold">Est. Rev</div>
                    <div className="text-xs font-bold text-emerald-400 mt-0.5">€{opp.estimatedRevenue}</div>
                  </div>
                  <div className="bg-slate-900/60 border border-slate-800/80 rounded-lg px-3 py-1.5">
                    <div className="text-[9px] text-slate-400 uppercase font-semibold">Time</div>
                    <div className="text-xs font-bold text-cyan-300 mt-0.5">{opp.estimatedTimeToRevenueDays}d</div>
                  </div>
                  <div className="bg-slate-900/60 border border-slate-800/80 rounded-lg px-3 py-1.5">
                    <div className="text-[9px] text-slate-400 uppercase font-semibold">Automation</div>
                    <div className="text-xs font-bold text-indigo-300 mt-0.5">{opp.automationPotential}%</div>
                  </div>
                </div>

                {/* Score Pill */}
                <div className="flex flex-col items-end min-w-[70px]">
                  <div className={`text-lg font-black ${isHigh ? 'text-emerald-400' : 'text-slate-300'}`}>
                    {opp.score} <span className="text-[10px] text-slate-500 font-bold">/100</span>
                  </div>
                  <span className="text-[9px] text-slate-500 font-medium">Deterministic</span>
                </div>

                <ChevronRight size={16} className="text-slate-600" />
              </div>
            </div>
          );
        })}

        {filtered.length === 0 && (
          <div className="bg-[#151921] border border-slate-800 rounded-xl p-10 text-center text-slate-500">
            No opportunities found in this category. Click <strong>Seed Sample Dataset</strong> to populate.
          </div>
        )}
      </div>
    </div>
  );
};

// ── Mission View Tab ────────────────────────────────────────────────────────
const MissionView: React.FC<{
  mission: RevenueMission | null;
  convertedMissionData?: any;
}> = ({ mission, convertedMissionData }) => {
  const steps = convertedMissionData?.steps || [
    {
      id: 'step-1',
      title: 'Decompose and Plan Operational Milestones',
      assignedAgent: 'hermes',
      status: 'completed',
      output: 'Commercial opportunity analyzed. Step-by-step deliverable pipeline decomposed.'
    },
    {
      id: 'step-2',
      title: 'Build Automation and Delivery Artifacts',
      assignedAgent: 'codex',
      status: 'in_progress',
      output: 'Automation scripts and delivery packages generated for target client.'
    },
    {
      id: 'step-3',
      title: 'Approval Gate: Outbound Outreach / Spending Verification',
      assignedAgent: 'jarvis',
      status: 'waiting_for_approval',
      output: 'Budget limit verified. Awaiting user approval before live execution.'
    },
    {
      id: 'step-4',
      title: 'Deliverable Verification & Revenue Reconciliation',
      assignedAgent: 'argus',
      status: 'pending',
      output: 'Awaiting completion of delivery and customer transaction settlement.'
    }
  ];

  return (
    <div className="space-y-6" data-testid="revenue-mission-view">
      {/* Mission Header */}
      <div className="bg-[#151921] border border-slate-800 rounded-xl p-6">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2.5">
            <Target size={20} className="text-emerald-400" />
            <h2 className="text-base font-bold text-white">{mission?.title || 'Active Revenue Mission'}</h2>
          </div>
          <StatusBadge status={mission?.status || 'active'} />
        </div>
        <p className="text-xs text-slate-300 leading-relaxed max-w-3xl whitespace-pre-wrap">
          {mission?.description || 'Autonomous mission targeting verifiable revenue generation with €0 unapproved spend.'}
        </p>

        {/* Financial Metrics */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5 pt-5 border-t border-slate-800/80">
          <div className="bg-slate-900/60 border border-slate-800 rounded-lg p-3">
            <span className="text-[10px] text-slate-400 uppercase font-semibold">Target Revenue</span>
            <div className="text-base font-bold text-emerald-400 mt-1">€{mission?.targetAmount ?? 0}</div>
          </div>
          <div className="bg-slate-900/60 border border-slate-800 rounded-lg p-3">
            <span className="text-[10px] text-slate-400 uppercase font-semibold">Budget Limit</span>
            <div className="text-base font-bold text-slate-200 mt-1">€{mission?.advertisingBudget ?? 0}</div>
          </div>
          <div className="bg-slate-900/60 border border-slate-800 rounded-lg p-3">
            <span className="text-[10px] text-slate-400 uppercase font-semibold">Realized Revenue</span>
            <div className="text-base font-bold text-amber-400 mt-1">€{mission?.realizedRevenue ?? 0}</div>
          </div>
          <div className="bg-slate-900/60 border border-slate-800 rounded-lg p-3">
            <span className="text-[10px] text-slate-400 uppercase font-semibold">Verified Revenue</span>
            <div className="text-base font-bold text-teal-300 mt-1">€{mission?.verifiedRevenue ?? 0}</div>
          </div>
        </div>
      </div>

      {/* Agent Orchestration & Step Chain */}
      <div className="bg-[#151921] border border-slate-800 rounded-xl p-6">
        <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
          <Cpu size={16} className="text-indigo-400" /> Multi-Agent Execution Chain
        </h3>

        <div className="space-y-3">
          {steps.map((step: any, idx: number) => {
            const agentColors: Record<string, string> = {
              jarvis: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
              hermes: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
              codex: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
              argus: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30',
            };

            return (
              <div
                key={step.id || idx}
                className="bg-slate-900/70 border border-slate-800/80 rounded-xl p-4 flex items-start justify-between gap-4"
              >
                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-xs font-bold text-slate-400 shrink-0 mt-0.5">
                    {idx + 1}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-white">{step.title}</span>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-mono uppercase font-bold border ${agentColors[step.assignedAgent] || 'bg-slate-800 text-slate-300 border-slate-700'}`}>
                        {step.assignedAgent}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1 leading-normal">{step.output}</p>
                  </div>
                </div>
                <StatusBadge status={step.status} />
              </div>
            );
          })}
        </div>
      </div>

      {/* Safety & Approval Boundaries */}
      <div className="bg-[#151921] border border-slate-800 rounded-xl p-6">
        <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
          <ShieldCheck size={16} className="text-emerald-400" /> Safety & Approval Boundaries
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-slate-300">
          <div className="bg-slate-900/60 border border-slate-800 rounded-lg p-3.5 space-y-1.5">
            <span className="font-bold text-emerald-300 flex items-center gap-1.5">
              <CheckCircle2 size={13} /> Autonomous Actions Permitted
            </span>
            <p className="text-slate-400 text-[11px]">
              Market research, opportunity scoring, artifact drafting, local code generation, data parsing, internal testing.
            </p>
          </div>
          <div className="bg-slate-900/60 border border-slate-800 rounded-lg p-3.5 space-y-1.5">
            <span className="font-bold text-amber-300 flex items-center gap-1.5">
              <Lock size={13} /> Strict Approval Gates
            </span>
            <p className="text-slate-400 text-[11px]">
              Financial spending (&gt; €0), external messaging/outreach, domain/API purchases, contract acceptance, external account creation.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

// ── Kanban Board Component ──────────────────────────────────────────────────
const KanbanBoard: React.FC<{
  board: RevenueBoard;
  accent: string;
  onCardClick: (card: RevenueBoardCard) => void;
}> = ({ board, accent, onCardClick }) => (
  <div className="flex gap-3 overflow-x-auto pb-4" data-testid={`kanban-${board.engine}`}>
    {board.columns.map((col) => {
      const cards = board.cards[col.key] || [];
      return (
        <div key={col.key} className="min-w-[220px] w-[220px] shrink-0">
          <div className="flex items-center justify-between mb-2 px-1">
            <span className={`text-[10px] font-bold tracking-wider ${accent}`}>{col.label}</span>
            <span className="text-[10px] text-slate-500 font-mono">{cards.length}</span>
          </div>
          <div className="space-y-2">
            {cards.length === 0 && (
              <div className="rounded-lg border border-dashed border-slate-800 p-3 text-center text-[10px] text-slate-600">
                empty
              </div>
            )}
            {cards.map((card) => (
              <button
                key={card.id}
                onClick={() => onCardClick(card)}
                className="w-full text-left bg-[#151921] border border-slate-800 hover:border-slate-600 rounded-lg p-3 transition-colors cursor-pointer"
                data-testid={`card-${card.id}`}
              >
                <div className="flex items-center justify-between mb-1.5 gap-1">
                  <StatusBadge status={card.status} />
                  <span className="text-[10px] font-bold text-white whitespace-nowrap">{fmtEur(card.value)}</span>
                </div>
                <div className="text-xs font-semibold text-white leading-snug line-clamp-2">{card.title}</div>
                {card.company && <div className="text-[10px] text-slate-400 mt-0.5">{card.company}</div>}
                <div className="mt-2 pt-2 border-t border-slate-800/70 flex items-center justify-between text-[10px] text-slate-400">
                  <span>{card.nextAction ? `next: ${card.nextAction}` : 'terminal'}</span>
                  <span className="text-slate-500">{card.source}</span>
                </div>
                {card.humanGate && (
                  <div className="mt-1.5 flex items-center gap-1 text-[10px] text-amber-300">
                    <Lock size={10} /> {card.humanGate.gateType}
                  </div>
                )}
                <div className="mt-1 text-[9px] text-slate-500">ARGUS: {card.argusState}</div>
              </button>
            ))}
          </div>
        </div>
      );
    })}
  </div>
);

// ── Main Page ───────────────────────────────────────────────────────────────
const RevenueOperatorPage: React.FC = () => {
  const [mission, setMission] = useState<RevenueMission | null>(null);
  const [missionTrace, setMissionTrace] = useState<RevenueMissionTrace | null>(null);
  const [opportunities, setOpportunities] = useState<RevenueOpportunity[]>([]);
  const [selectedOpp, setSelectedOpp] = useState<RevenueOpportunity | null>(null);
  const [convertingOpp, setConvertingOpp] = useState(false);
  const [seedingOpps, setSeedingOpps] = useState(false);
  const [convertedMissionData, setConvertedMissionData] = useState<any>(null);

  const [boards, setBoards] = useState<Record<string, RevenueBoard | null>>({ digital_products: null, german_sme: null, pipeline: null });
  const [liveRows, setLiveRows] = useState<RevenueLiveExecutionRow[]>([]);
  const [liveNote, setLiveNote] = useState<string | null>(null);
  const [gateItems, setGateItems] = useState<RevenueGateQueueItem[]>([]);
  const [ledger, setLedger] = useState<RevenueLedgerEntry[]>([]);
  const [experiments, setExperiments] = useState<RevenueExperiment[]>([]);
  const [activeTab, setActiveTab] = useState<Tab>('portfolio');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [kpiModal, setKpiModal] = useState<{ kpi: RevenueKpiKey; title: string; data: RevenueKpiBreakdown } | null>(null);
  const [drawer, setDrawer] = useState<RevenueExperimentTrace | null>(null);
  const [resolvingGateId, setResolvingGateId] = useState<string | null>(null);
  const [ledgerFilter, setLedgerFilter] = useState<string>('all');
  const [supervisorState, setSupervisorState] = useState<any>(null);
  const [briefingModal, setBriefingModal] = useState<any>(null);

  const { projects, activeProjectId, setActiveProject, refresh: refreshProjects } = useProjects();

  const sortedProjects = [...projects].sort((a, b) => {
    const pA = a.priority ?? 999;
    const pB = b.priority ?? 999;
    if (pA !== pB) return pA - pB;
    return new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime();
  });

  const primaryActiveProject = sortedProjects.find(p => p.priority === 1 || p.revenueVertical === 'free_cash') || sortedProjects[0];

  const [searchParams] = useSearchParams();
  const { setWorkspaceContext } = useJarvisRuntime();

  // Handle deep-link parameters: /revenue-operator?opportunity=opp-xxx or ?tab=yyy
  useEffect(() => {
    const oppId = searchParams.get('opportunity');
    const tabParam = searchParams.get('tab') as Tab | null;
    if (tabParam && ['portfolio', 'opportunities', 'mission', 'overview', 'digital_products', 'german_sme', 'pipeline', 'ledger', 'gates'].includes(tabParam)) {
      setActiveTab(tabParam);
    }
    if (oppId && opportunities.length > 0) {
      setActiveTab('opportunities');
      const found = opportunities.find(o => o.id === oppId || o.id.startsWith(oppId) || oppId.startsWith(o.id));
      if (found) {
        setSelectedOpp(found);
      }
    }
  }, [searchParams, opportunities]);

  // Sync available local entities into Jarvis runtime context
  useEffect(() => {
    if (opportunities.length > 0) {
      setWorkspaceContext(prev => ({
        ...prev,
        activeModule: 'revenue-operator',
        activeRoute: '/revenue-operator',
        activeMissionId: mission?.id || null,
        activeEntityId: selectedOpp?.id || null,
        activeEntityType: selectedOpp ? 'opportunity' : null,
        availableLocalEntities: opportunities.map(o => ({
          entityType: 'opportunity',
          entityId: o.id,
          displayName: o.title,
          aliases: [
            o.title,
            ...(o.category === 'digital_products' ? ['template', 'workflow template'] : []),
            ...(/notion/i.test(o.title) ? ['notion template', 'notion agentic template', 'notion workflow template', 'the notion template', 'notion and agentic workflow template'] : [])
          ]
        }))
      }));
    }
  }, [opportunities, mission, selectedOpp, setWorkspaceContext]);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      refreshProjects();

      const [oppsList, missionsList] = await Promise.all([
        revenueOperatorClient.listOpportunities().catch(() => []),
        revenueOperatorClient.listMissions().catch(() => []),
      ]);

      setOpportunities(oppsList);

      let activeMission = missionsList.find((m) => m.status === 'active') || missionsList[0];
      if (!activeMission) {
        const today = new Date();
        const deadline = new Date(today.getTime() + 30 * 86400000);
        activeMission = await revenueOperatorClient.createMission({
          title: 'Autonomous Revenue Generation — Phase 1',
          description: '€300 target within 30 days using Digital Products and German SME AI Automation with €0 advertising budget.',
          targetAmount: 300, currency: 'EUR',
          startDate: today.toISOString().split('T')[0],
          deadline: deadline.toISOString().split('T')[0],
          advertisingBudget: 0,
          enabledEngines: ['digital_products', 'german_sme'],
          availableChannels: ['SHOPIFY', 'DIRECT_OUTREACH'],
          primaryMarket: 'DE/EU',
        });
      }
      setMission(activeMission);

      const [trace, dpBoard, smeBoard, pipeBoard, live, gatesQ, ledgerList, expList, supStatus] = await Promise.all([
        revenueOperatorClient.traceMission(activeMission.id),
        revenueOperatorClient.board(activeMission.id, 'digital_products'),
        revenueOperatorClient.board(activeMission.id, 'german_sme'),
        revenueOperatorClient.board(activeMission.id, 'pipeline'),
        revenueOperatorClient.liveExecution(activeMission.id).catch(() => ({ rows: [] as RevenueLiveExecutionRow[], note: 'live-execution unavailable' })),
        revenueOperatorClient.gateQueue(),
        revenueOperatorClient.listLedger(activeMission.id),
        revenueOperatorClient.listExperiments(activeMission.id),
        revenueOperatorClient.getSupervisorStatus().catch(() => null),
      ]);

      setMissionTrace(trace);
      setBoards({ digital_products: dpBoard, german_sme: smeBoard, pipeline: pipeBoard });
      setLiveRows(live.rows || []);
      setLiveNote(live.note || null);
      setGateItems(gatesQ);
      setLedger(ledgerList);
      setExperiments(expList);
      setSupervisorState(supStatus);
    } catch (err: any) {
      console.error('Failed to load Revenue Operator data:', err);
      setError(err?.message || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const handleSeedOpportunities = async () => {
    try {
      setSeedingOpps(true);
      const seeded = await revenueOperatorClient.seedOpportunities();
      setOpportunities(seeded);
    } catch (err: any) {
      setError(`Failed to seed opportunities: ${err.message}`);
    } finally {
      setSeedingOpps(false);
    }
  };

  const handleConvertOpportunity = async (opp: RevenueOpportunity) => {
    try {
      setConvertingOpp(true);
      const res = await revenueOperatorClient.convertOpportunityToMission(opp.id);
      setConvertedMissionData(res.mission);
      setMission(res.mission);
      setSelectedOpp(null);
      await loadData();
      setActiveTab('mission');
    } catch (err: any) {
      setError(`Failed to convert opportunity to mission: ${err.message}`);
    } finally {
      setConvertingOpp(false);
    }
  };

  const openGates = gateItems.filter((g) => g.status === 'open');
  const dpBoard = boards.digital_products;
  const smeBoard = boards.german_sme;
  const pipeBoard = boards.pipeline;
  const filteredLedger = ledgerFilter === 'all' ? ledger : ledger.filter((l) => l.entryType === ledgerFilter);
  const k = missionTrace?.kpis;

  const kpiCard = (
    label: string, icon: React.ReactNode, value: string, sub: string, accent: string, kpi: RevenueKpiKey, testId: string,
  ) => (
    <button
      onClick={async () => {
        if (!mission) return;
        try {
          const data = await revenueOperatorClient.kpiBreakdown(mission.id, kpi);
          setKpiModal({ kpi, title: label, data });
        } catch (err: any) {
          setError(`KPI drill-down failed: ${err?.message}`);
        }
      }}
      className="bg-[#151921] border border-slate-800 hover:border-slate-600 rounded-xl p-3.5 flex flex-col justify-between text-left transition-colors cursor-pointer"
      data-testid={testId}
    >
      <span className="text-[11px] font-semibold tracking-wider text-slate-400 uppercase flex items-center gap-1.5">{icon} {label}</span>
      <div className={`mt-2 text-xl font-bold ${accent}`}>{value}</div>
      <span className="text-[10px] text-slate-500 mt-1 flex items-center gap-1">{sub} <ChevronRight size={10} className="text-slate-600" /></span>
    </button>
  );

  return (
    <div className="flex flex-col h-full bg-[#0d0f12] text-slate-100 overflow-y-auto" data-testid="revenue-operator-page">
      {/* Header */}
      <div className="border-b border-slate-800/80 bg-[#12151a]/90 backdrop-blur px-8 py-5 flex items-center justify-between sticky top-0 z-20">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500/20 to-teal-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400 font-bold">€</div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
              Revenue Operator <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-medium">V1 Vertical Slice</span>
            </h1>
            <p className="text-xs text-slate-400">Discover → Evaluate → Score → Rank → Create Revenue Mission → Execute</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div
            data-testid="header-primary-active"
            className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs font-semibold"
          >
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>Primary Active: <strong>{primaryActiveProject?.name || 'Free Cash'}</strong> (Priority {primaryActiveProject?.priority ?? 1})</span>
          </div>
          <button
            onClick={loadData}
            disabled={loading}
            className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700 text-xs font-medium text-slate-300 transition-colors"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="mx-8 mt-4 p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
          <AlertTriangle size={14} /> <span>{error}</span>
        </div>
      )}

      {/* KPI strip */}
      <div className="px-8 pt-4 pb-2">
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
          {kpiCard('Target (30d)', <Target size={13} className="text-emerald-400" />, fmtEur(k?.target.value ?? mission?.targetAmount ?? 300),
            `${k?.target.activeExperiments ?? experiments.length} active exp · ${k?.target.daysRemaining ?? '—'}d left`, 'text-white', 'target', 'kpi-target')}
          {kpiCard('Realized Rev.', <DollarSign size={13} className="text-amber-400" />, fmtEur(k?.realized.value ?? mission?.realizedRevenue),
            `${k?.realized.entries ?? 0} ledger entries`, 'text-amber-400', 'realized', 'kpi-realized')}
          {kpiCard('Verified Rev.', <ShieldCheck size={13} className="text-emerald-400" />, fmtEur(k?.verified.value ?? mission?.verifiedRevenue),
            `${k?.verified.entries ?? 0} evidence-backed`, 'text-emerald-300', 'verified', 'kpi-verified')}
          {kpiCard('Pipeline Val.', <TrendingUp size={13} className="text-indigo-400" />, fmtEur(k?.pipeline.value ?? mission?.pipelineValue),
            `${k?.pipeline.experimentsInPipeline ?? 0} in pipeline`, 'text-indigo-300', 'pipeline', 'kpi-pipeline')}
          {kpiCard('Actual Cost', <Activity size={13} className="text-rose-400" />, fmtEur(k?.cost.value ?? mission?.actualCost),
            `${k?.cost.entries ?? 0} cost entries`, 'text-rose-300', 'cost', 'kpi-cost')}
          {kpiCard('Net Revenue', <DollarSign size={13} className="text-teal-400" />, fmtEur(k?.net.value ?? mission?.netRevenue),
            'realized − actual cost', 'text-teal-300', 'net', 'kpi-net')}
          {kpiCard('Ad Spend', <Target size={13} className="text-slate-400" />, fmtEur(k?.adSpend.value ?? mission?.actualSpend),
            `budget €${k?.adSpend.budget ?? mission?.advertisingBudget ?? 0} · actual only`, 'text-slate-300', 'adSpend', 'kpi-adspend')}
          <div className="bg-[#151921] border border-slate-800 rounded-xl p-3.5 flex flex-col justify-between" data-testid="kpi-days">
            <span className="text-[11px] font-semibold tracking-wider text-slate-400 uppercase flex items-center gap-1.5"><Clock size={13} className="text-cyan-400" /> Days Left</span>
            <div className="mt-2 text-xl font-bold text-cyan-300">{k?.target.daysRemaining ?? '—'}d</div>
            <span className="text-[10px] text-slate-500 mt-1">deadline: {mission?.deadline ?? '—'}</span>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="px-8 pt-4">
        <div className="flex border-b border-slate-800 gap-6 flex-wrap">
          {([
            ['portfolio', `Project Portfolio (${sortedProjects.length})`, <Layers size={14} key="port" />],
            ['opportunities', `Opportunity Pipeline (${opportunities.length})`, <TrendingUp size={14} key="opp" />],
            ['mission', 'Revenue Mission View', <Target size={14} key="m" />],
            ['overview', 'Live Execution', <Activity size={14} key="o" />],
            ['digital_products', `Digital Products (${dpBoard?.total ?? 0})`, <Package size={14} key="d" />],
            ['german_sme', `German SME (${smeBoard?.total ?? 0})`, <Building2 size={14} key="s" />],
            ['pipeline', `Pipeline Kanban (${pipeBoard?.total ?? 0})`, <Layers size={14} key="p" />],
            ['ledger', `Ledger (${ledger.length})`, <DollarSign size={14} key="l" />],
            ['gates', 'Human Gates', <Lock size={14} key="g" />],
          ] as Array<[Tab, string, React.ReactNode]>).map(([tab, label, icon]) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              data-testid={`tab-${tab}`}
              className={`pb-3 text-xs font-semibold tracking-wide transition-colors border-b-2 flex items-center gap-2 ${
                activeTab === tab ? 'border-emerald-500 text-emerald-400' : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              {icon} {label}
              {tab === 'gates' && openGates.length > 0 && (
                <span className="px-1.5 py-0.5 rounded-full bg-rose-500/20 text-rose-400 text-[10px] font-bold border border-rose-500/30">{openGates.length}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="px-8 py-6 flex-1">
        {/* Projects Portfolio View */}
        {activeTab === 'portfolio' && (
          <div className="space-y-6" data-testid="portfolio-view">
            {/* Active Project Banner */}
            <div className="bg-gradient-to-r from-emerald-950/40 via-slate-900/60 to-slate-900/40 border border-emerald-500/30 rounded-2xl p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                    Primary Active Initiative
                  </span>
                  <span className="text-xs text-slate-400">Deterministic Portfolio Priority 1</span>
                </div>
                <h3 className="text-xl font-bold text-white flex items-center gap-2">
                  {primaryActiveProject?.name || 'Free Cash'}
                </h3>
                <p className="text-xs text-slate-300 mt-1 max-w-2xl">
                  {primaryActiveProject?.description ||
                    'Primary active monetization initiative — low barrier revenue workflows with human gate isolation.'}
                </p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <button
                  onClick={() => {
                    const freeCash = sortedProjects.find(p => p.priority === 1 || p.revenueVertical === 'free_cash');
                    if (freeCash) setActiveProject(freeCash.id);
                  }}
                  className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-lg shadow-emerald-900/30 transition-colors"
                >
                  {activeProjectId === 'proj-free-cash' || sortedProjects.find(p => p.id === activeProjectId)?.priority === 1
                    ? '✓ Active Project Selected'
                    : 'Set Free Cash as Active'}
                </button>
              </div>
            </div>

            {/* Warning if Hermes test project is currently active */}
            {activeProjectId === 'proj-3edb8bb8' && (
              <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-between gap-3 text-xs text-amber-200">
                <div className="flex items-center gap-2">
                  <AlertCircle size={16} className="text-amber-400 shrink-0" />
                  <span>
                    <strong>Note:</strong> Active project was temporarily set to Hermes Acceptance test (<code>proj-3edb8bb8</code>). Revenue Operator active portfolio prioritizes Free Cash (#1).
                  </span>
                </div>
                <button
                  onClick={() => {
                    const freeCash = sortedProjects.find(p => p.priority === 1 || p.revenueVertical === 'free_cash');
                    if (freeCash) setActiveProject(freeCash.id);
                  }}
                  className="px-3 py-1.5 rounded bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-100 font-semibold"
                >
                  Switch to Free Cash
                </button>
              </div>
            )}

            {/* Portfolio Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" data-testid="portfolio-grid">
              {sortedProjects.map((project, idx) => {
                const isP1 = project.priority === 1 || project.revenueVertical === 'free_cash';
                const isP2 = project.priority === 2 || project.revenueVertical === 'shopify';
                const isP3 = project.priority === 3 || project.revenueVertical === 'tiktok_shop';
                const isActive = project.id === activeProjectId;

                return (
                  <div
                    key={project.id}
                    data-testid={`portfolio-card-${project.id}`}
                    className={`rounded-2xl border p-5 flex flex-col justify-between transition-all ${
                      isP1
                        ? 'bg-[#131b1b] border-emerald-500/40 shadow-lg shadow-emerald-950/20 ring-1 ring-emerald-500/20'
                        : isP2
                        ? 'bg-[#151922] border-indigo-500/30'
                        : isP3
                        ? 'bg-[#181622] border-purple-500/30'
                        : 'bg-[#14161d] border-slate-800'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2 mb-3">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span
                            className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${
                              isP1
                                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                                : isP2
                                ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40'
                                : isP3
                                ? 'bg-purple-500/20 text-purple-300 border-purple-500/40'
                                : 'bg-slate-700/50 text-slate-300 border-slate-600/40'
                            }`}
                          >
                            Priority {project.priority ?? idx + 1}
                          </span>
                          {isP1 && (
                            <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-500/15 text-amber-300 border border-amber-500/30">
                              Primary Active Initiative
                            </span>
                          )}
                        </div>
                        {isActive && (
                          <span className="flex items-center gap-1 text-[11px] font-semibold text-emerald-400">
                            <CheckCircle2 size={12} /> Active
                          </span>
                        )}
                      </div>

                      <h4 className="text-base font-bold text-white mb-1.5">{project.name}</h4>
                      <p className="text-xs text-slate-400 line-clamp-3 leading-relaxed mb-4">
                        {project.description || 'No description provided.'}
                      </p>
                    </div>

                    <div className="pt-4 border-t border-slate-800/80 flex items-center justify-between gap-3 text-xs">
                      <span className="text-[11px] text-slate-500 font-mono">
                        {project.id}
                      </span>
                      <button
                        onClick={() => setActiveProject(project.id)}
                        disabled={isActive}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                          isActive
                            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 cursor-default'
                            : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700'
                        }`}
                      >
                        {isActive ? 'Active Project' : 'Set as Active'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Opportunity Pipeline View */}
        {activeTab === 'opportunities' && (
          <OpportunityPipelineView
            opportunities={opportunities}
            onSelectOpportunity={(opp) => setSelectedOpp(opp)}
            onSeed={handleSeedOpportunities}
            seeding={seedingOpps}
          />
        )}

        {/* Revenue Mission View */}
        {activeTab === 'mission' && (
          <MissionView mission={mission} convertedMissionData={convertedMissionData} />
        )}

        {/* Overview / Live Execution */}
        {activeTab === 'overview' && (
          <div className="space-y-5">
            {openGates.length > 0 && (
              <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs text-amber-300">
                  <Lock size={14} className="text-amber-400 shrink-0" />
                  <span><strong>{openGates.length} human gate(s) open</strong> — affected branches paused safely.</span>
                </div>
                <button onClick={() => setActiveTab('gates')} className="px-2.5 py-1 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border border-amber-500/40 text-[11px] font-semibold">View Gates</button>
              </div>
            )}

            <div className="bg-[#151921] border border-slate-800/80 rounded-xl p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-bold text-white flex items-center gap-2"><Activity size={16} className="text-cyan-400" /> Live Canonical Execution</h3>
                <span className="text-xs text-slate-400">truthful DB statuses</span>
              </div>
              {liveNote && <div className="mb-3 text-[11px] text-slate-500 italic">{liveNote}</div>}
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse" data-testid="live-execution-table">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400 font-semibold">
                      <th className="py-2.5 px-3">Task</th>
                      <th className="py-2.5 px-3">Executor</th>
                      <th className="py-2.5 px-3">Provider / Model</th>
                      <th className="py-2.5 px-3">Run ID</th>
                      <th className="py-2.5 px-3">Status</th>
                      <th className="py-2.5 px-3">Elapsed</th>
                      <th className="py-2.5 px-3">Verification</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {liveRows.length === 0 ? (
                      <tr><td colSpan={7} className="py-6 text-center text-slate-500">No canonical execution runs linked to this mission yet.</td></tr>
                    ) : liveRows.map((row) => (
                      <tr key={row.runId} className="hover:bg-slate-900/40">
                        <td className="py-2.5 px-3 font-medium text-slate-200 max-w-[220px]">{row.task}</td>
                        <td className="py-2.5 px-3"><span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-mono text-[10px]">{row.executor}</span></td>
                        <td className="py-2.5 px-3 text-slate-300 font-mono text-[11px]">{row.provider ? `${row.provider}/${row.model || '?'}` : '—'}</td>
                        <td className="py-2.5 px-3 font-mono text-slate-400 text-[10px]">{row.runId.slice(0, 14)}…</td>
                        <td className="py-2.5 px-3"><StatusBadge status={row.status} /></td>
                        <td className="py-2.5 px-3 text-slate-400 font-mono text-[10px]">{fmtElapsed(row.elapsedMs)}</td>
                        <td className="py-2.5 px-3">
                          {row.verification ? (
                            <span className="px-2 py-0.5 rounded text-[10px] border bg-emerald-500/10 text-emerald-400 border-emerald-500/20">
                              {row.verification.verdict}
                            </span>
                          ) : <span className="text-slate-600 text-[10px]">not verified</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Digital Products Kanban */}
        {activeTab === 'digital_products' && dpBoard && (
          <KanbanBoard board={dpBoard} accent="text-emerald-400" onCardClick={(card) => {
            revenueOperatorClient.traceExperiment(card.id).then(setDrawer).catch(() => {});
          }} />
        )}

        {/* German SME Kanban */}
        {activeTab === 'german_sme' && smeBoard && (
          <KanbanBoard board={smeBoard} accent="text-indigo-400" onCardClick={(card) => {
            revenueOperatorClient.traceExperiment(card.id).then(setDrawer).catch(() => {});
          }} />
        )}

        {/* Pipeline Kanban */}
        {activeTab === 'pipeline' && pipeBoard && (
          <KanbanBoard board={pipeBoard} accent="text-cyan-400" onCardClick={(card) => {
            revenueOperatorClient.traceExperiment(card.id).then(setDrawer).catch(() => {});
          }} />
        )}

        {/* Ledger */}
        {activeTab === 'ledger' && (
          <div className="bg-[#151921] border border-slate-800 rounded-xl p-5" data-testid="ledger-table">
            <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
              <DollarSign size={16} className="text-emerald-400" /> Commercial Ledger
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400 font-semibold">
                    <th className="py-2 px-3">Entry Type</th>
                    <th className="py-2 px-3">Amount</th>
                    <th className="py-2 px-3">Status</th>
                    <th className="py-2 px-3">Source</th>
                    <th className="py-2 px-3">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {filteredLedger.length === 0 ? (
                    <tr><td colSpan={5} className="py-6 text-center text-slate-500">No ledger entries recorded.</td></tr>
                  ) : filteredLedger.map((e) => (
                    <tr key={e.id} className="hover:bg-slate-900/40">
                      <td className="py-2 px-3 font-mono text-[11px] text-slate-200">{e.entryType}</td>
                      <td className="py-2 px-3 font-bold text-emerald-400">{fmtEur(e.amount)}</td>
                      <td className="py-2 px-3"><StatusBadge status={e.status} /></td>
                      <td className="py-2 px-3 text-slate-400">{e.source || 'manual'}</td>
                      <td className="py-2 px-3 text-slate-500 font-mono text-[10px]">{fmtDate(e.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Human Gates */}
        {activeTab === 'gates' && (
          <div className="bg-[#151921] border border-slate-800 rounded-xl p-5" data-testid="gates-table">
            <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
              <Lock size={16} className="text-amber-400" /> Human Approval Gates
            </h3>
            <div className="space-y-3">
              {gateItems.length === 0 ? (
                <div className="py-6 text-center text-slate-500 text-xs">No human gates in queue.</div>
              ) : gateItems.map((g) => (
                <div key={g.id} className="bg-slate-900/70 border border-slate-800 rounded-xl p-4 flex items-center justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-white">{g.gateType}</span>
                      <StatusBadge status={g.status} />
                    </div>
                    <p className="text-xs text-slate-400 mt-1">{g.description || 'Approval required before proceeding.'}</p>
                  </div>
                  {g.status === 'open' && (
                    <button
                      onClick={async () => {
                        try {
                          setResolvingGateId(g.id);
                          await revenueOperatorClient.resolveGate(g.id, 'operator-ui');
                          await loadData();
                        } catch (err: any) {
                          alert(`Failed to resolve gate: ${err?.message}`);
                        } finally {
                          setResolvingGateId(null);
                        }
                      }}
                      disabled={resolvingGateId === g.id}
                      className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-lg"
                    >
                      {resolvingGateId === g.id ? 'Approving...' : 'Approve & Resume'}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Selected Opportunity Modal */}
      {selectedOpp && (
        <OpportunityModal
          opportunity={selectedOpp}
          onClose={() => setSelectedOpp(null)}
          onConvert={handleConvertOpportunity}
          converting={convertingOpp}
        />
      )}
    </div>
  );
};

export default RevenueOperatorPage;
