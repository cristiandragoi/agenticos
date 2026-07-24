import { useData } from '../store/dataStore';
import React, { useState, useEffect } from 'react';
import { Network, Settings, RefreshCw, Zap, Search, Shield, Globe } from 'lucide-react';
import EntityCard from '../components/ui/EntityCard';
import { revenueClient, type RevenueOpportunity } from '../api/revenueClient';

const PipelineBoard: React.FC = () => {
  const { isLoading } = useData();
  const [pipelineActive, setPipelineActive] = useState(false);
  const [metrics, setMetrics] = useState<any>(null);
  const [intelligence, setIntelligence] = useState<any>(null);

  useEffect(() => {
    revenueClient.getMetrics().then(setMetrics).catch(console.error);
    revenueClient.getIntelligenceSummary().then(setIntelligence).catch(console.error);
  }, []);

  if (isLoading || !metrics) return null;

  const getCount = (stages: string[]) => {
    let count = 0;
    stages.forEach(s => { count += (metrics.countsByStage[s] || 0) });
    return count;
  };

  return (
    <div style={{ 
      display: 'flex', flexDirection: 'column', height: '100%',
      backgroundImage: "linear-gradient(to bottom, rgba(10, 10, 12, 0.8), rgba(10, 10, 12, 0.95)), url('/bg/bg_pipeline.png')", 
      backgroundSize: 'cover', backgroundPosition: 'center', backgroundAttachment: 'fixed'
    }}>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '24px 32px' }}>
        <div className="page-header__title">
          <h1 style={{ color: 'white' }}>Revenue Engine Pipeline</h1>
          <p style={{ color: 'var(--text-secondary)' }}>Visual flow of opportunities across the agent network. Total Active: {metrics.totalOpportunities}</p>
          <div style={{ display: 'flex', gap: '16px', marginTop: '12px', fontSize: '13px', color: '#ccc', flexWrap: 'wrap' }}>
            <span style={{ background: 'var(--bg-elevated)', padding: '4px 12px', borderRadius: '16px', border: '1px solid var(--border-subtle)' }}>
              🎯 Avg Score: <strong>{metrics.averageOverallScore}/100</strong>
            </span>
            <span style={{ background: 'var(--bg-elevated)', padding: '4px 12px', borderRadius: '16px', border: '1px solid var(--border-subtle)' }}>
              📊 Avg Ev. Quality: <strong>{metrics.averageEvidenceQuality}/100</strong>
            </span>
            <span style={{ background: 'var(--bg-elevated)', padding: '4px 12px', borderRadius: '16px', border: '1px solid var(--border-subtle)' }}>
              ⚙️ Failure Rate: <strong>{metrics.failureRate}%</strong>
            </span>
            <span style={{ background: 'var(--bg-elevated)', padding: '4px 12px', borderRadius: '16px', border: '1px solid var(--border-subtle)' }}>
              💸 Avg Gen Cost: <strong>${metrics.avgGenCost}</strong>
            </span>
            <span style={{ background: 'var(--bg-elevated)', padding: '4px 12px', borderRadius: '16px', border: '1px solid var(--border-subtle)' }}>
              📦 Total Assets: <strong>{metrics.totalAssets}</strong>
            </span>
            {metrics.lowConfidenceCount > 0 && (
              <span style={{ background: 'rgba(239, 68, 68, 0.2)', padding: '4px 12px', borderRadius: '16px', border: '1px solid #ef4444', color: '#ef4444' }}>
                ⚠️ {metrics.lowConfidenceCount} Low Confidence Scores
              </span>
            )}
          </div>
        </div>
        <button 
          className="search-trigger"
          onClick={() => setPipelineActive(!pipelineActive)}
          style={{ 
            color: '#fff', border: 'none', padding: '8px 16px', borderRadius: 8,
            background: pipelineActive ? 'var(--color-info)' : 'var(--bg-elevated)',
            display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer'
          }}
        >
          {pipelineActive ? <RefreshCw size={16} className="animate-spin" /> : <Zap size={16} />}
          {pipelineActive ? 'Pipeline Running' : 'Trigger Pipeline'}
        </button>
      </div>

      <div className="board-layout" style={{ overflowX: 'auto', padding: '24px 32px', alignItems: 'flex-start', display: 'flex', gap: '24px' }}>
        {/* Stage 1: Ingestion */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', minWidth: '320px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
            <div style={{ width: '32px', height: '32px', borderRadius: '50%', backgroundColor: 'var(--bg-elevated)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }}>1</div>
            <h3 style={{ fontSize: '18px', fontWeight: 'bold', color: 'var(--text-primary)', margin: 0 }}>Ingestion & Discovery</h3>
          </div>
          <div style={{ padding: '16px', backgroundColor: 'var(--bg-glass)', border: '1px solid var(--border-subtle)', borderRadius: '12px', position: 'relative' }}>
            <div style={{ position: 'absolute', top: -10, right: -10, background: '#3b82f6', color: 'white', padding: '2px 8px', borderRadius: 12, fontSize: 12, fontWeight: 'bold' }}>
              {getCount(['discovered'])} queued
            </div>
            <EntityCard
              title="Jarvis"
              preview="Opportunity Intake"
              tags={['Router', 'Active']}
              meta={[{ icon: <Network size={14} />, label: 'OmniRoute' }]}
              status={pipelineActive ? 'running' : 'connected'}
              accent="var(--color-jarvis)"
            />
          </div>
        </div>

        {/* Stage 2: Planning & Research */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', minWidth: '320px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
            <div style={{ width: '32px', height: '32px', borderRadius: '50%', backgroundColor: 'var(--bg-elevated)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }}>2</div>
            <h3 style={{ fontSize: '18px', fontWeight: 'bold', color: 'var(--text-primary)', margin: 0 }}>Research & Approval</h3>
          </div>
          <div style={{ padding: '16px', backgroundColor: 'var(--bg-glass)', border: '1px solid var(--border-subtle)', borderRadius: '12px', display: 'flex', flexDirection: 'column', gap: '16px', position: 'relative' }}>
            <div style={{ position: 'absolute', top: -10, right: -10, background: '#f59e0b', color: 'white', padding: '2px 8px', borderRadius: 12, fontSize: 12, fontWeight: 'bold' }}>
              {getCount(['researching', 'scored', 'awaiting_approval'])} evaluating
            </div>
            <EntityCard
              title="Unavailable agent"
              preview="Evidence Gathering"
              tags={['Research']}
              meta={[{ icon: <Search size={14} />, label: 'Unavailable' }]}
              status="connected"
              accent="#8b5cf6"
            />
            <EntityCard
              title="Architect"
              preview="Scoring & Approvals"
              tags={['Planning', 'Active']}
              meta={[{ icon: <Settings size={14} />, label: 'DeepSeek' }]}
              status={pipelineActive ? 'running' : 'connected'}
              accent="#f59e0b"
            />
          </div>
        </div>

        {/* Stage 3: Execution */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', minWidth: '320px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
            <div style={{ width: '32px', height: '32px', borderRadius: '50%', backgroundColor: 'var(--bg-elevated)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }}>3</div>
            <h3 style={{ fontSize: '18px', fontWeight: 'bold', color: 'var(--text-primary)', margin: 0 }}>Execution & Gen</h3>
          </div>
          <div style={{ padding: '16px', backgroundColor: 'var(--bg-glass)', border: '1px solid var(--border-subtle)', borderRadius: '12px', display: 'flex', flexDirection: 'column', gap: '16px', position: 'relative' }}>
             <div style={{ position: 'absolute', top: -10, right: -10, background: '#10b981', color: 'white', padding: '2px 8px', borderRadius: 12, fontSize: 12, fontWeight: 'bold' }}>
              {getCount(['approved', 'in_production'])} generating
            </div>
            <EntityCard
              title="CodeX"
              preview="Asset Generation"
              tags={['Coding', 'High-Load']}
              meta={[{ icon: <Zap size={14} />, label: 'OmniRoute' }]}
              status={pipelineActive ? 'running' : 'connected'}
              accent="#10b981"
            />
            <EntityCard
              title="Sentinel"
              preview="Compliance & QA"
              tags={['Review']}
              meta={[{ icon: <Shield size={14} />, label: 'Qwen' }]}
              status="connected"
              accent="#ef4444"
            />
          </div>
        </div>

        {/* Stage 4: Output */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', minWidth: '320px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
            <div style={{ width: '32px', height: '32px', borderRadius: '50%', backgroundColor: 'var(--bg-elevated)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }}>4</div>
            <h3 style={{ fontSize: '18px', fontWeight: 'bold', color: 'var(--text-primary)', margin: 0 }}>Publishing</h3>
          </div>
          <div style={{ padding: '16px', backgroundColor: 'var(--bg-glass)', border: '1px solid var(--border-subtle)', borderRadius: '12px', position: 'relative' }}>
             <div style={{ position: 'absolute', top: -10, right: -10, background: '#06b6d4', color: 'white', padding: '2px 8px', borderRadius: 12, fontSize: 12, fontWeight: 'bold' }}>
              {getCount(['published', 'measuring'])} live
            </div>
            <EntityCard
              title="Hermes"
              preview="Delivery & Tracking"
              tags={['Output', 'Active']}
              meta={[{ icon: <Globe size={14} />, label: 'OmniRoute' }]}
              status={pipelineActive ? 'running' : 'connected'}
              accent="#06b6d4"
            />
          </div>
        </div>

        {/* Stage 5: Intelligence & Attribution */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', minWidth: '320px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
            <div style={{ width: '32px', height: '32px', borderRadius: '50%', backgroundColor: 'var(--bg-elevated)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }}>5</div>
            <h3 style={{ fontSize: '18px', fontWeight: 'bold', color: 'var(--text-primary)', margin: 0 }}>Intelligence</h3>
          </div>
          <div style={{ padding: '16px', backgroundColor: 'var(--bg-glass)', border: '1px solid var(--border-subtle)', borderRadius: '12px', position: 'relative', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ position: 'absolute', top: -10, right: -10, background: '#ec4899', color: 'white', padding: '2px 8px', borderRadius: 12, fontSize: 12, fontWeight: 'bold' }}>
              measuring
            </div>
            <EntityCard
              title="Qwythos"
              preview="Attribution & Analytics"
              tags={['Intelligence', 'Active']}
              meta={[{ icon: <Network size={14} />, label: 'OmniRoute' }]}
              status={pipelineActive ? 'running' : 'connected'}
              accent="#ec4899"
            />
            
            {intelligence && (
              <div style={{ padding: '12px', background: 'rgba(236, 72, 153, 0.1)', border: '1px solid rgba(236, 72, 153, 0.3)', borderRadius: '8px', color: '#fbcfe8', fontSize: '13px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
                  <div>
                    <div style={{ color: 'rgba(251, 207, 232, 0.7)', fontSize: '11px', textTransform: 'uppercase' }}>Total Rev</div>
                    <div style={{ fontWeight: 'bold', fontSize: '16px', color: '#ec4899' }}>${intelligence.revenue?.toLocaleString() || '0'}</div>
                  </div>
                  <div>
                    <div style={{ color: 'rgba(251, 207, 232, 0.7)', fontSize: '11px', textTransform: 'uppercase' }}>Profit</div>
                    <div style={{ fontWeight: 'bold', fontSize: '16px', color: '#10b981' }}>${intelligence.profit?.toLocaleString() || '0'}</div>
                  </div>
                  <div>
                    <div style={{ color: 'rgba(251, 207, 232, 0.7)', fontSize: '11px', textTransform: 'uppercase' }}>Spend</div>
                    <div style={{ fontWeight: 'bold' }}>${intelligence.cost?.toLocaleString() || '0'}</div>
                  </div>
                  <div>
                    <div style={{ color: 'rgba(251, 207, 232, 0.7)', fontSize: '11px', textTransform: 'uppercase' }}>Avg ROI</div>
                    <div style={{ fontWeight: 'bold', color: '#f59e0b' }}>{intelligence.roi?.toFixed(2) || '0.00'}x</div>
                  </div>
                </div>
                {intelligence.lowConfidenceAttributions > 0 && (
                  <div style={{ marginTop: '8px', padding: '6px', background: 'rgba(239, 68, 68, 0.2)', border: '1px solid #ef4444', borderRadius: '4px', color: '#ef4444', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Shield size={12} />
                    {intelligence.lowConfidenceAttributions} Low-confidence attributions flagged
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default PipelineBoard;
