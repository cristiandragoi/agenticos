// @ts-nocheck
import React, { useState, useEffect } from 'react';
import { Clapperboard, Plus, Clock, CheckCircle, XCircle, Film, Monitor, Zap, LayoutDashboard } from 'lucide-react';
import StatusBadge from '../components/ui/StatusBadge';
import { apiFetch, apiUrl } from '../api/client';

type VideoFormat = 'vertical-short' | 'landscape-long' | 'animated' | 'screen-record';
type VideoStage = 'scripting' | 'asset-gathering' | 'rendering' | 'review' | 'publish';

interface VideoJob {
  id: string;
  agentId: string;
  request: { prompt: string; format: VideoFormat; targetDurationSeconds?: number };
  stage: VideoStage;
  status: 'queued' | 'running' | 'completed' | 'failed';
  artifactId?: string;
  runId: string;
  createdAt: string;
  updatedAt: string;
}

const STAGE_ORDER: VideoStage[] = ['scripting', 'asset-gathering', 'rendering', 'review', 'publish'];

const FORMAT_ICONS: Record<VideoFormat, React.ReactNode> = {
  'vertical-short': <Film size={12} />,
  'landscape-long': <Monitor size={12} />,
  'animated': <Zap size={12} />,
  'screen-record': <LayoutDashboard size={12} />,
};

const FORMAT_COLORS: Record<VideoFormat, string> = {
  'vertical-short': '#c084fc',
  'landscape-long': '#63b3ed',
  'animated': '#fb923c',
  'screen-record': '#34d399',
};



