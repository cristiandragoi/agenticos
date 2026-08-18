// @ts-nocheck
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Wrench, Play, RefreshCw, CheckCircle, Clock, XCircle, Mail,
  FileText, BarChart2, AlertTriangle, Loader2, Send, MessageSquare, Circle, Table, Download,
  ChevronDown, ChevronRight, Copy
} from 'lucide-react';

import { apiFetch, apiUrl } from '../api/client';
const API = apiUrl('/api/pipeline/welders');

const STEP_DEFS = [
  { id: 'jobDiscovery', name: 'Stage A: Job Discovery', desc: 'Find hiring companies in DE+NL via Apify' },
  { id: 'leadEnrichment', name: 'Stage B: Lead Enrichment', desc: 'Extract emails, phones, and addresses into leads.md' },
  { id: 'outreachPreparation', name: 'Stage C: Outreach Preparation', desc: 'Draft templates in email-templates.md' },
  { id: 'outreachExecution', name: 'Stage D: Outreach Execution & Logging', desc: 'Send emails via SMTP & update outreach-log.md' },
];

const PipelineFlow = ({ statuses, stepResults, leadsCount, templatesCount, emailStats }: any) => {
  const resData = stepResults?.['jobDiscovery'] || {};
  const isResearchRunning = statuses['jobDiscovery'] === 'running';
  const totalFound = isResearchRunning && !resData.totalFound ? '...' : (resData.totalFound || 0);

  const nodes = [
    { 
      id: 'jobDiscovery', 
      title: 'Job Discovery', 
      actor: 'Actor: Apify (Google Search)',
      stat: `Companies found: ${totalFound} / 100` 
    },
    { 
      id: 'leadEnrichment', 
      title: 'Lead Enrichment', 
      actor: 'Local Node Deep Crawl',
      stat: `Leads with email: ${statuses['leadEnrichment'] === 'running' ? '...' : leadsCount}` 
    },
    { 
      id: 'outreachPreparation', 
      title: 'Outreach Preparation', 
      actor: 'Agent: Gemini Email Copy',
      stat: `Templates generated: ${statuses['outreachPreparation'] === 'running' ? '...' : templatesCount}` 
    },
    { 
      id: 'outreachExecution', 
      title: 'Outreach Execution & Logging', 
      actor: 'Strato SMTP Endpoint',
      stat: `Emails sent: ${emailStats.total} (Success ${emailStats.success} / Failed ${emailStats.failed})` 
    }
  ];

  const getColor = (s: string) => s === 'running' ? '#3b82f6' : s === 'completed' ? '#10b981' : s === 'failed' ? '#ef4444' : '#4b5563';
  
  return (
    <div style={{ display: 'flex', alignItems: 'center', overflowX: 'auto', padding: '16px 0', gap: 16 }}>
      {nodes.map((n, i) => {
        const s = statuses[n.id] || 'idle';
        const color = getColor(s);
        return (
          <React.Fragment key={n.id}>
            <div style={{ width: 240, flexShrink: 0, background: 'rgba(31,41,55,0.8)', border: `2px solid ${color}`, borderRadius: 12, padding: 16, position: 'relative' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                {s === 'running' ? <Loader2 size={16} color={color} style={{ animation: 'spin 1s linear infinite' }} /> : <Circle size={16} color={color} fill={s === 'completed' ? color : 'transparent'} />}
                <span style={{ color: color, fontWeight: 700, fontSize: 11, textTransform: 'uppercase' }}>{s}</span>
              </div>
              <div style={{ fontSize: 13, color: '#f9fafb', marginBottom: 6, lineHeight: 1.4 }}>{n.title}</div>
              <div style={{ fontSize: 11, color: '#a78bfa', marginBottom: 12 }}>{n.actor}</div>
              <div style={{ background: 'rgba(0,0,0,0.3)', padding: 8, borderRadius: 6, fontSize: 11, color: '#d1fae5', fontFamily: 'monospace' }}>
                {n.stat}
              </div>
            </div>
            {i < nodes.length - 1 && <ChevronRight size={24} color="#6b7280" style={{ flexShrink: 0 }} />}
          </React.Fragment>
        );
      })}
    </div>
  );
};

const StatusBadge = ({ status }: { status: string }) => {
  const map: Record<string, { color: string; label: string }> = {
    draft: { color: '#6b7280', label: 'Ready' },
    running: { color: '#3b82f6', label: 'Running' },
    completed: { color: '#10b981', label: 'Done' },
    failed: { color: '#ef4444', label: 'Failed' },
  };
  const { color, label } = map[status] || map.draft;
  return (
    <span style={{
      background: color + '22', color, border: `1px solid ${color}55`,
      borderRadius: 6, padding: '2px 10px', fontSize: 12, fontWeight: 600
    }}>{label}</span>
  );
};

const StepIcon = ({ status }: { status: string }) => {
  if (status === 'completed') return <CheckCircle size={18} style={{ color: '#10b981', flexShrink: 0 }} />;
  if (status === 'running')   return <Loader2 size={18} style={{ color: '#3b82f6', flexShrink: 0, animation: 'spin 1s linear infinite' }} />;
  if (status === 'failed')    return <XCircle size={18} style={{ color: '#ef4444', flexShrink: 0 }} />;
  return <Circle size={18} style={{ color: '#4b5563', flexShrink: 0 }} />;
};

const StepRow = ({ def, status, error, leadsCount, templatesCount, onGoToJobs, onGoToLeads, onGoToTemplates, onGoToOutreach, outreachLogData, statusMdContent }: any) => {
  const [expanded, setExpanded] = useState(false);
  const bgMap: Record<string, string> = { pending: 'rgba(75,85,99,0.12)', running: 'rgba(59,130,246,0.1)', completed: 'rgba(16,185,129,0.1)', failed: 'rgba(239,68,68,0.1)' };
  const borderMap: Record<string, string> = { pending: 'rgba(75,85,99,0.2)', running: 'rgba(59,130,246,0.4)', completed: 'rgba(16,185,129,0.4)', failed: 'rgba(239,68,68,0.4)' };
  const labelMap: Record<string, string> = { pending: '#9ca3af', running: '#60a5fa', completed: '#34d399', failed: '#f87171' };

  const copyPath = (path: string) => {
    navigator.clipboard.writeText(path);
    alert(`Copied path: ${path}`);
  };

  const getContext = () => {
    if (def.id === 'jobDiscovery') return (
      <div style={{ marginTop: 12, padding: 12, background: 'rgba(0,0,0,0.2)', borderRadius: 8 }}>
        <div style={{ fontSize: 12, color: '#d1fae5', marginBottom: 8 }}>Target per run: 100 companies. Uses Apify to find job listings for welders/electricians in DE+NL.</div>
        <button onClick={(e) => { e.stopPropagation(); onGoToJobs(); }} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#10b981', border: 'none', color: '#fff', padding: '6px 12px', borderRadius: 6, fontSize: 11, cursor: 'pointer' }}><Table size={12} /> Open Job Discovery Tab</button>
      </div>
    );
    if (def.id === 'leadEnrichment') return (
      <div style={{ marginTop: 12, padding: 12, background: 'rgba(0,0,0,0.2)', borderRadius: 8 }}>
         <div style={{ fontSize: 12, color: '#d1fae5', marginBottom: 6 }}>Deep crawls job listings to find HR emails and contact info. {leadsCount} leads enriched.</div>
         <button onClick={(e) => { e.stopPropagation(); onGoToLeads(); }} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#10b981', border: 'none', color: '#fff', padding: '6px 12px', borderRadius: 6, fontSize: 11, cursor: 'pointer' }}><Table size={12} /> Open Lead Review Tab</button>
      </div>
    );
    if (def.id === 'outreachPreparation') return (
      <div style={{ marginTop: 12, padding: 12, background: 'rgba(0,0,0,0.2)', borderRadius: 8 }}>
         <div style={{ fontSize: 12, color: '#d1fae5', marginBottom: 6 }}>Generates customized German and English email templates. {templatesCount} templates drafted.</div>
         <button onClick={(e) => { e.stopPropagation(); onGoToTemplates(); }} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#8b5cf6', border: 'none', color: '#fff', padding: '6px 12px', borderRadius: 6, fontSize: 11, cursor: 'pointer' }}><Mail size={12} /> View Email Templates Tab</button>
      </div>
    );
    if (def.id === 'outreachExecution') return (
      <div style={{ marginTop: 12, padding: 12, background: 'rgba(0,0,0,0.2)', borderRadius: 8 }}>
        <div style={{ fontSize: 12, color: '#d1fae5', marginBottom: 8 }}>Manual step: Send emails via SMTP and automatically log results.</div>
        <button onClick={(e) => { e.stopPropagation(); onGoToOutreach(); }} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#ef4444', border: 'none', color: '#fff', padding: '6px 12px', borderRadius: 6, fontSize: 11, cursor: 'pointer' }}><Send size={12} /> Open Outreach Tab</button>
      </div>
    );
    return null;
  };

  return (
    <div 
      onClick={() => setExpanded(!expanded)}
      style={{
        padding: '12px 16px', borderRadius: 10, marginBottom: 8, cursor: 'pointer',
        background: bgMap[status] || bgMap.pending,
        border: `1px solid ${borderMap[status] || borderMap.pending}`,
        transition: 'all 0.3s ease'
      }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {expanded ? <ChevronDown size={14} style={{ color: '#9ca3af' }}/> : <ChevronRight size={14} style={{ color: '#9ca3af' }}/>}
        <StepIcon status={status} />
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 13, color: labelMap[status] || labelMap.pending }}>{def.name}</div>
          <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>{error ? `⚠ ${error}` : def.desc}</div>
        </div>
        <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: labelMap[status] || labelMap.pending }}>
          {status}
        </div>
      </div>
      {expanded && getContext()}
    </div>
  );
};

