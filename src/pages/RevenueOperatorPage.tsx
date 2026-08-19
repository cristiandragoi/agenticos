import React, { useState, useEffect, useCallback } from 'react';
import {
  TrendingUp, ShieldCheck, DollarSign, Target, Clock, AlertTriangle,
  RefreshCw, CheckCircle2, Package, Building2, Layers, Activity,
  Lock, Check, X, ChevronRight, GitBranch, Eye
} from 'lucide-react';
import { revenueOperatorClient } from '../api/revenueOperatorClient';
import type {
  RevenueMission, RevenueExperiment, RevenueLedgerEntry, RevenueHumanGate,
  RevenueMissionTrace, RevenueKpiBreakdown, RevenueKpiKey, RevenueBoard,
  RevenueBoardCard, RevenueLiveExecutionRow, RevenueGateQueueItem,
  RevenueExperimentTrace,
} from '../api/revenueOperatorClient';

type Tab = 'overview' | 'digital_products' | 'german_sme' | 'pipeline' | 'ledger' | 'gates';

const fmtEur = (v: number | null | undefined): string => `€${(v ?? 0).toFixed(2)}`;
const fmtDate = (iso: string | null | undefined): string =>
  iso ? iso.slice(0, 19).replace('T', ' ') : '—';

function StatusBadge({ status }: { status: string }) {
  const s = String(status || '').toUpperCase();
  const tone =
    ['RUNNING', 'PUBLISHING', 'LIVE', 'SCALING'].includes(s) ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30' :
    ['QUEUED', 'DISCOVERED', 'VALIDATING', 'APPROVED'].includes(s) ? 'bg-slate-700/60 text-slate-300 border-slate-600/50' :
    ['COMPLETED', 'WON', 'VERIFIED_COMPLETE', 'PASS'].includes(s) ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' :
    ['FAILED', 'KILLED', 'LOST', 'BLOCKED'].includes(s) ? 'bg-rose-500/20 text-rose-300 border-rose-500/30' :
    ['VERIFIED', 'RESOLVED'].includes(s) ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
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

// ── Kanban board (generic) ──────────────────────────────────────────────────

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

// ── Drill-down modal (KPI breakdown) ────────────────────────────────────────

const KpiModal: React.FC<{
  title: string;
  breakdown: RevenueKpiBreakdown;
  onClose: () => void;
  onExperimentClick: (id: string) => void;
}> = ({ title, breakdown, onClose, onExperimentClick }) => {
  const items = breakdown.items || [];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-[#12151a] border border-slate-700 rounded-xl w-[760px] max-w-[92vw] max-h-[84vh] overflow-y-auto shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        data-testid="kpi-drilldown"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 sticky top-0 bg-[#12151a]">
          <h3 className="text-sm font-bold text-white">{title} — itemized from persisted records</h3>
          <div className="flex items-center gap-3">
            <span className="text-lg font-bold text-emerald-300">{fmtEur(breakdown.total)}</span>
            <button onClick={onClose} className="text-slate-400 hover:text-white"><X size={16} /></button>
          </div>
        </div>
        <div className="px-5 py-4 space-y-4">
          {breakdown.formula && (
            <div className="text-xs text-slate-300 bg-slate-900/60 border border-slate-800 rounded-lg p-3 font-mono">
              net = realized − actual cost = {fmtEur(breakdown.realized)} − {fmtEur(breakdown.cost)} = {fmtEur(breakdown.total)}
            </div>
          )}
          {breakdown.note && <div className="text-[11px] text-slate-400">{breakdown.note}</div>}
          {breakdown.mission && (
            <div className="bg-slate-900/40 border border-slate-800 rounded-lg p-3 text-xs text-slate-300 space-y-1">
              <div><span className="text-slate-500">mission:</span> {breakdown.mission.title}</div>
              <div><span className="text-slate-500">state:</span> {breakdown.mission.state} · <span className="text-slate-500">deadline:</span> {breakdown.mission.deadline} · <span className="text-slate-500">days left:</span> {breakdown.mission.daysRemaining}</div>
            </div>
          )}
          {breakdown.activeExperiments && (
            <div className="space-y-1.5">
              <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Active experiments ({breakdown.activeExperiments.length})</div>
              {breakdown.activeExperiments.length === 0 && <div className="text-xs text-slate-500">No active experiments.</div>}
              {breakdown.activeExperiments.map((e) => (
                <button
                  key={e.id}
                  onClick={() => onExperimentClick(e.id)}
                  className="w-full flex items-center justify-between bg-slate-900/50 hover:bg-slate-800/60 border border-slate-800 rounded-lg px-3 py-2 text-left cursor-pointer"
                >
                  <span className="text-xs text-white font-medium">{e.title}</span>
                  <span className="flex items-center gap-2 text-[10px] text-slate-400">
                    <StatusBadge status={e.status} />
                    {e.nextAction ? `next: ${e.nextAction}` : '—'}
                    <ChevronRight size={12} />
                  </span>
                </button>
              ))}
            </div>
          )}
          {items.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400 font-semibold">
                    <th className="py-2 px-2">Type</th>
                    <th className="py-2 px-2">Amount</th>
                    <th className="py-2 px-2">Source / Category</th>
                    <th className="py-2 px-2">Linked</th>
                    <th className="py-2 px-2">Evidence / Verification</th>
                    <th className="py-2 px-2">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {items.map((it) => (
                    <tr key={it.id} className="hover:bg-slate-900/40">
                      <td className="py-2 px-2"><StatusBadge status={it.entryType} /></td>
                      <td className="py-2 px-2 font-bold text-white">{fmtEur(it.entryType === 'REFUNDED_REVENUE' ? -it.amount : it.amount)}</td>
                      <td className="py-2 px-2 text-slate-300">{it.source || 'system'}<span className="text-slate-500"> · {it.category}</span></td>
                      <td className="py-2 px-2 text-slate-400">
                        {it.experimentId ? (
                          <button className="text-cyan-400 hover:underline cursor-pointer" onClick={() => onExperimentClick(it.experimentId!)}>
                            {(it.experimentTitle || it.experimentId).slice(0, 26)}
                          </button>
                        ) : 'mission-level'}
                        {it.opportunityId ? <div className="text-[9px] text-slate-500">opp: {String(it.opportunityId).slice(0, 18)}</div> : null}
                        {it.channel ? <div className="text-[9px] text-slate-500">channel: {it.channel}</div> : null}
                      </td>
                      <td className="py-2 px-2 text-slate-400">
                        {it.verificationState ? <span className="text-emerald-400">{it.verificationState}</span> :
                          it.evidence && it.evidence.length > 0 ? <span className="text-emerald-400">{String(it.evidence[0]?.title || 'evidence attached')}</span> :
                          <span className="text-slate-500 italic">none</span>}
                        {it.argusState && it.argusState !== 'n/a' ? <div className="text-[9px] text-indigo-400">ARGUS: {it.argusState}</div> : null}
                      </td>
                      <td className="py-2 px-2 text-slate-500 font-mono text-[10px]">{fmtDate(it.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {(breakdown.realizedItems || breakdown.costItems) && (
            <div className="space-y-3">
              {[['Realized revenue entries', breakdown.realizedItems], ['Actual cost entries', breakdown.costItems]].map(([label, rows]: any) => (
                rows && rows.length > 0 ? (
                  <div key={label}>
                    <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1">{label}</div>
                    <div className="space-y-1">
                      {rows.map((it: any) => (
                        <div key={it.id} className="flex items-center justify-between bg-slate-900/50 border border-slate-800 rounded px-3 py-1.5 text-xs">
                          <span className="text-slate-300">{it.entryType} · {it.source || 'system'}{it.experimentTitle ? ` · ${it.experimentTitle}` : ''}</span>
                          <span className="font-bold text-white">{fmtEur(it.entryType === 'REFUNDED_REVENUE' ? -it.amount : it.amount)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null
              ))}
            </div>
          )}
          {items.length === 0 && !breakdown.activeExperiments && !breakdown.formula && (
            <div className="text-xs text-slate-500 py-4 text-center">No persisted records contribute to this KPI yet (€0.00 is real, not fabricated).</div>
          )}
        </div>
      </div>
    </div>
  );
};

// ── Experiment trace drawer ─────────────────────────────────────────────────

const ExperimentDrawer: React.FC<{
  trace: RevenueExperimentTrace;
  onClose: () => void;
}> = ({ trace, onClose }) => {
  const e = trace.experiment;
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-[640px] max-w-[94vw] h-full bg-[#101318] border-l border-slate-700 overflow-y-auto shadow-2xl"
        onClick={(ev) => ev.stopPropagation()}
        data-testid="experiment-drawer"
      >
        <div className="sticky top-0 bg-[#101318] border-b border-slate-800 px-5 py-4 flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-white">{e.product || e.targetCustomer || e.hypothesis}</h3>
              <StatusBadge status={e.status} />
            </div>
            <div className="text-[11px] text-slate-400 mt-1 font-mono">{e.id} · engine: {e.engine}</div>
            <div className="text-[11px] text-slate-400 mt-0.5">
              ARGUS: <span className="text-indigo-300">{trace.argusState}</span>
              {trace.nextAction ? <> · next action: <span className="text-cyan-300">{trace.nextAction}</span></> : ' · terminal state'}
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white"><X size={16} /></button>
        </div>

        <div className="px-5 py-4 space-y-5 text-xs">
          {/* Facts */}
          <section>
            <h4 className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2">Hypothesis & Evidence</h4>
            <p className="text-slate-300 mb-2">{e.hypothesis}</p>
            {e.problem && <p className="text-slate-400"><span className="text-slate-500">problem:</span> {e.problem}</p>}
            {e.offer && <p className="text-slate-400"><span className="text-slate-500">offer:</span> {e.offer}</p>}
            <div className="mt-2 grid grid-cols-3 gap-2">
              <div className="bg-slate-900/50 border border-slate-800 rounded p-2"><div className="text-slate-500 text-[10px]">price</div><div className="text-white font-bold">{e.price != null ? fmtEur(e.price) : '—'}</div></div>
              <div className="bg-slate-900/50 border border-slate-800 rounded p-2"><div className="text-slate-500 text-[10px]">confidence</div><div className="text-white font-bold">{e.confidence != null ? `${Math.round(e.confidence * 100)}%` : '—'}</div></div>
              <div className="bg-slate-900/50 border border-slate-800 rounded p-2"><div className="text-slate-500 text-[10px]">verified rev.</div><div className="text-emerald-300 font-bold">{fmtEur(e.verifiedRevenue)}</div></div>
            </div>
            <div className="mt-2 space-y-1">
              {(e.evidence || []).map((ev: any, i: number) => (
                <div key={i} className="bg-slate-900/40 border border-slate-800 rounded px-2 py-1.5 text-slate-300">
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 font-bold mr-2">{ev.classification || 'UNKNOWN'}</span>
                  {ev.title} {ev.source ? <span className="text-slate-500">({ev.source})</span> : null}
                </div>
              ))}
              {(e.evidence || []).length === 0 && <div className="text-slate-600 italic">no evidence recorded</div>}
            </div>
          </section>

          {/* Canonical execution linkage */}
          <section>
            <h4 className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2">Canonical Execution Runs ({trace.runs.length})</h4>
            {trace.runs.length === 0 && <div className="text-slate-600 italic">no canonical runs linked</div>}
            <div className="space-y-1.5">
              {trace.runs.map((r: any) => (
                <div key={r.id} className="bg-slate-900/50 border border-slate-800 rounded px-2.5 py-2 flex items-center justify-between">
                  <div>
                    <div className="text-white font-medium">{r.worker_type} · {r.provider || '?'} / {r.model || '?'}</div>
                    <div className="text-[10px] text-slate-500 font-mono">{r.id}</div>
                  </div>
                  <StatusBadge status={r.status} />
                </div>
              ))}
            </div>
            {trace.verifications.length > 0 && (
              <div className="mt-2 space-y-1">
                {trace.verifications.map((v: any) => (
                  <div key={v.id} className="bg-emerald-500/5 border border-emerald-500/20 rounded px-2.5 py-1.5 flex items-center justify-between">
                    <span className="text-slate-300">canonical verifier: {v.verifier_provider}/{v.verifier_model}{v.same_provider ? ' ⚠ same provider' : ''}</span>
                    <StatusBadge status={v.verdict} />
                  </div>
                ))}
              </div>
            )}
            {trace.goalStates.length > 0 && (
              <div className="mt-2 space-y-1">
                {trace.goalStates.map((g: any) => (
                  <div key={g.id} className="bg-indigo-500/5 border border-indigo-500/20 rounded px-2.5 py-1.5 flex items-center justify-between">
                    <span className="text-slate-300 font-mono text-[10px]">{g.id}</span>
                    <span className="flex gap-1.5"><StatusBadge status={g.status} /><StatusBadge status={g.verification_state} /></span>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Ledger for this experiment */}
          <section>
            <h4 className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2">Ledger Entries ({trace.ledger.length})</h4>
            {trace.ledger.length === 0 && <div className="text-slate-600 italic">no ledger entries</div>}
            <div className="space-y-1">
              {trace.ledger.map((l) => (
                <div key={l.id} className="flex items-center justify-between bg-slate-900/50 border border-slate-800 rounded px-2.5 py-1.5">
                  <span className="flex items-center gap-2"><StatusBadge status={l.entryType} /><span className="text-slate-400">{l.source || 'system'}</span></span>
                  <span className="font-bold text-white">{fmtEur(l.amount)}</span>
                </div>
              ))}
            </div>
          </section>

          {/* Gates + compliance */}
          <section>
            <h4 className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2">Human Gates ({trace.gates.length}) & Compliance ({trace.compliance.length})</h4>
            {trace.gates.map((g) => (
              <div key={g.id} className="mb-1 flex items-center justify-between bg-amber-500/5 border border-amber-500/20 rounded px-2.5 py-1.5">
                <span className="text-amber-200 flex items-center gap-1.5"><Lock size={11} /> {g.gateType}</span>
                <StatusBadge status={g.status} />
              </div>
            ))}
            {trace.compliance.map((c: any) => (
              <div key={c.id} className="mb-1 bg-slate-900/50 border border-slate-800 rounded px-2.5 py-1.5 text-slate-300">
                {c.companyName || 'record'} · suppression: {c.suppressionState} · review: {c.complianceReviewState}
              </div>
            ))}
            {trace.gates.length === 0 && trace.compliance.length === 0 && <div className="text-slate-600 italic">none</div>}
          </section>

          {/* Lifecycle events */}
          <section>
            <h4 className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2">Lifecycle Events ({trace.events.length})</h4>
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {trace.events.map((ev: any) => (
                <div key={ev.id} className="flex items-center gap-2 bg-slate-900/40 border border-slate-800/60 rounded px-2.5 py-1.5">
                  <GitBranch size={11} className="text-slate-500 shrink-0" />
                  <span className="text-slate-300 font-medium">{ev.eventType}</span>
                  {ev.previousStatus && <span className="text-slate-500">{ev.previousStatus} → {ev.nextStatus}</span>}
                  <span className="ml-auto text-[9px] text-slate-500 font-mono">{fmtDate(ev.createdAt)}</span>
                </div>
              ))}
              {trace.events.length === 0 && <div className="text-slate-600 italic">no events</div>}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};

// ── Main page ───────────────────────────────────────────────────────────────

const RevenueOperatorPage: React.FC = () => {
  const [mission, setMission] = useState<RevenueMission | null>(null);
  const [missionTrace, setMissionTrace] = useState<RevenueMissionTrace | null>(null);
  const [boards, setBoards] = useState<Record<string, RevenueBoard | null>>({ digital_products: null, german_sme: null, pipeline: null });
  const [liveRows, setLiveRows] = useState<RevenueLiveExecutionRow[]>([]);
  const [liveNote, setLiveNote] = useState<string | null>(null);
  const [gateItems, setGateItems] = useState<RevenueGateQueueItem[]>([]);
  const [ledger, setLedger] = useState<RevenueLedgerEntry[]>([]);
  const [experiments, setExperiments] = useState<RevenueExperiment[]>([]);
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [kpiModal, setKpiModal] = useState<{ kpi: RevenueKpiKey; title: string; data: RevenueKpiBreakdown } | null>(null);
  const [drawer, setDrawer] = useState<RevenueExperimentTrace | null>(null);
  const [resolvingGateId, setResolvingGateId] = useState<string | null>(null);
  const [ledgerFilter, setLedgerFilter] = useState<string>('all');

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const missionsList = await revenueOperatorClient.listMissions();
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

      const [trace, dpBoard, smeBoard, pipeBoard, live, gatesQ, ledgerList, expList] = await Promise.all([
        revenueOperatorClient.traceMission(activeMission.id),
        revenueOperatorClient.board(activeMission.id, 'digital_products'),
        revenueOperatorClient.board(activeMission.id, 'german_sme'),
        revenueOperatorClient.board(activeMission.id, 'pipeline'),
        revenueOperatorClient.liveExecution(activeMission.id).catch(() => ({ rows: [] as RevenueLiveExecutionRow[], note: 'live-execution unavailable' })),
        revenueOperatorClient.gateQueue(),
        revenueOperatorClient.listLedger(activeMission.id),
        revenueOperatorClient.listExperiments(activeMission.id),
      ]);
      setMissionTrace(trace);
      setBoards({ digital_products: dpBoard, german_sme: smeBoard, pipeline: pipeBoard });
      setLiveRows(live.rows || []);
      setLiveNote(live.note || null);
      setGateItems(gatesQ);
      setLedger(ledgerList);
      setExperiments(expList);
    } catch (err: any) {
      console.error('Failed to load Revenue Operator data:', err);
      setError(err?.message || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const openKpi = async (kpi: RevenueKpiKey, title: string) => {
    if (!mission) return;
    try {
      const data = await revenueOperatorClient.kpiBreakdown(mission.id, kpi);
      setKpiModal({ kpi, title, data });
    } catch (err: any) {
      setError(`KPI drill-down failed: ${err?.message}`);
    }
  };

  const openExperiment = async (id: string) => {
    setKpiModal(null);
    try {
      const t = await revenueOperatorClient.traceExperiment(id);
      setDrawer(t);
    } catch (err: any) {
      setError(`Experiment trace failed: ${err?.message}`);
    }
  };

  const handleResolveGate = async (gateId: string) => {
    try {
      setResolvingGateId(gateId);
      await revenueOperatorClient.resolveGate(gateId, 'operator-ui');
      await loadData();
    } catch (err: any) {
      alert(`Failed to resolve gate: ${err?.message}`);
    } finally {
      setResolvingGateId(null);
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
      onClick={() => openKpi(kpi, label)}
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
              Revenue Operator <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-medium">Phase 1</span>
            </h1>
            <p className="text-xs text-slate-400">Autonomous Commercial Execution · every KPI traces to persisted records</p>
          </div>
        </div>
        <button
          onClick={loadData}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700 text-xs font-medium text-slate-300 transition-colors"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {error && (
        <div className="mx-8 mt-4 p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
          <AlertTriangle size={14} /> <span>{error}</span>
        </div>
      )}

      {/* KPI strip — every card drills down */}
      <div className="px-8 pt-6 pb-2">
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
            <span className="text-[10px] text-slate-500 mt-1">deadline: {mission?.deadline ?? '—'} · {k?.target.missionState ?? mission?.status ?? '—'}</span>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="px-8 pt-4">
        <div className="flex border-b border-slate-800 gap-6 flex-wrap">
          {([
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
        {/* Overview / Live Execution — canonical, truthful */}
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
                <span className="text-xs text-slate-400">truthful DB statuses — queued is never shown as running</span>
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
                      <th className="py-2.5 px-3">ARGUS State</th>
                      <th className="py-2.5 px-3">Next Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {liveRows.length === 0 ? (
                      <tr><td colSpan={9} className="py-6 text-center text-slate-500">No canonical execution runs linked to this mission yet.</td></tr>
                    ) : liveRows.map((row) => (
                      <tr key={row.runId} className="hover:bg-slate-900/40">
                        <td className="py-2.5 px-3 font-medium text-slate-200 max-w-[220px]">
                          {row.experimentId ? (
                            <button className="text-cyan-300 hover:underline cursor-pointer text-left" onClick={() => openExperiment(row.experimentId!)}>{row.task}</button>
                          ) : row.task}
                        </td>
                        <td className="py-2.5 px-3"><span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-mono text-[10px]">{row.executor}</span></td>
                        <td className="py-2.5 px-3 text-slate-300 font-mono text-[11px]">{row.provider ? `${row.provider}/${row.model || '?'}` : '—'}</td>
                        <td className="py-2.5 px-3 font-mono text-slate-400 text-[10px]">{row.runId.slice(0, 14)}…</td>
                        <td className="py-2.5 px-3"><StatusBadge status={row.status} /></td>
                        <td className="py-2.5 px-3 text-slate-400 font-mono text-[10px]">{fmtElapsed(row.elapsedMs)}</td>
                        <td className="py-2.5 px-3">
                          {row.verification ? (
                            <span className={`px-2 py-0.5 rounded text-[10px] border ${row.verification.verdict === 'PASS' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-slate-800 text-slate-300 border-slate-700'}`}>
                              {row.verification.verdict}{row.verification.sameProvider ? ' ⚠' : ''}
                            </span>
                          ) : <span className="text-slate-600 text-[10px]">not verified</span>}
                        </td>
                        <td className="py-2.5 px-3">
                          {row.argus ? <span className="px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 text-[10px]">{row.argus.verificationState}</span> : <span className="text-slate-600 text-[10px]">—</span>}
                        </td>
                        <td className="py-2.5 px-3 text-slate-400 text-[11px]">{row.nextAction || (row.failureReason ? <span className="text-rose-400">{row.failureReason.slice(0, 40)}</span> : '—')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Engine summary cards from real boards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {[['Digital Products Engine', dpBoard, 'digital_products'], ['German SME Engine', smeBoard, 'german_sme']].map(([title, board, tab]: any) => (
                <div key={title} className="bg-[#151921] border border-slate-800/80 rounded-xl p-5">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-bold text-white flex items-center gap-2">
                      {tab === 'digital_products' ? <Package size={16} className="text-emerald-400" /> : <Building2 size={16} className="text-indigo-400" />} {title}
                    </h3>
                    <button onClick={() => setActiveTab(tab)} className="text-[11px] text-cyan-400 hover:underline flex items-center gap-1 cursor-pointer">Kanban <ChevronRight size={11} /></button>
                  </div>
                  <div className="grid grid-cols-5 gap-2 text-center">
                    {board?.columns.slice(0, 5).map((c: any) => (
                      <div key={c.key} className="bg-slate-900/60 p-2 rounded-lg border border-slate-800">
                        <div className="text-[9px] text-slate-400 truncate">{c.label}</div>
                        <div className="text-base font-bold text-white mt-1">{(board.cards[c.key] || []).length}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Digital Products Kanban */}
        {activeTab === 'digital_products' && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-white">Digital Product Lifecycle — Kanban</h3>
              <span className="text-xs text-slate-400">DISCOVER → VALIDATE → SCORE → GO/NO-GO → BUILD → QA → READY_TO_PUBLISH → PUBLISH → MEASURE → SCALE/ITERATE/KILL</span>
            </div>
            {dpBoard ? <KanbanBoard board={dpBoard} accent="text-emerald-400" onCardClick={(c) => openExperiment(c.id)} /> : <div className="text-slate-500 text-xs">loading…</div>}
          </div>
        )}

        {/* German SME Kanban */}
        {activeTab === 'german_sme' && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-white">German SME Outreach — Kanban</h3>
              <span className="text-xs text-slate-400">compliance-first · outreach requires OUTBOUND_APPROVAL gate</span>
            </div>
            {smeBoard ? <KanbanBoard board={smeBoard} accent="text-indigo-400" onCardClick={(c) => openExperiment(c.id)} /> : <div className="text-slate-500 text-xs">loading…</div>}
          </div>
        )}

        {/* Pipeline Kanban */}
        {activeTab === 'pipeline' && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-white">Pipeline Value — Kanban</h3>
              <span className="text-xs text-slate-400">discovered → qualified → contacted → interested → proposal → won / lost</span>
            </div>
            {pipeBoard ? <KanbanBoard board={pipeBoard} accent="text-indigo-300" onCardClick={(c) => openExperiment(c.id)} /> : <div className="text-slate-500 text-xs">loading…</div>}
          </div>
        )}

        {/* Ledger */}
        {activeTab === 'ledger' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white">Commercial Ledger — itemized</h3>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-slate-400">filter:</span>
                <select
                  value={ledgerFilter}
                  onChange={(e) => setLedgerFilter(e.target.value)}
                  className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200"
                  data-testid="ledger-filter"
                >
                  <option value="all">all types</option>
                  {['PIPELINE_VALUE', 'PROPOSED_VALUE', 'ORDER_VALUE', 'REALIZED_REVENUE', 'VERIFIED_REVENUE', 'REFUNDED_REVENUE', 'ACTUAL_COST', 'NET_REVENUE'].map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="bg-[#151921] border border-slate-800 rounded-xl overflow-hidden">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400 font-semibold bg-slate-900/40">
                    <th className="py-3 px-4">Entry Type</th>
                    <th className="py-3 px-4">Amount</th>
                    <th className="py-3 px-4">Linked Mission/Experiment</th>
                    <th className="py-3 px-4">Source</th>
                    <th className="py-3 px-4">Evidence</th>
                    <th className="py-3 px-4">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {filteredLedger.length === 0 ? (
                    <tr><td colSpan={6} className="py-6 text-center text-slate-500">No ledger entries{ledgerFilter !== 'all' ? ` for ${ledgerFilter}` : ''}.</td></tr>
                  ) : filteredLedger.map((entry) => {
                    const exp = entry.experimentId ? experiments.find((e) => e.id === entry.experimentId) : undefined;
                    return (
                      <tr key={entry.id} className="hover:bg-slate-900/40">
                        <td className="py-3 px-4"><StatusBadge status={entry.entryType} /></td>
                        <td className="py-3 px-4 font-bold text-white">{fmtEur(entry.entryType === 'REFUNDED_REVENUE' ? -entry.amount : entry.amount)}</td>
                        <td className="py-3 px-4">
                          {exp ? (
                            <button className="text-cyan-400 hover:underline cursor-pointer" onClick={() => openExperiment(exp.id)}>
                              {(exp.product || exp.targetCustomer || exp.hypothesis).slice(0, 30)}
                            </button>
                          ) : <span className="text-slate-500">mission-level</span>}
                          <div className="text-[9px] text-slate-600 font-mono">{entry.missionId ? entry.missionId.slice(0, 22) : ''}</div>
                        </td>
                        <td className="py-3 px-4 text-slate-400">{entry.source || 'system'}</td>
                        <td className="py-3 px-4">
                          {entry.status === 'verified' ? <span className="text-emerald-400 text-[11px] flex items-center gap-1"><CheckCircle2 size={12} /> {entry.verifiedBy || 'verified'}</span> :
                            entry.evidence && entry.evidence.length > 0 ? <span className="text-emerald-400/80 text-[11px]">{String(entry.evidence[0]?.title || 'attached')}</span> :
                            <span className="text-slate-500 italic">none</span>}
                        </td>
                        <td className="py-3 px-4 text-slate-500 font-mono text-[10px]">{fmtDate(entry.createdAt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Human Gates — actionable queue */}
        {activeTab === 'gates' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white">Human Required — Actionable Queue</h3>
              <span className="text-xs text-slate-400">{openGates.length} open · {gateItems.length - openGates.length} resolved</span>
            </div>
            {gateItems.length === 0 ? (
              <div className="p-8 text-center bg-[#151921] border border-slate-800 rounded-xl text-slate-500 text-xs">No human gates. All branches operational.</div>
            ) : (
              <div className="space-y-3" data-testid="gate-queue">
                {gateItems.map((gate) => (
                  <div key={gate.id} className={`bg-[#151921] border rounded-xl p-4 ${gate.status === 'open' ? 'border-amber-500/30' : 'border-slate-800'}`}>
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`flex items-center gap-1.5 text-xs font-bold ${gate.status === 'open' ? 'text-amber-300' : 'text-emerald-400'}`}>
                            {gate.status === 'open' ? <Lock size={13} /> : <Check size={13} />} {gate.gateType}
                          </span>
                          <StatusBadge status={gate.status} />
                          {gate.branchPaused && <span className="text-[10px] text-amber-400/80">branch paused</span>}
                          <span className="text-[10px] text-slate-500 font-mono">created {fmtDate(gate.createdAt)}</span>
                        </div>
                        <p className="text-xs text-slate-300 mt-1.5">{gate.description || 'Human confirmation required.'}</p>
                        <p className="text-[11px] text-slate-400 mt-1.5">
                          <span className="text-slate-500">required action:</span> {gate.requiredAction}
                        </p>
                        <p className="text-[11px] text-slate-400 mt-0.5">
                          <span className="text-slate-500">blocking branch:</span>{' '}
                          {typeof gate.blockingBranch === 'string' ? gate.blockingBranch : (
                            <button className="text-cyan-400 hover:underline cursor-pointer" onClick={() => openExperiment((gate.blockingBranch as { experimentId: string }).experimentId)}>
                              {(gate.blockingBranch as { title: string }).title} ({(gate.blockingBranch as { status: string }).status})
                            </button>
                          )}
                        </p>
                        {gate.resolvedAt && <p className="text-[10px] text-emerald-500/80 mt-1">resolved by {gate.resolvedBy} at {fmtDate(gate.resolvedAt)}</p>}
                      </div>
                      {gate.status === 'open' && (
                        <button
                          onClick={() => handleResolveGate(gate.id)}
                          disabled={resolvingGateId === gate.id}
                          className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow transition-colors flex items-center gap-1.5 shrink-0"
                        >
                          {resolvingGateId === gate.id ? <RefreshCw size={12} className="animate-spin" /> : <Check size={12} />} Resolve
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Modals / drawers */}
      {kpiModal && (
        <KpiModal
          title={kpiModal.title}
          breakdown={kpiModal.data}
          onClose={() => setKpiModal(null)}
          onExperimentClick={openExperiment}
        />
      )}
      {drawer && <ExperimentDrawer trace={drawer} onClose={() => setDrawer(null)} />}
    </div>
  );
};

export default RevenueOperatorPage;
