// @ts-nocheck
import React from 'react';
import { useData } from '../../store/dataStore';
import { AlertTriangle, CheckCircle, XCircle, Activity, Shield, Clock, HardDrive } from 'lucide-react';

const Diagnostics: React.FC = () => {
  const { providers, runs, runtimes } = useData();

  const providerList = providers || [];
  const runList = runs || [];
  const rtList = runtimes || [];

  const errorProviders = providerList.filter((p: any) => p.status === 'error' || p.status === 'needs-auth');
  const failedRuns = runList.filter((r: any) => r.status === 'failed');
  const unhealthyRuntimes = rtList.filter((r: any) => r.health?.status !== 'healthy');
  const totalIssues = errorProviders.length + failedRuns.length + unhealthyRuntimes.length;

  return (
    <div className="jarvis-diagnostics">
      <div className="jarvis-diagnostics__header">
        <h2>System Diagnostics</h2>
        <div className={`diagnostics-summary ${totalIssues === 0 ? 'healthy' : 'issues'}`}>
          {totalIssues === 0 ? (
            <><CheckCircle size={16} /> All Systems Nominal</>
          ) : (
            <><AlertTriangle size={16} /> {totalIssues} Issue{totalIssues !== 1 ? 's' : ''} Detected</>
          )}
        </div>
      </div>

      <div className="diagnostics-grid">
        {/* Runtime Health */}
        <div className="jarvis-widget">
          <div className="jarvis-widget__header">
            <Cpu size={16} />
            <h3>Runtime Health</h3>
          </div>
          <div className="jarvis-widget__body">
            {rtList.map((rt: any) => (
              <div key={rt.id} className="diagnostics-row">
                <div className="diagnostics-row__label">{rt.label}</div>
                <div className="diagnostics-row__value">
                  {rt.health?.status === 'healthy' ? (
                    <span className="status-badge status-badge--success">
                      <span className="status-badge__dot" /> Healthy
                    </span>
                  ) : (
                    <span className="status-badge status-badge--error">
                      <span className="status-badge__dot" /> Unhealthy
                    </span>
                  )}
                  {rt.health?.latencyMs && (
                    <span className="text-xxs text-dim">{rt.health.latencyMs}ms</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Provider Alerts */}
        <div className="jarvis-widget">
          <div className="jarvis-widget__header">
            <HardDrive size={16} />
            <h3>Provider Status</h3>
          </div>
          <div className="jarvis-widget__body">
            {errorProviders.length === 0 ? (
              <div className="jarvis-empty">All providers connected</div>
            ) : (
              errorProviders.map((p: any) => (
                <div key={p.id} className="diagnostics-row">
                  <div className="diagnostics-row__label">{p.name}</div>
                  <div className="diagnostics-row__value">
                    <span className="status-badge status-badge--error">
                      <span className="status-badge__dot" /> {p.errorMessage || p.status}
                    </span>
                  </div>
                </div>
              ))
            )}
            <div className="diagnostics-meta">
              {providerList.length} total · {providerList.filter((p: any) => p.status === 'connected').length} connected
            </div>
          </div>
        </div>

        {/* Failed Runs */}
        <div className="jarvis-widget">
          <div className="jarvis-widget__header">
            <XCircle size={16} />
            <h3>Failed Executions</h3>
          </div>
          <div className="jarvis-widget__body">
            {failedRuns.length === 0 ? (
              <div className="jarvis-empty">No recent failures</div>
            ) : (
              failedRuns.map((r: any) => (
                <div key={r.id} className="diagnostics-row">
                  <div className="diagnostics-row__label">Run {r.id.slice(0, 8)}</div>
                  <div className="diagnostics-row__value text-xs text-dim">
                    {r.errorMessage?.slice(0, 60)}
                    <Clock size={10} />
                    {new Date(r.updatedAt).toLocaleString()}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* System Overview */}
        <div className="jarvis-widget">
          <div className="jarvis-widget__header">
            <Shield size={16} />
            <h3>System Overview</h3>
          </div>
          <div className="jarvis-widget__body">
            <div className="diagnostics-row">
              <span>Active Agents</span>
              <span>{providerList.filter((p: any) => p.status === 'connected').length}</span>
            </div>
            <div className="diagnostics-row">
              <span>Total Runtimes</span>
              <span>{rtList.length}</span>
            </div>
            <div className="diagnostics-row">
              <span>Failed Runs (24h)</span>
              <span style={{ color: 'var(--color-error)' }}>{failedRuns.length}</span>
            </div>
            <div className="diagnostics-row">
              <span>Provider Issues</span>
              <span style={{ color: errorProviders.length > 0 ? 'var(--color-warning)' : 'var(--color-success)' }}>
                {errorProviders.length}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Diagnostics;