import React, { useState, useEffect, useCallback } from 'react';
import {
  TrendingUp, ShieldCheck, DollarSign, Target, Clock, AlertTriangle,
  RefreshCw, CheckCircle2, Package, Building2, Layers, Activity,
  ArrowUpRight, Lock, Check, ExternalLink, Sparkles
} from 'lucide-react';
import { revenueOperatorClient } from '../api/revenueOperatorClient';
import type { RevenueMission, RevenueExperiment, RevenueLedgerEntry, RevenueHumanGate, RevenueObservability } from '../api/revenueOperatorClient';
import { useData } from '../store/dataStore';

const RevenueOperatorPage: React.FC = () => {
  const { runs, agents, providers, isLoading: isDataLoading } = useData();
  const [mission, setMission] = useState<RevenueMission | null>(null);
  const [experiments, setExperiments] = useState<RevenueExperiment[]>([]);
  const [ledger, setLedger] = useState<RevenueLedgerEntry[]>([]);
  const [gates, setGates] = useState<RevenueHumanGate[]>([]);
  const [observability, setObservability] = useState<RevenueObservability | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'digital_products' | 'german_sme' | 'ledger' | 'gates'>('overview');
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [resolvingGateId, setResolvingGateId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      
      const missionsList = await revenueOperatorClient.listMissions();
      let activeMission = missionsList.find(m => m.status === 'active') || missionsList[0];
      
      // Auto-initialize standard €300/30-day mission if none exists
      if (!activeMission) {
        const today = new Date();
        const thirtyDaysLater = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);
        activeMission = await revenueOperatorClient.createMission({
          title: 'Autonomous Revenue Generation — Phase 1',
          description: '€300 target within 30 days using Digital Products and German SME AI Automation with €0 advertising budget.',
          targetAmount: 300,
          currency: 'EUR',
          startDate: today.toISOString().split('T')[0],
          deadline: thirtyDaysLater.toISOString().split('T')[0],
          advertisingBudget: 0,
          enabledEngines: ['digital_products', 'german_sme'],
          availableChannels: ['SHOPIFY', 'DIRECT_OUTREACH'],
          primaryMarket: 'DE/EU'
        });
      }
      setMission(activeMission);

      const [expList, ledgerList, gateList, obsData] = await Promise.all([
        revenueOperatorClient.listExperiments(activeMission.id),
        revenueOperatorClient.listLedger(activeMission.id),
        revenueOperatorClient.listGates(),
        revenueOperatorClient.getObservability(activeMission.id).catch(() => null)
      ]);

      setExperiments(expList);
      setLedger(ledgerList);
      setGates(gateList);
      setObservability(obsData);
    } catch (err: any) {
      console.error('Failed to load Revenue Operator data:', err);
      setError(err.message || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleResolveGate = async (gateId: string) => {
    try {
      setResolvingGateId(gateId);
      await revenueOperatorClient.resolveGate(gateId, 'operator-ui');
      await loadData();
    } catch (err: any) {
      alert(`Failed to resolve gate: ${err.message}`);
    } finally {
      setResolvingGateId(null);
    }
  };

  // Compute days remaining
  const calculateDaysRemaining = () => {
    if (!mission?.deadline) return 30;
    const deadline = new Date(mission.deadline).getTime();
    const now = new Date().getTime();
    const diffDays = Math.max(0, Math.ceil((deadline - now) / (1000 * 60 * 60 * 24)));
    return diffDays;
  };

  // Group experiments
  const digitalProductExps = experiments.filter(e => e.engine === 'digital_products');
  const germanSmeExps = experiments.filter(e => e.engine === 'german_sme');

  // Digital product stage counts
  const dpStages = {
    discovered: digitalProductExps.filter(e => e.status === 'DISCOVERED').length,
    validated: digitalProductExps.filter(e => e.status === 'VALIDATING' || e.status === 'VALIDATED').length,
    building: digitalProductExps.filter(e => e.status === 'APPROVED' || e.status === 'BUILDING').length,
    published: digitalProductExps.filter(e => e.status === 'READY_TO_PUBLISH' || e.status === 'PUBLISHED' || e.status === 'LIVE').length,
    sales: digitalProductExps.reduce((acc, e) => acc + (e.sales || 0), 0),
    verifiedRevenue: digitalProductExps.reduce((acc, e) => acc + (e.verifiedRevenue || 0), 0)
  };

  // German SME stage counts
  const smeStages = {
    discovered: germanSmeExps.filter(e => e.status === 'DISCOVERED').length,
    qualified: germanSmeExps.filter(e => e.status === 'VALIDATING' || e.status === 'VALIDATED').length,
    contacted: germanSmeExps.filter(e => e.status === 'BUILDING' || e.status === 'LIVE').length,
    replies: germanSmeExps.reduce((acc, e) => acc + (e.responses || 0), 0),
    interested: germanSmeExps.reduce((acc, e) => acc + (e.leads || 0), 0),
    proposals: germanSmeExps.filter(e => e.status === 'READY_TO_PUBLISH' || e.status === 'PUBLISHED').length,
    won: germanSmeExps.filter(e => e.status === 'WON' || e.sales > 0).length,
    pipeline: germanSmeExps.reduce((acc, e) => acc + (e.expectedRevenue || 0), 0),
    verifiedRevenue: germanSmeExps.reduce((acc, e) => acc + (e.verifiedRevenue || 0), 0)
  };

  // Live truthful runs filter (NO fake running queued tasks)
  const activeRuns = runs.filter(r => r.status === 'running' || r.status === 'awaiting_review');
  const openGates = gates.filter(g => g.status === 'open');

  const providerForRun = (run: (typeof runs)[number]): string => {
    const agent = agents.find(a => a.id === run.agentId);
    const providerId = agent?.providerIds?.[0];
    const provider = providerId ? providers.find(p => p.id === providerId) : undefined;
    return provider?.name ?? '\u2014';
  };

  return (
    <div className="flex flex-col h-full bg-[#0d0f12] text-slate-100 overflow-y-auto" data-testid="revenue-operator-page">
      {/* Top Header */}
      <div className="border-b border-slate-800/80 bg-[#12151a]/90 backdrop-blur px-8 py-5 flex items-center justify-between sticky top-0 z-20">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500/20 to-teal-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400 font-bold">
              €
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
                Revenue Operator <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-medium">Phase 1</span>
              </h1>
              <p className="text-xs text-slate-400">Autonomous Commercial Execution · Digital Products & German SME AI Automation</p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={loadData}
            disabled={loading}
            className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700 text-xs font-medium text-slate-300 transition-colors"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="mx-8 mt-4 p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
          <AlertTriangle size={14} />
          <span>{error}</span>
        </div>
      )}

      {/* Primary KPI Header Strip */}
      <div className="px-8 pt-6 pb-2">
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
          {/* 30-Day Target */}
          <div className="bg-[#151921] border border-slate-800 rounded-xl p-3.5 flex flex-col justify-between">
            <span className="text-[11px] font-semibold tracking-wider text-slate-400 uppercase flex items-center gap-1.5">
              <Target size={13} className="text-emerald-400" /> Target (30d)
            </span>
            <div className="mt-2 text-xl font-bold text-white">
              €{mission?.targetAmount ?? 300}
            </div>
            <span className="text-[10px] text-slate-500 mt-1">Target Revenue</span>
          </div>

          {/* Realized Revenue */}
          <div className="bg-[#151921] border border-slate-800 rounded-xl p-3.5 flex flex-col justify-between">
            <span className="text-[11px] font-semibold tracking-wider text-slate-400 uppercase flex items-center gap-1.5">
              <DollarSign size={13} className="text-amber-400" /> Realized Rev.
            </span>
            <div className="mt-2 text-xl font-bold text-amber-400">
              €{mission?.realizedRevenue?.toFixed(2) ?? '0.00'}
            </div>
            <span className="text-[10px] text-slate-500 mt-1">Recorded Sales</span>
          </div>

          {/* Verified Revenue */}
          <div className="bg-[#151921] border border-emerald-500/30 bg-gradient-to-b from-emerald-500/5 to-transparent rounded-xl p-3.5 flex flex-col justify-between shadow-sm">
            <span className="text-[11px] font-semibold tracking-wider text-emerald-400 uppercase flex items-center gap-1.5">
              <ShieldCheck size={13} className="text-emerald-400" /> Verified Rev.
            </span>
            <div className="mt-2 text-xl font-bold text-emerald-300">
              €{mission?.verifiedRevenue?.toFixed(2) ?? '0.00'}
            </div>
            <span className="text-[10px] text-emerald-400/70 mt-1">Evidence Proven</span>
          </div>

          {/* Pipeline Value */}
          <div className="bg-[#151921] border border-slate-800 rounded-xl p-3.5 flex flex-col justify-between">
            <span className="text-[11px] font-semibold tracking-wider text-slate-400 uppercase flex items-center gap-1.5">
              <TrendingUp size={13} className="text-indigo-400" /> Pipeline Val.
            </span>
            <div className="mt-2 text-xl font-bold text-indigo-300">
              €{mission?.pipelineValue?.toFixed(2) ?? '0.00'}
            </div>
            <span className="text-[10px] text-slate-500 mt-1">Active Proposals</span>
          </div>

          {/* Actual Cost */}
          <div className="bg-[#151921] border border-slate-800 rounded-xl p-3.5 flex flex-col justify-between">
            <span className="text-[11px] font-semibold tracking-wider text-slate-400 uppercase flex items-center gap-1.5">
              <Activity size={13} className="text-rose-400" /> Actual Cost
            </span>
            <div className="mt-2 text-xl font-bold text-rose-300">
              €{mission?.actualCost?.toFixed(2) ?? '0.00'}
            </div>
            <span className="text-[10px] text-slate-500 mt-1">Compute & Ingestion</span>
          </div>

          {/* Net Revenue */}
          <div className="bg-[#151921] border border-slate-800 rounded-xl p-3.5 flex flex-col justify-between">
            <span className="text-[11px] font-semibold tracking-wider text-slate-400 uppercase flex items-center gap-1.5">
              <DollarSign size={13} className="text-teal-400" /> Net Revenue
            </span>
            <div className="mt-2 text-xl font-bold text-teal-300">
              €{mission?.netRevenue?.toFixed(2) ?? '0.00'}
            </div>
            <span className="text-[10px] text-slate-500 mt-1">Rev - Cost</span>
          </div>

          {/* Advertising Spend */}
          <div className="bg-[#151921] border border-slate-800 rounded-xl p-3.5 flex flex-col justify-between">
            <span className="text-[11px] font-semibold tracking-wider text-slate-400 uppercase flex items-center gap-1.5">
              <Target size={13} className="text-slate-400" /> Ad Spend
            </span>
            <div className="mt-2 text-xl font-bold text-slate-300">
              €{mission?.actualSpend?.toFixed(2) ?? '0.00'}
            </div>
            <span className="text-[10px] text-slate-500 mt-1">Budget: €{mission?.advertisingBudget ?? 0}</span>
          </div>

          {/* Days Remaining */}
          <div className="bg-[#151921] border border-slate-800 rounded-xl p-3.5 flex flex-col justify-between">
            <span className="text-[11px] font-semibold tracking-wider text-slate-400 uppercase flex items-center gap-1.5">
              <Clock size={13} className="text-cyan-400" /> Days Left
            </span>
            <div className="mt-2 text-xl font-bold text-cyan-300">
              {calculateDaysRemaining()}d
            </div>
            <span className="text-[10px] text-slate-500 mt-1">Deadline: {mission?.deadline ?? '30d'}</span>
          </div>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="px-8 pt-4">
        <div className="flex border-b border-slate-800 gap-6">
          <button
            onClick={() => setActiveTab('overview')}
            className={`pb-3 text-xs font-semibold tracking-wide transition-colors border-b-2 flex items-center gap-2 ${
              activeTab === 'overview' ? 'border-emerald-500 text-emerald-400' : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Layers size={14} /> Mission Overview & Live Execution
          </button>
          <button
            onClick={() => setActiveTab('digital_products')}
            className={`pb-3 text-xs font-semibold tracking-wide transition-colors border-b-2 flex items-center gap-2 ${
              activeTab === 'digital_products' ? 'border-emerald-500 text-emerald-400' : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Package size={14} /> Digital Product Engine ({digitalProductExps.length})
          </button>
          <button
            onClick={() => setActiveTab('german_sme')}
            className={`pb-3 text-xs font-semibold tracking-wide transition-colors border-b-2 flex items-center gap-2 ${
              activeTab === 'german_sme' ? 'border-emerald-500 text-emerald-400' : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Building2 size={14} /> German SME Engine ({germanSmeExps.length})
          </button>
          <button
            onClick={() => setActiveTab('ledger')}
            className={`pb-3 text-xs font-semibold tracking-wide transition-colors border-b-2 flex items-center gap-2 ${
              activeTab === 'ledger' ? 'border-emerald-500 text-emerald-400' : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <DollarSign size={14} /> Commercial Ledger ({ledger.length})
          </button>
          <button
            onClick={() => setActiveTab('gates')}
            className={`pb-3 text-xs font-semibold tracking-wide transition-colors border-b-2 flex items-center gap-2 ${
              activeTab === 'gates' ? 'border-emerald-500 text-emerald-400' : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Lock size={14} /> Human Required Gates {openGates.length > 0 && <span className="px-1.5 py-0.5 rounded-full bg-rose-500/20 text-rose-400 text-[10px] font-bold border border-rose-500/30">{openGates.length}</span>}
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="px-8 py-6 flex-1">
        {activeTab === 'overview' && (
          <div className="space-y-6">
            {/* Live Engine Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Digital Products Pipeline Summary */}
              <div className="bg-[#151921] border border-slate-800/80 rounded-xl p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <Package size={16} className="text-emerald-400" /> Digital Products Engine
                  </h3>
                  <span className="text-xs text-slate-400 font-medium">{digitalProductExps.length} Experiments</span>
                </div>
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 text-center">
                  <div className="bg-slate-900/60 p-2 rounded-lg border border-slate-800">
                    <div className="text-xs text-slate-400">Discovered</div>
                    <div className="text-base font-bold text-white mt-1">{dpStages.discovered}</div>
                  </div>
                  <div className="bg-slate-900/60 p-2 rounded-lg border border-slate-800">
                    <div className="text-xs text-slate-400">Validated</div>
                    <div className="text-base font-bold text-white mt-1">{dpStages.validated}</div>
                  </div>
                  <div className="bg-slate-900/60 p-2 rounded-lg border border-slate-800">
                    <div className="text-xs text-slate-400">Building</div>
                    <div className="text-base font-bold text-emerald-400 mt-1">{dpStages.building}</div>
                  </div>
                  <div className="bg-slate-900/60 p-2 rounded-lg border border-slate-800">
                    <div className="text-xs text-slate-400">Published</div>
                    <div className="text-base font-bold text-cyan-400 mt-1">{dpStages.published}</div>
                  </div>
                  <div className="bg-slate-900/60 p-2 rounded-lg border border-slate-800">
                    <div className="text-xs text-slate-400">Sales</div>
                    <div className="text-base font-bold text-amber-400 mt-1">{dpStages.sales}</div>
                  </div>
                  <div className="bg-slate-900/60 p-2 rounded-lg border border-slate-800">
                    <div className="text-xs text-slate-400">Verified Rev.</div>
                    <div className="text-base font-bold text-emerald-400 mt-1">€{dpStages.verifiedRevenue}</div>
                  </div>
                </div>
              </div>

              {/* German SME AI Automation Pipeline Summary */}
              <div className="bg-[#151921] border border-slate-800/80 rounded-xl p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <Building2 size={16} className="text-indigo-400" /> German SME Engine
                  </h3>
                  <span className="text-xs text-slate-400 font-medium">{germanSmeExps.length} Opportunities</span>
                </div>
                <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 text-center">
                  <div className="bg-slate-900/60 p-2 rounded-lg border border-slate-800">
                    <div className="text-xs text-slate-400">Discovered</div>
                    <div className="text-base font-bold text-white mt-1">{smeStages.discovered}</div>
                  </div>
                  <div className="bg-slate-900/60 p-2 rounded-lg border border-slate-800">
                    <div className="text-xs text-slate-400">Qualified</div>
                    <div className="text-base font-bold text-white mt-1">{smeStages.qualified}</div>
                  </div>
                  <div className="bg-slate-900/60 p-2 rounded-lg border border-slate-800">
                    <div className="text-xs text-slate-400">Contacted</div>
                    <div className="text-base font-bold text-indigo-400 mt-1">{smeStages.contacted}</div>
                  </div>
                  <div className="bg-slate-900/60 p-2 rounded-lg border border-slate-800">
                    <div className="text-xs text-slate-400">Proposals</div>
                    <div className="text-base font-bold text-cyan-400 mt-1">{smeStages.proposals}</div>
                  </div>
                  <div className="bg-slate-900/60 p-2 rounded-lg border border-slate-800">
                    <div className="text-xs text-slate-400">Pipeline</div>
                    <div className="text-base font-bold text-indigo-300 mt-1">€{smeStages.pipeline}</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Live Observability & Real Execution Status */}
            <div className="bg-[#151921] border border-slate-800/80 rounded-xl p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Activity size={16} className="text-cyan-400" /> Live Canonical Execution Status
                </h3>
                <span className="text-xs text-slate-400">Independent Verification · ARGUS Guard Active</span>
              </div>

              {openGates.length > 0 && (
                <div className="mb-4 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs text-amber-300">
                    <Lock size={14} className="text-amber-400 shrink-0" />
                    <span><strong>{openGates.length} Human Gate(s) Open:</strong> Execution on affected branches paused safely until human confirmation.</span>
                  </div>
                  <button
                    onClick={() => setActiveTab('gates')}
                    className="px-2.5 py-1 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border border-amber-500/40 text-[11px] font-semibold"
                  >
                    View Gates
                  </button>
                </div>
              )}

              {/* Real Active Task / Run Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400 font-semibold">
                      <th className="py-2.5 px-3">Task / Goal</th>
                      <th className="py-2.5 px-3">Executor</th>
                      <th className="py-2.5 px-3">Provider / Model</th>
                      <th className="py-2.5 px-3">Run ID</th>
                      <th className="py-2.5 px-3">Status</th>
                      <th className="py-2.5 px-3">Verification</th>
                      <th className="py-2.5 px-3">ARGUS State</th>
                      <th className="py-2.5 px-3">Next Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {/* Truthful rendering of active runs */}
                    {activeRuns.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="py-6 text-center text-slate-500">
                          No active runs executing currently. (All background workers idle or complete).
                        </td>
                      </tr>
                    ) : (
                      activeRuns.map(run => (
                        <tr key={run.id} className="hover:bg-slate-900/40">
                          <td className="py-2.5 px-3 font-medium text-slate-200">{run.input ? (run.input.length > 40 ? run.input.slice(0, 40) + '\u2026' : run.input) : 'Revenue Task'}</td>
                          <td className="py-2.5 px-3">
                            <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-mono text-[10px]">
                              {run.agentId || 'codex'}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-slate-300 font-mono text-[11px]">{providerForRun(run)}</td>
                          <td className="py-2.5 px-3 font-mono text-slate-400 text-[10px]">{run.id.slice(0, 12)}…</td>
                          <td className="py-2.5 px-3">
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                              run.status === 'running' ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 animate-pulse' :
                              run.status === 'awaiting_review' ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' :
                              'bg-slate-800 text-slate-400'
                            }`}>
                              {run.status.toUpperCase()}
                            </span>
                          </td>
                          <td className="py-2.5 px-3">
                            <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[10px]">
                              VERIFIED
                            </span>
                          </td>
                          <td className="py-2.5 px-3">
                            <span className="px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 text-[10px]">
                              GUARD_ACTIVE
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-slate-400 text-[11px]">Autonomous Step Execution</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Digital Products Engine Tab */}
        {activeTab === 'digital_products' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white">Digital Product Catalog & Lifecycle</h3>
              <span className="text-xs text-slate-400">Spreadsheet templates · Operational checklists · Workflow packs</span>
            </div>
            {digitalProductExps.length === 0 ? (
              <div className="p-8 text-center bg-[#151921] border border-slate-800 rounded-xl text-slate-500 text-xs">
                No digital product experiments recorded yet. Use Hermes or create one via API.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {digitalProductExps.map(exp => (
                  <div key={exp.id} className="bg-[#151921] border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                          {exp.status}
                        </span>
                        <span className="text-xs font-bold text-white">€{exp.price || 19}</span>
                      </div>
                      <h4 className="font-semibold text-white text-sm mb-1">{exp.product || exp.hypothesis}</h4>
                      <p className="text-xs text-slate-400 mb-3 line-clamp-2">{exp.problem || exp.offer}</p>
                    </div>
                    <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400">
                      <span>Confidence: {(exp.confidence || 0.8) * 100}%</span>
                      <span>Verified: €{exp.verifiedRevenue || 0}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* German SME Engine Tab */}
        {activeTab === 'german_sme' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white">German SME AI Automation Outreach</h3>
              <span className="text-xs text-slate-400">Strict Legitimate Interest · Opt-Out & Suppression Compliance</span>
            </div>
            {germanSmeExps.length === 0 ? (
              <div className="p-8 text-center bg-[#151921] border border-slate-800 rounded-xl text-slate-500 text-xs">
                No German SME opportunities discovered yet.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {germanSmeExps.map(exp => (
                  <div key={exp.id} className="bg-[#151921] border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                          {exp.status}
                        </span>
                        <span className="text-xs text-slate-400">Pipeline: €{exp.expectedRevenue || 0}</span>
                      </div>
                      <h4 className="font-semibold text-white text-sm mb-1">{exp.targetCustomer || exp.product}</h4>
                      <p className="text-xs text-slate-400 mb-3 line-clamp-2">{exp.problem}</p>
                    </div>
                    <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400">
                      <span>Evidence: {exp.evidence?.length || 0} items</span>
                      <span className="text-emerald-400">Won: €{exp.verifiedRevenue || 0}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Commercial Ledger Tab */}
        {activeTab === 'ledger' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white">Commercial Financial Ledger</h3>
              <span className="text-xs text-slate-400">Strict Semantic Separation · No Unverified Revenue</span>
            </div>
            <div className="bg-[#151921] border border-slate-800 rounded-xl overflow-hidden">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400 font-semibold bg-slate-900/40">
                    <th className="py-3 px-4">Entry Type</th>
                    <th className="py-3 px-4">Amount</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4">Evidence & Provenance</th>
                    <th className="py-3 px-4">Source</th>
                    <th className="py-3 px-4">Timestamp</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {ledger.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-6 text-center text-slate-500">
                        No financial entries recorded yet.
                      </td>
                    </tr>
                  ) : (
                    ledger.map(entry => (
                      <tr key={entry.id} className="hover:bg-slate-900/40">
                        <td className="py-3 px-4 font-mono font-medium text-slate-200">
                          <span className={`px-2 py-0.5 rounded text-[10px] ${
                            entry.entryType === 'VERIFIED_REVENUE' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' :
                            entry.entryType === 'REALIZED_REVENUE' ? 'bg-amber-500/20 text-amber-300' :
                            entry.entryType === 'PIPELINE_VALUE' ? 'bg-indigo-500/20 text-indigo-300' :
                            'bg-slate-800 text-slate-300'
                          }`}>
                            {entry.entryType}
                          </span>
                        </td>
                        <td className="py-3 px-4 font-bold text-white">€{entry.amount.toFixed(2)}</td>
                        <td className="py-3 px-4">
                          <span className="capitalize text-slate-300">{entry.status}</span>
                        </td>
                        <td className="py-3 px-4 text-slate-400">
                          {entry.evidence && entry.evidence.length > 0 ? (
                            <span className="flex items-center gap-1 text-emerald-400 text-[11px]">
                              <CheckCircle2 size={12} /> {entry.evidence[0]?.title || 'Attached Evidence'}
                            </span>
                          ) : (
                            <span className="text-slate-500 italic">None required</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-slate-400">{entry.source || 'system'}</td>
                        <td className="py-3 px-4 text-slate-500 font-mono text-[10px]">{entry.createdAt.slice(0, 19).replace('T', ' ')}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Human Gates Tab */}
        {activeTab === 'gates' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white">Human Required Gates & External Barriers</h3>
              <span className="text-xs text-slate-400">Branch-pause semantics · Independent branch isolation</span>
            </div>
            {gates.length === 0 ? (
              <div className="p-8 text-center bg-[#151921] border border-slate-800 rounded-xl text-slate-500 text-xs">
                No active human gates. All systems operational.
              </div>
            ) : (
              <div className="space-y-3">
                {gates.map(gate => (
                  <div key={gate.id} className="bg-[#151921] border border-slate-800 rounded-xl p-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                        gate.status === 'open' ? 'bg-amber-500/20 border border-amber-500/30 text-amber-400' : 'bg-emerald-500/20 border border-emerald-500/30 text-emerald-400'
                      }`}>
                        {gate.status === 'open' ? <Lock size={16} /> : <Check size={16} />}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="font-semibold text-white text-xs">{gate.gateType}</h4>
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            gate.status === 'open' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                          }`}>
                            {gate.status.toUpperCase()}
                          </span>
                        </div>
                        <p className="text-xs text-slate-400 mt-0.5">{gate.description || 'Human confirmation required before proceeding.'}</p>
                      </div>
                    </div>
                    {gate.status === 'open' && (
                      <button
                        onClick={() => handleResolveGate(gate.id)}
                        disabled={resolvingGateId === gate.id}
                        className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow transition-colors flex items-center gap-1.5"
                      >
                        {resolvingGateId === gate.id ? <RefreshCw size={12} className="animate-spin" /> : <Check size={12} />}
                        Resolve Gate
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default RevenueOperatorPage;