const FileRow = ({ file, exists, sizeBytes, modifiedAt }: any) => (
  <div style={{
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '8px 12px', borderRadius: 8,
    background: exists ? 'rgba(16,185,129,0.07)' : 'rgba(107,114,128,0.08)', marginBottom: 4
  }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      {exists ? <CheckCircle size={14} style={{ color: '#10b981' }} /> : <XCircle size={14} style={{ color: '#6b7280' }} />}
      <code style={{ fontSize: 13, color: exists ? '#d1fae5' : '#9ca3af' }}>{file}</code>
    </div>
    {exists && <div style={{ textAlign: 'right' }}>
      <div style={{ fontSize: 11, color: '#6b7280' }}>{(sizeBytes / 1024).toFixed(1)}kb</div>
      {modifiedAt && <div style={{ fontSize: 10, color: '#4b5563' }}>{modifiedAt.slice(0,16).replace('T',' ')}</div>}
    </div>}
  </div>
);

const Section = ({ icon: Icon, title, children }: any) => (
  <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16, padding: 24, marginBottom: 20 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
      <Icon size={18} style={{ color: '#a78bfa' }} />
      <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>{title}</h3>
    </div>
    {children}
  </div>
);

export const WeldersPipelinePage: React.FC = () => {
  const [status, setStatus] = useState<any>(null);
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [stepStatuses, setStepStatuses] = useState<Record<string, string>>({});
  const [stepErrors, setStepErrors] = useState<Record<string, string>>({});
  const [emailTone, setEmailTone] = useState('professional and direct');
  const [emailResult, setEmailResult] = useState('');
  const [outreachForm, setOutreachForm] = useState({ recipient: '', company: '', template: 'Template 1 - German', status: 'sent', notes: '' });
  const [replyText, setReplyText] = useState('');
  const [replyResult, setReplyResult] = useState('');
  const [sendForm, setSendForm] = useState({ companyName: '', to: '', subject: '', body: '', templateId: 'Template 1 - German' });
  const [isSending, setIsSending] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview'|'jobs'|'leads'|'email'|'outreach'|'reply'>('overview');
  
  const [rawJobsData, setRawJobsData] = useState<any[]>([]);
  const [leadsData, setLeadsData] = useState<any[]>([]);
  const [leadsSearch, setLeadsSearch] = useState('');
  const [leadsCountry, setLeadsCountry] = useState('');
  
  const [templatesData, setTemplatesData] = useState<any[]>([]);
  const [selectedTemplatePreview, setSelectedTemplatePreview] = useState<any>(null);
  const [outreachLogData, setOutreachLogData] = useState('');
  const [logSuccessMsg, setLogSuccessMsg] = useState('');

  const pollRef = useRef<any>(null);

  const fetchRawJobs = async () => {
    try {
      const r = await fetch(`${API}/raw-jobs`);
      if (r.ok) setRawJobsData(await r.json());
    } catch (e) { console.error('Failed to fetch raw jobs', e); }
  };

  const fetchLeads = async () => {
    try {
      const r = await fetch(`${API}/leads`);
      if (r.ok) setLeadsData(await r.json());
    } catch (e) { console.error('Failed to fetch leads', e); }
  };
  
  const fetchTemplates = async () => {
    try {
      const r = await fetch(`${API}/templates`);
      if (r.ok) {
        const t = await r.json();
        setTemplatesData(t);
        if (t.length > 0 && !sendForm.templateId) {
          setSendForm(prev => ({ ...prev, templateId: t[0].id }));
        }
      }
    } catch (e) { console.error('Failed to fetch templates', e); }
  };

  const fetchOutreachLog = async () => {
    try {
      const r = await fetch(`${API}/outreach-log`);
      if (r.ok) {
        const data = await r.json();
        setOutreachLogData(data.content || '');
      }
    } catch (e) { console.error('Failed to fetch outreach log', e); }
  };

  useEffect(() => {
    if (activeTab === 'jobs' || activeTab === 'overview') fetchRawJobs();
    if (activeTab === 'leads' || activeTab === 'overview') fetchLeads();
    if (activeTab === 'email' || activeTab === 'outreach' || activeTab === 'overview') fetchTemplates();
    if (activeTab === 'outreach' || activeTab === 'overview') fetchOutreachLog();
  }, [activeTab]);

  const addLog = (msg: string) => setLog(l => [...l, `[${new Date().toLocaleTimeString()}] ${msg}`]);

  const fetchStatus = useCallback(async () => {
    try {
      const r = await fetch(`${API}/status`);
      if (r.ok) {
        const data = await r.json();
        setStatus(data);
        // Sync step statuses from API
        if (data.currentRun?.stepStatuses) {
          const m: Record<string, string> = {};
          const e: Record<string, string> = {};
          data.currentRun.stepStatuses.forEach((s: any) => {
            m[s.stepId] = s.status;
            if (s.errorMessage) e[s.stepId] = s.errorMessage;
          });
          setStepStatuses(m);
          setStepErrors(e);
        }
        // Auto-stop polling if pipeline completed/failed
        if (data.loopDefinition?.status === 'completed' || data.loopDefinition?.status === 'failed') {
          if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
          setRunning(false);
        }
      }
    } catch { /* server may be starting */ }
  }, []);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  const runPipeline = async () => {
    setRunning(true);
    const initialStatuses: Record<string, string> = {};
    STEP_DEFS.forEach(s => { initialStatuses[s.id] = 'pending'; });
    setStepStatuses(initialStatuses);
    setStepErrors({});
    addLog('Starting Welders Lead Pipeline...');

    try {
      const r = await fetch(`${API}/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
      const data = await r.json();
      if (r.ok) {
        addLog(`Pipeline started — Run ID: ${data.runId}`);
        // Poll every 1.5s for step progress
        pollRef.current = setInterval(async () => {
          const sr = await fetch(`${API}/status`);
          if (sr.ok) {
            const sd = await sr.json();
            setStatus(sd);
            if (sd.currentRun?.stepStatuses) {
              const m: Record<string, string> = {};
              const e: Record<string, string> = {};
              sd.currentRun.stepStatuses.forEach((s: any) => {
                m[s.stepId] = s.status;
                if (s.errorMessage) e[s.stepId] = s.errorMessage;
              });
              setStepStatuses(m);
              setStepErrors(e);
              // Log step transitions
              sd.currentRun.stepStatuses.forEach((s: any) => {
                if (s.status === 'completed') addLog(`✅ ${s.name} — completed`);
                if (s.status === 'failed') addLog(`❌ ${s.name} — failed${s.errorMessage ? ': ' + s.errorMessage : ''}`);
              });
            }
            if (sd.loopDefinition?.status === 'completed') {
              addLog('✅ Pipeline completed successfully. Obsidian files updated.');
              clearInterval(pollRef.current); pollRef.current = null; setRunning(false);
            } else if (sd.loopDefinition?.status === 'failed') {
              addLog('❌ Pipeline failed. Check step status above.');
              clearInterval(pollRef.current); pollRef.current = null; setRunning(false);
            }
          }
        }, 1500);
      } else {
        addLog(`⚠ ${data.error || 'Pipeline error'}`);
        setRunning(false);
      }
    } catch (e: any) { addLog(`❌ ${e.message}`); setRunning(false); }
  };

  const generateEmails = async () => {
    addLog(`Generating email templates (tone: ${emailTone})...`);
    setEmailResult('');
    try {
      const r = await fetch(`${API}/email-draft`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tone: emailTone })
      });
      const data = await r.json();
      if (r.ok) { setEmailResult(data.templates || JSON.stringify(data, null, 2)); addLog('✅ Email templates generated.'); }
      else addLog(`⚠ ${data.error}`);
    } catch (e: any) { addLog(`❌ ${e.message}`); }
  };

  const logOutreach = async () => {
    if (!outreachForm.recipient || !outreachForm.company) { addLog('⚠ Recipient and company required.'); return; }
    try {
      const r = await fetch(`${API}/outreach/log`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(outreachForm)
      });
      const data = await r.json();
      if (r.ok) { 
        addLog(`✅ Logged: ${outreachForm.company}`); 
        setOutreachForm({ recipient: '', company: '', template: 'Template 1 - German', status: 'sent', notes: '' }); 
        setLogSuccessMsg('C:\\Users\\Cris\\obsidian-vault\\projects\\welders-de-nl\\outreach-log.md');
        fetchStatus(); 
        fetchOutreachLog();
      }
      else addLog(`⚠ ${data.error}`);
    } catch (e: any) { addLog(`❌ ${e.message}`); }
  };

  const sendManualEmail = async () => {
    if (!sendForm.to || !sendForm.subject || !sendForm.body) { addLog('⚠ To, subject, and body are required.'); return; }
    addLog(`Sending email to ${sendForm.to}...`);
    setIsSending(true);
    try {
      const r = await fetch(`${API}/send-email`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sendForm)
      });
      const data = await r.json();
      if (r.ok) { addLog(`✅ Email sent to ${sendForm.to} at ${data.timestamp}`); setSendForm({ companyName: '', to: '', subject: '', body: '', templateId: 'Template 1 - German' }); }
      else addLog(`❌ Failed: ${data.error}`);
    } catch (e: any) { addLog(`❌ ${e.message}`); }
    setIsSending(false);
  };

  const draftReply = async () => {
    if (!replyText.trim()) { addLog('⚠ Paste the inbound reply text first.'); return; }
    addLog('Drafting reply...');
    setReplyResult('');
    try {
      const r = await fetch(`${API}/reply`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ replyText })
      });
      const data = await r.json();
      if (r.ok) { setReplyResult(data.templates || JSON.stringify(data, null, 2)); addLog('✅ Reply drafts generated.'); }
      else addLog(`⚠ ${data.error}`);
    } catch (e: any) { addLog(`❌ ${e.message}`); }
  };

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '10px 14px', background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, color: '#f9fafb',
    fontSize: 13, outline: 'none', boxSizing: 'border-box'
  };
  const btn = (color = '#7c3aed'): React.CSSProperties => ({
    display: 'flex', alignItems: 'center', gap: 6, padding: '9px 18px',
    background: color, border: 'none', borderRadius: 8, color: '#fff',
    fontSize: 13, fontWeight: 600, cursor: running ? 'not-allowed' : 'pointer', opacity: running ? 0.6 : 1
  });

  const tabs = [
    { id: 'overview' as const, label: 'Overview', icon: BarChart2 },
    { id: 'jobs' as const, label: 'Job Discovery', icon: FileText },
    { id: 'leads' as const, label: 'Lead Review', icon: Table },
    { id: 'email' as const, label: 'Templates', icon: Mail },
    { id: 'outreach' as const, label: 'Outreach', icon: Send },
    { id: 'reply' as const, label: 'Draft Reply', icon: MessageSquare },
  ];

  // Parse email stats from outreach log for Node D
  const sentCount = (outreachLogData.match(/Status: SENT/g) || []).length;
  const failCount = (outreachLogData.match(/Status: FAILED/g) || []).length;
  const emailStats = { total: sentCount + failCount, success: sentCount, failed: failCount };

  return (
    <div style={['leads', 'jobs'].includes(activeTab) ? { display: 'flex', flexDirection: 'column', height: '100vh', padding: 20, fontFamily: 'Inter, system-ui, sans-serif' } : { maxWidth: 900, margin: '0 auto', padding: '40px 20px', fontFamily: 'Inter, system-ui, sans-serif' }}>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>

      {!['leads', 'jobs'].includes(activeTab) && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ width: 42, height: 42, borderRadius: 10, background: 'linear-gradient(135deg,#7c3aed,#4f46e5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Wrench size={20} style={{ color: '#fff' }} />
            </div>
            <div>
              <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>Welders Lead Pipeline</h1>
              <p style={{ margin: 0, fontSize: 13, color: '#9ca3af' }}>DE + NL staffing outreach · 3 steps · Gemini-powered</p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={fetchStatus} style={btn('#374151')} disabled={running}><RefreshCw size={14} /></button>
            <button onClick={runPipeline} style={btn()} disabled={running}>
              {running ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Play size={14} />}
              {running ? 'Running...' : 'Run Full Pipeline'}
            </button>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, background: 'rgba(255,255,255,0.04)', padding: 4, borderRadius: 10 }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)} style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            padding: '8px 0', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600,
            background: activeTab === t.id ? 'rgba(124,58,237,0.25)' : 'transparent',
            color: activeTab === t.id ? '#a78bfa' : '#9ca3af',
          }}>
            <t.icon size={13} />{t.label}
          </button>
        ))}
      </div>

      {activeTab === 'overview' && (
        <>
          {/* Pipeline Flow Node View */}
          <Section icon={Play} title="Pipeline Flow">
            <PipelineFlow statuses={stepStatuses} stepResults={status?.currentRun?.stepResults || {}} leadsCount={leadsData.length} templatesCount={templatesData.length} emailStats={emailStats} />
          </Section>

          <Section icon={BarChart2} title="Summary Cards">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12 }}>
              <div style={{ padding: 16, background: 'rgba(255,255,255,0.05)', borderRadius: 12, border: '1px solid rgba(255,255,255,0.1)' }}>
                <div style={{ fontSize: 12, color: '#9ca3af', marginBottom: 4 }}>Companies Found</div>
                <div style={{ fontSize: 24, fontWeight: 700, color: '#f9fafb', marginBottom: 8 }}>{rawJobsData.length}</div>
                <button onClick={() => setActiveTab('jobs')} style={{ background: 'none', border: 'none', color: '#60a5fa', cursor: 'pointer', fontSize: 11, padding: 0 }}>View Jobs →</button>
              </div>
              <div style={{ padding: 16, background: 'rgba(255,255,255,0.05)', borderRadius: 12, border: '1px solid rgba(255,255,255,0.1)' }}>
                <div style={{ fontSize: 12, color: '#9ca3af', marginBottom: 4 }}>Leads (Emails)</div>
                <div style={{ fontSize: 24, fontWeight: 700, color: '#10b981', marginBottom: 8 }}>{leadsData.filter(l => l.Email && !l.Email.includes('*')).length}</div>
                <button onClick={() => setActiveTab('leads')} style={{ background: 'none', border: 'none', color: '#60a5fa', cursor: 'pointer', fontSize: 11, padding: 0 }}>View Leads →</button>
              </div>
              <div style={{ padding: 16, background: 'rgba(255,255,255,0.05)', borderRadius: 12, border: '1px solid rgba(255,255,255,0.1)' }}>
                <div style={{ fontSize: 12, color: '#9ca3af', marginBottom: 4 }}>Templates</div>
                <div style={{ fontSize: 24, fontWeight: 700, color: '#a78bfa', marginBottom: 8 }}>{templatesData.length}</div>
                <button onClick={() => setActiveTab('email')} style={{ background: 'none', border: 'none', color: '#60a5fa', cursor: 'pointer', fontSize: 11, padding: 0 }}>View Templates →</button>
              </div>
              <div style={{ padding: 16, background: 'rgba(255,255,255,0.05)', borderRadius: 12, border: '1px solid rgba(255,255,255,0.1)' }}>
                <div style={{ fontSize: 12, color: '#9ca3af', marginBottom: 4 }}>Emails Sent</div>
                <div style={{ fontSize: 24, fontWeight: 700, color: '#f87171', marginBottom: 8 }}>{emailStats.total} <span style={{ fontSize: 12, color: '#9ca3af', fontWeight: 400 }}>({emailStats.success}S / {emailStats.failed}F)</span></div>
                <button onClick={() => setActiveTab('outreach')} style={{ background: 'none', border: 'none', color: '#60a5fa', cursor: 'pointer', fontSize: 11, padding: 0 }}>View Outreach →</button>
              </div>
            </div>
          </Section>

          {/* Step Progress */}
          <Section icon={BarChart2} title="Pipeline Progress">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <span style={{ fontSize: 12, color: '#6b7280' }}>Loop: {status?.loopDefinition?.id ?? '—'}</span>
              <StatusBadge status={status?.loopDefinition?.status ?? 'draft'} />
            </div>
            {STEP_DEFS.map(def => (
              <StepRow
                key={def.id}
                def={def}
                status={stepStatuses[def.id] ?? 'pending'}
                error={stepErrors[def.id]}
                leadsCount={leadsData.length}
                templatesCount={templatesData.length}
                outreachLogData={outreachLogData}
                statusMdContent={status?.statusMdContent}
                onGoToJobs={() => setActiveTab('jobs')}
                onGoToLeads={() => setActiveTab('leads')}
                onGoToTemplates={() => setActiveTab('email')}
                onGoToOutreach={() => setActiveTab('outreach')}
              />
            ))}
          </Section>

          {/* Obsidian Files */}
          <Section icon={FileText} title="Obsidian Vault — projects/welders-de-nl">
            {status?.obsidianFiles
              ? status.obsidianFiles.map((f: any) => <FileRow key={f.file} {...f} />)
              : <div style={{ color: '#9ca3af', fontSize: 13 }}>Loading...</div>}
          </Section>

          {/* Quick Actions */}
          <Section icon={Play} title="Quick Actions">
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button onClick={runPipeline} style={btn()} disabled={running}>
                <Play size={14} /> Run Full Pipeline
              </button>
              <button onClick={() => setActiveTab('email')} style={btn('#1d4ed8')} disabled={running}>
                <Mail size={14} /> Draft Emails Only
              </button>
            </div>
          </Section>

          {/* Last Run Info */}
          {status?.currentRun && (
            <Section icon={Clock} title="Last Run">
              <div style={{ fontSize: 12, color: '#9ca3af', display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div>Run ID: <code style={{ color: '#a78bfa' }}>{status.currentRun.id}</code></div>
                <div>Started: {status.currentRun.createdAt?.slice(0,16).replace('T',' ')}</div>
                {status.currentRun.completedAt && <div>Completed: {status.currentRun.completedAt?.slice(0,16).replace('T',' ')}</div>}
                {status.currentRun.errorMessage && <div style={{ color: '#f87171' }}>Error: {status.currentRun.errorMessage}</div>}
              </div>
            </Section>
          )}
        </>
      )}

      {activeTab === 'jobs' && (
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', background: '#111827', borderRadius: 12, border: '1px solid #374151' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid #374151', background: '#1f2937' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <FileText size={18} color="#a78bfa" />
              <h2 style={{ margin: 0, fontSize: 16, color: '#f9fafb' }}>Stage A: Job Discovery</h2>
            </div>
            {rawJobsData.length > 0 && rawJobsData.length < 20 && (
              <div style={{ fontSize: 12, color: '#fbbf24', background: 'rgba(251,191,36,0.1)', padding: '4px 10px', borderRadius: 6 }}>⚠ Low volume – we may need better search queries or actors.</div>
            )}
            <div style={{ color: '#9ca3af', fontSize: 13 }}>Found this run: {rawJobsData.length}</div>
          </div>
          <div style={{ flex: 1, overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, textAlign: 'left', whiteSpace: 'nowrap' }}>
              <thead style={{ position: 'sticky', top: 0, background: '#1f2937', zIndex: 10, boxShadow: '0 1px 2px rgba(0,0,0,0.5)' }}>
                <tr>
                  <th style={{ padding: '12px 16px', color: '#9ca3af', fontWeight: 600 }}>Company</th>
                  <th style={{ padding: '12px 16px', color: '#9ca3af', fontWeight: 600 }}>Role</th>
                  <th style={{ padding: '12px 16px', color: '#9ca3af', fontWeight: 600 }}>Country</th>
                  <th style={{ padding: '12px 16px', color: '#9ca3af', fontWeight: 600 }}>Source</th>
                  <th style={{ padding: '12px 16px', color: '#9ca3af', fontWeight: 600 }}>Job URL</th>
                </tr>
              </thead>
              <tbody>
                {rawJobsData.map((j: any, i: number) => (
                  <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)' }}>
                    <td style={{ padding: '12px 16px', color: '#f9fafb', fontWeight: 500 }}>{j.companyName}</td>
                    <td style={{ padding: '12px 16px', color: '#bfdbfe' }}>{j.role}</td>
                    <td style={{ padding: '12px 16px', color: '#d1fae5' }}>{j.country}</td>
                    <td style={{ padding: '12px 16px', color: '#9ca3af' }}>{j.source}</td>
                    <td style={{ padding: '12px 16px' }}><a href={j.jobUrl} target="_blank" rel="noreferrer" style={{ color: '#60a5fa' }}>{j.jobUrl}</a></td>
                  </tr>
                ))}
                {rawJobsData.length === 0 && (
                  <tr>
                    <td colSpan={5} style={{ padding: '40px', textAlign: 'center', color: '#6b7280' }}>No job discovery data found. Click Run Full Pipeline.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'leads' && (
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', background: '#111827', borderRadius: 12, border: '1px solid #374151' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid #374151', background: '#1f2937' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Table size={18} color="#a78bfa" />
              <h2 style={{ margin: 0, fontSize: 16, color: '#f9fafb' }}>Lead Review</h2>
            </div>
            <div style={{ display: 'flex', gap: 12 }}>
              <input 
                style={{ ...inputStyle, width: 250 }} 
                placeholder="Search Company or Role..." 
                value={leadsSearch} onChange={e => setLeadsSearch(e.target.value)} 
              />
              <select style={{ ...inputStyle, width: 140 }} value={leadsCountry} onChange={e => setLeadsCountry(e.target.value)}>
                <option value="">All Countries</option>
                <option value="DE">Germany</option>
                <option value="NL">Netherlands</option>
              </select>
              <a href={`${API}/leads.csv`} download="welders-leads.csv" style={{ ...btn('#4b5563'), textDecoration: 'none' }}>
                <Download size={14} /> Export CSV
              </a>
            </div>
          </div>
          <div style={{ flex: 1, overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, textAlign: 'left', whiteSpace: 'nowrap' }}>
              <thead style={{ position: 'sticky', top: 0, background: '#1f2937', zIndex: 10, boxShadow: '0 1px 2px rgba(0,0,0,0.5)' }}>
                <tr>
                  <th style={{ padding: '12px 16px', color: '#9ca3af', fontWeight: 600 }}>Company</th>
                  <th style={{ padding: '12px 16px', color: '#9ca3af', fontWeight: 600 }}>Country</th>
                  <th style={{ padding: '12px 16px', color: '#9ca3af', fontWeight: 600 }}>Role</th>
                  <th style={{ padding: '12px 16px', color: '#9ca3af', fontWeight: 600 }}>Website</th>
                  <th style={{ padding: '12px 16px', color: '#9ca3af', fontWeight: 600 }}>Job Posting</th>
                  <th style={{ padding: '12px 16px', color: '#9ca3af', fontWeight: 600 }}>Email</th>
                  <th style={{ padding: '12px 16px', color: '#9ca3af', fontWeight: 600 }}>Phone</th>
                  <th style={{ padding: '12px 16px', color: '#9ca3af', fontWeight: 600 }}>Address</th>
                  <th style={{ padding: '12px 16px', color: '#9ca3af', fontWeight: 600 }}>Notes</th>
                </tr>
              </thead>
              <tbody>
                {leadsData.filter((l: any) => 
                  (leadsCountry ? l.Country?.includes(leadsCountry) : true) &&
                  ((l.companyName + (l.Role||'')).toLowerCase().includes(leadsSearch.toLowerCase()))
                ).map((l: any, i: number) => (
                  <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)' }}>
                    <td style={{ padding: '12px 16px', color: '#f9fafb', fontWeight: 500 }}>{l.companyName}</td>
                    <td style={{ padding: '12px 16px', color: '#d1fae5' }}>{l.Country}</td>
                    <td style={{ padding: '12px 16px', color: '#bfdbfe' }}>{l.Role}</td>
                    <td style={{ padding: '12px 16px' }}><a href={l.Website} target="_blank" rel="noreferrer" style={{ color: '#60a5fa' }}>{l.Website}</a></td>
                    <td style={{ padding: '12px 16px' }}><a href={l['Job posting']} target="_blank" rel="noreferrer" style={{ color: '#60a5fa' }}>Job Link</a></td>
                    <td style={{ padding: '12px 16px', color: '#f9fafb' }}>{l.Email}</td>
                    <td style={{ padding: '12px 16px', color: '#9ca3af' }}>{l.Phone}</td>
                    <td style={{ padding: '12px 16px', color: '#9ca3af' }}>{l.Address}</td>
                    <td style={{ padding: '12px 16px', color: '#9ca3af', whiteSpace: 'normal', minWidth: 200 }}>{l.Notes}</td>
                  </tr>
                ))}
                {leadsData.filter((l: any) => 
                  (leadsCountry ? l.Country?.includes(leadsCountry) : true) &&
                  ((l.companyName + (l.Role||'')).toLowerCase().includes(leadsSearch.toLowerCase()))
                ).length === 0 && (
                  <tr>
                    <td colSpan={9} style={{ padding: '40px', textAlign: 'center', color: '#6b7280' }}>No leads found or generated yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'email' && (
        <Section icon={Mail} title="Email Templates">
          {templatesData.length === 0 ? (
            <div style={{ color: '#9ca3af', fontSize: 13 }}>No templates found in email-templates.md yet. Use Run Full Pipeline to generate.</div>
          ) : (
            <div style={{ display: 'flex', gap: 20 }}>
              <div style={{ width: '40%' }}>
                {templatesData.map(t => (
                  <div key={t.id} onClick={() => setSelectedTemplatePreview(t)} style={{ padding: '10px 14px', background: selectedTemplatePreview?.id === t.id ? 'rgba(124,58,237,0.2)' : 'rgba(255,255,255,0.05)', border: `1px solid ${selectedTemplatePreview?.id === t.id ? '#7c3aed' : 'rgba(255,255,255,0.1)'}`, borderRadius: 8, marginBottom: 8, cursor: 'pointer' }}>
                    <div style={{ fontWeight: 600, fontSize: 13, color: '#f9fafb' }}>{t.name}</div>
                    <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>Subject: {t.subject}</div>
                  </div>
                ))}
              </div>
              <div style={{ width: '60%', background: 'rgba(0,0,0,0.3)', padding: 16, borderRadius: 10, border: '1px solid rgba(255,255,255,0.05)' }}>
                {selectedTemplatePreview ? (
                  <>
                    <div style={{ fontSize: 12, color: '#a78bfa', marginBottom: 8, fontWeight: 600 }}>Preview: {selectedTemplatePreview.name}</div>
                    <div style={{ fontSize: 13, color: '#f9fafb', marginBottom: 12, paddingBottom: 12, borderBottom: '1px solid rgba(255,255,255,0.1)' }}><strong>Subject:</strong> {selectedTemplatePreview.subject}</div>
                    <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 12, color: '#d1fae5', lineHeight: 1.6, fontFamily: 'inherit' }}>{selectedTemplatePreview.body}</pre>
                  </>
                ) : (
                  <div style={{ color: '#6b7280', fontSize: 12, textAlign: 'center', marginTop: 40 }}>Select a template to view the full body.</div>
                )}
              </div>
            </div>
          )}
        </Section>
      )}

      {activeTab === 'outreach' && (
        <>
        <Section icon={Send} title="Outreach Execution & Logging">
          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 24 }}>
            <div>
              <div style={{ background: 'rgba(124,58,237,0.1)', border: '1px solid rgba(124,58,237,0.2)', padding: '10px 14px', borderRadius: 8, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                 <Mail size={14} style={{ color: '#a78bfa' }} />
                 <span style={{ fontSize: 12, color: '#d1fae5' }}><strong>From:</strong> contact@rekruitai.de (Strato SMTP)</span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                <div>
                  <label style={{ fontSize: 12, color: '#9ca3af', display: 'block', marginBottom: 6 }}>Company Name</label>
                  <input style={inputStyle} value={sendForm.companyName} onChange={e => setSendForm({ ...sendForm, companyName: e.target.value })} placeholder="e.g. Meyer Werft GmbH" />
                </div>
                <div>
                  <label style={{ fontSize: 12, color: '#9ca3af', display: 'block', marginBottom: 6 }}>To Address</label>
                  <input style={inputStyle} value={sendForm.to} onChange={e => setSendForm({ ...sendForm, to: e.target.value })} placeholder="e.g. bewerbung@meyerwerft.de" />
                </div>
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 12, color: '#9ca3af', display: 'block', marginBottom: 6 }}>Select Template to Pre-fill</label>
                <select style={inputStyle} value={sendForm.templateId} onChange={e => {
                  const tid = e.target.value;
                  const tmpl = templatesData.find(x => x.id === tid);
                  if (tmpl) setSendForm({ ...sendForm, templateId: tid, subject: tmpl.subject, body: tmpl.body });
                  else setSendForm({ ...sendForm, templateId: tid });
                }}>
                  {templatesData.length === 0 && <option value="">No templates found</option>}
                  {templatesData.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 12, color: '#9ca3af', display: 'block', marginBottom: 6 }}>Subject</label>
                <input style={inputStyle} value={sendForm.subject} onChange={e => setSendForm({ ...sendForm, subject: e.target.value })} placeholder="Subject line" />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 12, color: '#9ca3af', display: 'block', marginBottom: 6 }}>Body</label>
                <textarea style={{ ...inputStyle, height: 160, resize: 'vertical', fontFamily: 'inherit' }} value={sendForm.body} onChange={e => setSendForm({ ...sendForm, body: e.target.value })} placeholder="Hello..." />
              </div>
              <button onClick={sendManualEmail} style={{ ...btn(), marginTop: 22 }} disabled={running || isSending}>
                {isSending ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Send size={14} />}
                {isSending ? 'Sending...' : 'Send Manual Email'}
              </button>
            </div>
            
            <div style={{ borderLeft: '1px solid rgba(255,255,255,0.1)', paddingLeft: 24 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#f9fafb', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}><FileText size={16} color="#10b981"/> Log Preview</div>
              {outreachLogData ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {outreachLogData.split('\n## ').slice(-5).reverse().map((block, i) => {
                    if (!block.trim()) return null;
                    const isSuccess = block.includes('Status: SENT');
                    return (
                      <div key={i} style={{ background: 'rgba(0,0,0,0.3)', borderLeft: `3px solid ${isSuccess ? '#10b981' : '#ef4444'}`, padding: 10, borderRadius: '0 8px 8px 0' }}>
                        <pre style={{ margin: 0, fontSize: 11, color: '#d1fae5', whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}>
                          {('## ' + block).trim()}
                        </pre>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div style={{ color: '#9ca3af', fontSize: 12 }}>No logs yet. Emails sent will appear here.</div>
              )}
            </div>
          </div>
        </Section>
        </>
      )}

      {/* Activity Log */}
      {log.length > 0 && (
        <div style={{ background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 12, padding: 14, marginTop: 4 }}>
          <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>Activity Log</div>
          {[...log].reverse().map((l, i) => (
            <div key={i} style={{ fontSize: 12, color: '#9ca3af', padding: '2px 0' }}>{l}</div>
          ))}
        </div>
      )}
    </div>
  );
};

export default WeldersPipelinePage;