const StagePipeline: React.FC<{ currentStage: VideoStage; status: string }> = ({ currentStage, status }) => {
  const currentIdx = STAGE_ORDER.indexOf(currentStage);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 2, marginTop: 6, marginBottom: 6 }}>
      {STAGE_ORDER.map((stage, idx) => {
        const done = idx < currentIdx;
        const active = idx === currentIdx;
        const pending = idx > currentIdx;
        return (
          <React.Fragment key={stage}>
            <div style={{
              padding: '2px 6px', borderRadius: 3, fontSize: '0.65rem', whiteSpace: 'nowrap',
              background: done ? 'var(--color-success)22' : active ? 'var(--color-info)22' : 'var(--bg-glass)',
              color: done ? 'var(--color-success)' : active ? 'var(--color-info)' : 'var(--text-dim)',
              border: `1px solid ${done ? 'var(--color-success)' : active ? 'var(--color-info)' : 'var(--border-glass)'}44`,
              fontWeight: active ? 600 : 400,
            }}>
              {stage.replace('-', ' ')}
            </div>
            {idx < STAGE_ORDER.length - 1 && (
              <div style={{ width: 8, height: 1, background: done ? 'var(--color-success)' : 'var(--border-glass)', flexShrink: 0 }} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
};

const VideoBoard: React.FC = () => {
  const [jobs, setJobs] = useState<VideoJob[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newPrompt, setNewPrompt] = useState('');
  const [newFormat, setNewFormat] = useState<VideoFormat>('landscape-long');
  const [newDuration, setNewDuration] = useState(60);
  const [selectedJob, setSelectedJob] = useState<VideoJob | null>(null);
  const [creating, setCreating] = useState(false);

  const fetchJobs = async () => {
    try {
      const res = await apiFetch('/api/video/jobs');
      if (res.ok) setJobs(await res.json());
    } catch (err) {
      console.error('Failed to fetch video jobs', err);
    }
  };

  useEffect(() => {
    fetchJobs();
    const interval = setInterval(fetchJobs, 2000);
    return () => clearInterval(interval);
  }, []);

  // Subscribe to SSE for running jobs
  useEffect(() => {
    const controllers: AbortController[] = [];
    jobs.filter(j => j.status === 'running').forEach(job => {
      const ctrl = new AbortController();
      controllers.push(ctrl);
      const es = new EventSource(apiUrl(`/api/video/stream/${job.id}`));
      es.addEventListener('video_stage', (e) => {
        const data = JSON.parse(e.data);
        setJobs(prev => prev.map(j => j.id === job.id
          ? { ...j, stage: data.stage, status: data.status === 'completed' ? 'completed' : 'running', artifactId: data.artifactId }
          : j
        ));
        if (data.status === 'completed') es.close();
      });
      es.onerror = () => es.close();
    });
    return () => { controllers.forEach(c => c.abort()); };
  }, []);

  const createJob = async () => {
    if (!newPrompt.trim()) return;
    setCreating(true);
    try {
      const res = await apiFetch('/api/video/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: newPrompt, format: newFormat, targetDurationSeconds: newDuration }),
      });
      if (res.ok) {
        const job = await res.json();
        setJobs(prev => [job, ...prev]);
        setShowCreateModal(false);
        setNewPrompt('');
        // Subscribe to new job's SSE
        const es = new EventSource(apiUrl(`/api/video/stream/${job.id}`));
        es.addEventListener('video_stage', (e) => {
          const data = JSON.parse(e.data);
          setJobs(prev => prev.map(j => j.id === job.id
            ? { ...j, stage: data.stage, status: data.status === 'completed' ? 'completed' : 'running', artifactId: data.artifactId }
            : j
          ));
          if (data.status === 'completed') es.close();
        });
      }
    } finally {
      setCreating(false);
    }
  };

  const stageCols: Record<VideoStage | 'completed', VideoJob[]> = {
    'scripting': jobs.filter(j => j.status !== 'completed' && j.stage === 'scripting'),
    'asset-gathering': jobs.filter(j => j.status !== 'completed' && j.stage === 'asset-gathering'),
    'rendering': jobs.filter(j => j.status !== 'completed' && j.stage === 'rendering'),
    'review': jobs.filter(j => j.status !== 'completed' && j.stage === 'review'),
    'publish': jobs.filter(j => j.status !== 'completed' && j.stage === 'publish'),
    'completed': jobs.filter(j => j.status === 'completed'),
  };

  const colOrder: (VideoStage | 'completed')[] = ['scripting', 'asset-gathering', 'rendering', 'review', 'completed'];

  return (
    <div className="flex-col h-full" style={{ 
      backgroundImage: "linear-gradient(to bottom, rgba(10, 10, 12, 0.8), rgba(10, 10, 12, 0.95)), url('/bg/bg_video.png')", 
      backgroundSize: 'cover', backgroundPosition: 'center', backgroundAttachment: 'fixed'
    }}>
      <div className="page-header">
        <div className="page-header__title">
          <h1>Video-Agent Pipeline</h1>
          <p>Multi-stage video production: scripting, asset gathering, rendering, review, and publish.</p>
        </div>
        <button className="btn btn--primary" style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          onClick={() => setShowCreateModal(true)}>
          <Plus size={14} /> New Video Job
        </button>
      </div>

      {showCreateModal && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
        }} onClick={() => setShowCreateModal(false)}>
          <div style={{
            background: 'var(--bg-surface)', border: '1px solid var(--border-glass)', borderRadius: 12,
            padding: 24, width: 480, maxWidth: '90vw',
          }} onClick={e => e.stopPropagation()}>
            <h3 style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Clapperboard size={16} /> New Video Job
            </h3>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Prompt</label>
              <textarea
                value={newPrompt}
                onChange={e => setNewPrompt(e.target.value)}
                placeholder="Describe the video you want to produce..."
                style={{
                  width: '100%', minHeight: 80, background: 'var(--bg-glass)', border: '1px solid var(--border-glass)',
                  borderRadius: 6, padding: '8px 10px', color: 'var(--text-primary)', fontSize: '0.85rem',
                  resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box',
                }}
              />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
              <div>
                <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Format</label>
                <select
                  value={newFormat} onChange={e => setNewFormat(e.target.value as VideoFormat)}
                  style={{
                    width: '100%', background: 'var(--bg-glass)', border: '1px solid var(--border-glass)',
                    borderRadius: 6, padding: '6px 10px', color: 'var(--text-primary)', fontSize: '0.85rem',
                  }}
                >
                  <option value="landscape-long">Landscape (Long)</option>
                  <option value="vertical-short">Vertical (Short)</option>
                  <option value="animated">Animated</option>
                  <option value="screen-record">Screen Record</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Duration (s)</label>
                <input
                  type="number" value={newDuration} min={10} max={600}
                  onChange={e => setNewDuration(parseInt(e.target.value))}
                  style={{
                    width: '100%', background: 'var(--bg-glass)', border: '1px solid var(--border-glass)',
                    borderRadius: 6, padding: '6px 10px', color: 'var(--text-primary)', fontSize: '0.85rem',
                    boxSizing: 'border-box',
                  }}
                />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn--ghost" onClick={() => setShowCreateModal(false)}>Cancel</button>
              <button className="btn btn--primary" onClick={createJob} disabled={creating || !newPrompt.trim()}>
                {creating ? 'Creating...' : 'Start Pipeline'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="board-layout" style={{ overflowX: 'auto' }}>
        {colOrder.map(col => (
          <div key={col} className="board-column">
            <div className="board-column__header">
              <div className="board-column__title" style={{ textTransform: 'capitalize', display: 'flex', alignItems: 'center', gap: 6 }}>
                {col === 'completed' ? <CheckCircle size={12} style={{ color: 'var(--color-success)' }} /> : <Clock size={12} style={{ color: 'var(--color-info)' }} />}
                {col.replace('-', ' ')}
              </div>
              <div className="board-column__count">{stageCols[col].length}</div>
            </div>
            <div className="board-column__body">
              {stageCols[col].length === 0 ? (
                <div className="board-column__empty">No jobs</div>
              ) : stageCols[col].map(job => (
                <div key={job.id} className="entity-card"
                  style={{ '--card-accent': FORMAT_COLORS[job.request.format] } as React.CSSProperties}
                  onClick={() => setSelectedJob(selectedJob?.id === job.id ? null : job)}>
                  <div className="entity-card__header">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ color: FORMAT_COLORS[job.request.format] }}>{FORMAT_ICONS[job.request.format]}</span>
                      <div>
                        <div className="entity-card__title" style={{ fontSize: '0.82rem' }}>
                          {job.request.prompt.substring(0, 50)}{job.request.prompt.length > 50 ? '…' : ''}
                        </div>
                        <div className="entity-card__subtitle">{job.request.format} · {job.request.targetDurationSeconds}s</div>
                      </div>
                    </div>
                    <StatusBadge status={job.status} />
                  </div>

                  <StagePipeline currentStage={job.stage} status={job.status} />

                  {selectedJob?.id === job.id && (
                    <div style={{ marginTop: 6, padding: '8px', background: 'var(--bg-glass)', borderRadius: 6, fontSize: '0.75rem' }}>
                      <div style={{ color: 'var(--text-muted)', marginBottom: 4 }}>Run ID: <span style={{ fontFamily: 'monospace', color: 'var(--text-secondary)' }}>{job.runId}</span></div>
                      {job.artifactId && (
                        <div style={{ marginTop: 8, marginBottom: 8, background: '#000', borderRadius: 8, overflow: 'hidden', position: 'relative', aspectRatio: job.request.format === 'vertical-short' ? '9/16' : '16/9', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <img src={`https://picsum.photos/seed/${job.artifactId}/${job.request.format === 'vertical-short' ? '360/640' : '640/360'}`} alt="Video Thumbnail" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: 0.7 }} />
                          <div style={{ position: 'absolute', zIndex: 1, width: 40, height: 40, background: 'rgba(255,255,255,0.2)', backdropFilter: 'blur(4px)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                            <div style={{ width: 0, height: 0, borderTop: '8px solid transparent', borderBottom: '8px solid transparent', borderLeft: '12px solid #fff', marginLeft: 4 }} />
                          </div>
                          <div style={{ position: 'absolute', bottom: 8, left: 8, padding: '2px 6px', background: 'rgba(0,0,0,0.6)', borderRadius: 4, color: '#fff', fontSize: '0.65rem' }}>
                            {job.request.targetDurationSeconds}s
                          </div>
                          <div style={{ position: 'absolute', top: 8, right: 8, padding: '2px 6px', background: 'rgba(0,0,0,0.6)', borderRadius: 4, color: '#fff', fontSize: '0.6rem', display: 'flex', alignItems: 'center', gap: 4 }}>
                            <CheckCircle size={10} style={{ color: 'var(--color-success)' }} /> Ready
                          </div>
                        </div>
                      )}
                      <div style={{ color: 'var(--text-muted)', marginTop: 4 }}>
                        Created: {new Date(job.createdAt).toLocaleTimeString()}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default VideoBoard;

