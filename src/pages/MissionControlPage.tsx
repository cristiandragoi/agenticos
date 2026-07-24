// @ts-nocheck
import React, { useMemo } from 'react';
import { Activity, AlertTriangle, Bot, CheckCircle2, Clock, Cpu, Database, GitBranch, Radio, Server, Settings } from 'lucide-react';
import { useData } from '../store/dataStore';

function statusLabel(value?: string | null) {
  return value || 'Unknown';
}

function providerModel(provider: any) {
  if (!provider) return 'Unknown';
  if (!provider.defaultModel) return 'Not configured';
  const configuredModel = provider.models?.find((model: any) => model.id === provider.defaultModel);
  return configuredModel?.displayName || provider.defaultModel;
}

function cleanError(message?: string | null) {
  if (!message) return 'No details available.';
  const firstLine = String(message).split('\n')[0];
  return firstLine.replace(/\s+at\s+.*/i, '').slice(0, 180);
}

const MetricCard = ({ icon, title, value, detail, tone = 'neutral' }: any) => {
  const color = tone === 'bad' ? '#f87171' : tone === 'warn' ? '#f59e0b' : tone === 'good' ? '#34d399' : '#94a3b8';
  return (
    <div className="rounded-md border border-slate-800 bg-slate-950/70 p-4" data-testid={`mission-metric-${title.toLowerCase().replace(/\s+/g, '-')}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="text-[11px] font-bold uppercase tracking-widest text-slate-500">{title}</div>
        <div style={{ color }}>{icon}</div>
      </div>
      <div className="mt-3 text-2xl font-semibold text-slate-100">{value}</div>
      <div className="mt-1 text-xs text-slate-500">{detail}</div>
    </div>
  );
};

const ListPanel = ({ title, empty, children }: any) => (
  <section className="rounded-md border border-slate-800 bg-slate-950/60">
    <div className="border-b border-slate-800 px-4 py-3">
      <h2 className="text-xs font-bold uppercase tracking-widest text-slate-400">{title}</h2>
    </div>
    <div className="divide-y divide-slate-800">
      {children || <div className="px-4 py-5 text-sm text-slate-500">{empty}</div>}
    </div>
  </section>
);

const Row = ({ title, subtitle, meta, tone = 'neutral' }: any) => {
  const color = tone === 'bad' ? 'text-rose-300' : tone === 'warn' ? 'text-amber-300' : tone === 'good' ? 'text-emerald-300' : 'text-slate-300';
  return (
    <div className="px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className={`truncate text-sm font-medium ${color}`}>{title}</div>
          {subtitle && <div className="mt-1 line-clamp-2 text-xs text-slate-500">{subtitle}</div>}
        </div>
        {meta && <div className="shrink-0 text-[11px] uppercase tracking-wider text-slate-500">{meta}</div>}
      </div>
    </div>
  );
};

const MissionControlPage: React.FC = () => {
  const { agents, providers, runs, runtimes, schedules, isLoading, error, refresh } = useData();

  const agentById = useMemo(() => new Map(agents.map((agent: any) => [agent.id, agent])), [agents]);
  const runningRuns = runs.filter((run: any) => ['running', 'queued', 'executing'].includes(run.status));
  const pendingApprovals = runs.filter((run: any) => ['waiting', 'waiting_for_approval', 'approval_required'].includes(run.status));
  const failedRuns = runs.filter((run: any) => run.status === 'failed');
  const completedRuns = runs.filter((run: any) => run.status === 'completed').slice(0, 5);
  const connectedProviders = providers.filter((provider: any) => ['connected', 'healthy', 'active'].includes(provider.status));
  const unhealthyProviders = providers.filter((provider: any) => ['error', 'unavailable', 'disconnected', 'needs-auth'].includes(provider.status));
  const agentTeamsRuns = runs.filter((run: any) => String(run.mode || '').includes('team') || String(run.agentId || '').includes('team'));
  const codexRuns = runs.filter((run: any) => String(run.agentId || '').toLowerCase().includes('codex') || String(run.runtimeId || '').toLowerCase().includes('codex'));
  const pipelines = runs.filter((run: any) => ['workflow', 'pipeline'].includes(run.mode));

  if (isLoading) return null;

  return (
    <div className="h-full overflow-auto bg-[#0a0f16] text-slate-100" data-testid="mission-control-cockpit">
      <div className="mx-auto flex max-w-7xl flex-col gap-5 px-6 py-6">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-800 pb-5">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-widest text-cyan-400">Workspace</div>
            <h1 className="mt-1 text-2xl font-semibold">Mission Control</h1>
            <p className="mt-1 text-sm text-slate-500">Operational cockpit for health, providers, agents, executions, approvals, and alerts.</p>
          </div>
          <button
            type="button"
            onClick={refresh}
            className="rounded border border-slate-700 px-3 py-2 text-xs font-medium text-slate-300 hover:bg-slate-800"
          >
            Retry
          </button>
        </header>

        {error && (
          <div className="rounded-md border border-rose-500/40 bg-rose-500/10 p-4" data-testid="mission-error-card">
            <div className="flex items-center gap-2 text-sm font-semibold text-rose-200">
              <AlertTriangle size={16} /> Backend unavailable
            </div>
            <p className="mt-2 text-sm text-rose-100">{cleanError(error)}</p>
            <div className="mt-3 flex gap-2">
              <button onClick={refresh} className="rounded border border-rose-400/50 px-3 py-1.5 text-xs text-rose-100">Retry</button>
              <button type="button" className="rounded border border-slate-700 px-3 py-1.5 text-xs text-slate-400">Open diagnostics</button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard icon={<Server size={18} />} title="Backend Health" value={error ? 'Unavailable' : 'Available'} detail={`${runtimes.length || 0} runtime${runtimes.length === 1 ? '' : 's'} registered`} tone={error ? 'bad' : 'good'} />
          <MetricCard icon={<Cpu size={18} />} title="Providers" value={`${connectedProviders.length}/${providers.length}`} detail={providers.length ? 'connected providers' : 'No provider registry data'} tone={unhealthyProviders.length ? 'warn' : 'good'} />
          <MetricCard icon={<Bot size={18} />} title="Agents Online" value={agents.filter((agent: any) => agent.status === 'active').length} detail={`${agents.length || 0} registered agent${agents.length === 1 ? '' : 's'}`} tone="neutral" />
          <MetricCard icon={<Activity size={18} />} title="Active Executions" value={runningRuns.length} detail={`${pendingApprovals.length} pending approval${pendingApprovals.length === 1 ? '' : 's'}`} tone={pendingApprovals.length ? 'warn' : 'neutral'} />
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <ListPanel title="Providers and Models" empty="No provider registry data.">
            {providers.slice(0, 6).map((provider: any) => (
              <Row
                key={provider.id}
                title={provider.name || provider.id || 'Unknown provider'}
                subtitle={`Model: ${providerModel(provider)}`}
                meta={statusLabel(provider.status)}
                tone={['connected', 'healthy', 'active'].includes(provider.status) ? 'good' : provider.status ? 'warn' : 'neutral'}
              />
            ))}
          </ListPanel>

          <ListPanel title="Registered Agents" empty="No registered agents returned by the backend.">
            {agents.slice(0, 8).map((agent: any) => (
              <Row
                key={agent.id}
                title={agent.name || agent.id || 'Unknown agent'}
                subtitle={agent.description || agent.kind || 'No description available.'}
                meta={statusLabel(agent.status)}
                tone={agent.status === 'active' ? 'good' : 'neutral'}
              />
            ))}
          </ListPanel>

          <ListPanel title="Pending Approvals" empty="No pending approvals.">
            {pendingApprovals.slice(0, 6).map((run: any) => (
              <Row
                key={run.id}
                title={run.input || `Run ${run.id}`}
                subtitle={agentById.get(run.agentId)?.name || run.agentId || 'Unknown agent'}
                meta={statusLabel(run.status)}
                tone="warn"
              />
            ))}
          </ListPanel>
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <ListPanel title="Active Executions" empty="No active executions.">
            {runningRuns.slice(0, 6).map((run: any) => (
              <Row key={run.id} title={run.input || `Run ${run.id}`} subtitle={agentById.get(run.agentId)?.name || run.agentId || 'Unknown agent'} meta={statusLabel(run.status)} tone="good" />
            ))}
          </ListPanel>

          <ListPanel title="Failed Runs and Alerts" empty="No failed runs or provider alerts.">
            {[...failedRuns.map((run: any) => ({ id: run.id, title: run.input || `Run ${run.id}`, subtitle: cleanError(run.errorMessage || run.output), meta: statusLabel(run.status) })),
              ...unhealthyProviders.map((provider: any) => ({ id: provider.id, title: provider.name || provider.id, subtitle: cleanError(provider.errorMessage || 'Provider unavailable or not configured.'), meta: statusLabel(provider.status) }))]
              .slice(0, 6)
              .map((item: any) => <Row key={item.id} title={item.title} subtitle={item.subtitle} meta={item.meta} tone="bad" />)}
          </ListPanel>
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-4">
          <MetricCard icon={<CheckCircle2 size={18} />} title="Recent Completed" value={completedRuns.length} detail={completedRuns[0]?.input || 'No completed runs'} />
          <MetricCard icon={<Radio size={18} />} title="Agent Teams Activity" value={agentTeamsRuns.length} detail={agentTeamsRuns[0]?.status || 'No team activity'} />
          <MetricCard icon={<GitBranch size={18} />} title="CodeX Activity" value={codexRuns.length} detail={codexRuns[0]?.status || 'No CodeX runs'} />
          <MetricCard icon={<Clock size={18} />} title="Schedules" value={schedules.length || 0} detail={schedules.length ? 'registered schedules' : 'No schedules configured'} />
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <ListPanel title="Pipelines" empty="No active pipeline runs.">
            {pipelines.slice(0, 5).map((run: any) => <Row key={run.id} title={run.input || `Pipeline ${run.id}`} subtitle={agentById.get(run.agentId)?.name || run.agentId || 'Unknown agent'} meta={statusLabel(run.status)} />)}
          </ListPanel>
          <ListPanel title="System Registry" empty="No registry data.">
            <Row title="Memory" subtitle="Workspace memory scopes returned by backend." meta="Live" />
            <Row title="Models & Providers" subtitle={providers.length ? `${providers.length} provider records` : 'No provider data'} meta={providers.length ? 'Live' : 'Unknown'} />
            <Row title="Automations" subtitle={schedules.length ? `${schedules.length} schedules` : 'No schedules configured'} meta={schedules.length ? 'Live' : 'Not configured'} />
            <Row title="Settings" subtitle="System settings page available from navigation." meta="Available" />
          </ListPanel>
        </div>
      </div>
    </div>
  );
};

export default MissionControlPage;
