import { logger } from '../utils/logger.js';
/**
 * Welders Lead Pipeline - Real 3-Step Runner
 * Steps: research -> leads_and_templates -> briefing_and_log
 */
import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
// import { geminiInteractionsService } from '../services/geminiInteractionsService.js';
import { loopDefinitions, loopRuns } from '../services/loopEngine.js';
import { runJobDiscovery, enrichLeads } from '../services/scraperService.js';
import nodemailer from 'nodemailer';
import type { LoopDefinition, LoopRun, StepStatus } from '../types.js';

const router = Router();
const VAULT_BASE = 'C:\\Users\\Cris\\obsidian-vault';
const VAULT_PATH = path.join(VAULT_BASE, 'projects', 'welders-de-nl');
const LOGS_PATH  = path.join(VAULT_BASE, 'logs', 'daily-briefings');
const LOOP_ID    = 'loop-welders-pipeline';

const NOW = () => new Date().toISOString().slice(0, 16).replace('T', ' ');

function ensureDirs() {
  [VAULT_PATH, LOGS_PATH].forEach(p => { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); });
}
function writeVault(f: string, c: string) { ensureDirs(); fs.writeFileSync(path.join(VAULT_PATH, f), c, 'utf-8'); }
function appendVault(f: string, l: string) {
  ensureDirs();
  const fp = path.join(VAULT_PATH, f);
  const e = fs.existsSync(fp) ? fs.readFileSync(fp, 'utf-8') : '';
  fs.writeFileSync(fp, e + '\n' + l, 'utf-8');
}
function vaultStat(f: string) {
  const fp = path.join(VAULT_PATH, f);
  const ok = fs.existsSync(fp);
  return { file: f, exists: ok, sizeBytes: ok ? fs.statSync(fp).size : 0, modifiedAt: ok ? fs.statSync(fp).mtime.toISOString() : null };
}

function seedLoopDef(): LoopDefinition {
  return {
    id: LOOP_ID, name: 'Welders Lead Pipeline',
    description: '4-stage pipeline for welders staffing outreach.',
    createdAt: new Date().toISOString(), status: 'draft', maxIterations: 1,
    steps: [
      { id: 'jobDiscovery', name: 'Job Discovery', agentId: 'agent-jarvis', prompt: 'Find hiring companies.', mode: 'task', outputKey: 'raw_jobs' },
      { id: 'leadEnrichment', name: 'Lead Enrichment', agentId: 'agent-gemini-welders-research', prompt: 'Deep crawl for emails/phones.', mode: 'task', dependsOn: ['jobDiscovery'], outputKey: 'leads_output' },
      { id: 'outreachPreparation', name: 'Outreach Preparation', agentId: 'agent-gemini-email-copy', prompt: 'Draft templates.', mode: 'task', dependsOn: ['leadEnrichment'] },
      { id: 'outreachExecution', name: 'Outreach Execution & Logging', agentId: 'agent-hermes', prompt: 'Send emails & log.', mode: 'task', dependsOn: ['outreachPreparation'] },
    ],
  };
}

function getOrSeedDef(): LoopDefinition {
  return loopDefinitions.get(LOOP_ID) ?? (() => { const d = seedLoopDef(); loopDefinitions.upsert(d); return d; })();
}

const activeRuns = new Map<string, StepStatus[]>();

function syncStatus(runId: string, ss: StepStatus[], loopRun: LoopRun) {
  activeRuns.set(runId, [...ss]);
  loopRuns.upsert({ ...loopRun, stepStatuses: ss });
}

function mockResearch() {
  return `# Welders Research Report\n\n_Generated: ${NOW()} (mocked)\n\n## Market\nDE+NL show structural welder demand across shipbuilding, energy, heavy manufacturing.\n\n## Target Companies\n| Company | Location | Need | Priority |\n|---------|----------|------|----------|\n| Meyer Werft GmbH | Papenburg, DE | MIG/MAG, pipe | High |\n| Damen Shipyards | Gorinchem, NL | TIG, MIG | High |\n| Siemens Energy | Mulheim, DE | Industrial welders | High |\n| Thyssenkrupp | Duisburg, DE | All types | Medium |\n| Mammoet | Schiedam, NL | Structural | Medium |\n`;
}

function mockLeads() {
  return `# Lead Database\n\n_Updated: ${NOW()} (mocked)\n\n| # | Company | Country | Email | Status |\n|---|---------|---------|-------|--------|\n| 1 | Meyer Werft GmbH | DE | bewerbung@meyerwerft.de | New |\n| 2 | Damen Shipyards | NL | careers@damen.com | New |\n| 3 | Siemens Energy | DE | hr@siemens-energy.com | New |\n| 4 | Thyssenkrupp | DE | recruiting@thyssenkrupp.com | New |\n| 5 | Mammoet | NL | jobs@mammoet.com | New |\n`;
}

function mockTemplates() {
  return `# Email Templates\n\n_Generated: ${NOW()} (mocked)\n\n## Template 1 - German\n\n**Subject:** Qualifizierte Schweisser - sofort verfugbar\n\nSehr geehrte Damen und Herren,\nwir verfugen uber zertifizierte Schweisser (MIG/MAG, WIG) bereit zum Einsatz.\nGebuhren: 2.000 EUR je Mitarbeiter.\nDarf ich Ihnen Profile zusenden?\n\n## Template 2 - English\n\n**Subject:** Certified welders available now\n\nDear Recruitment Team,\nWe have certified welders (MIG/MAG, TIG) ready for NL projects.\nFee: EUR 2,000 per placement. Happy to send profiles.\n\n## Template 3 - Follow-up\n\n**Subject:** Follow-up - certified welders\n\nJust following up on my previous email. Still available to share profiles on request.\n`;
}

function buildStatusMd(pipelineStatus: string, ss: StepStatus[], runId: string) {
  const rows = ss.map(s =>
    `| ${s.name} | ${s.status.toUpperCase()} | ${s.startedAt?.slice(0,16).replace('T',' ')||'-'} | ${s.completedAt?.slice(0,16).replace('T',' ')||'-'} |`
  ).join('\n');
  return `# Welders Pipeline - Status\n\n_Updated: ${NOW()}_\n\n**Pipeline:** ${pipelineStatus.toUpperCase()}  **Run:** ${runId}\n\n## Step Progress\n\n| Step | Status | Started | Completed |\n|------|--------|---------|----------|\n${rows}\n\n## Leads\n- Meyer Werft, Damen, Siemens Energy, Thyssenkrupp, Mammoet\n\n## Fee: EUR 2,000/placement (EUR 1k signing + EUR 1k month 1)\n`;
}

async function runStageJobDiscovery(loopRunId: string, ss: StepStatus[], loopRun: LoopRun): Promise<void> {
  const s = ss.find(x => x.stepId === 'jobDiscovery');
  if (s) { s.status = 'running'; s.startedAt = new Date().toISOString(); }
  syncStatus(loopRunId, ss, loopRun);
  logger.info(`[WeldersPipeline] Stage A: Job Discovery - RUNNING`);

  try {
    const res = await runJobDiscovery();
    writeVault('raw_jobs.json', JSON.stringify(res.rawJobs, null, 2));
    loopRun.stepResults['jobDiscovery'] = res;
    
    const content = `# Job Discovery Summary\n\n_Generated: ${NOW()}_\n\n- **Total Found:** ${res.totalFound}\n- **Apify Actor:** ${res.apifyActor}\n`;
    writeVault('research-report.md', content);
    writeVault('status.md', buildStatusMd('running', ss, loopRunId));
  } catch (err: any) {
    logger.error(`[WeldersPipeline] Stage A Failed: ${err.message}`);
    throw err;
  }

  if (s) { s.status = 'completed'; s.completedAt = new Date().toISOString(); }
  syncStatus(loopRunId, ss, loopRun);
  logger.info(`[WeldersPipeline] Stage A: Job Discovery - COMPLETED`);
}

async function runStageLeadEnrichment(loopRunId: string, ss: StepStatus[], loopRun: LoopRun): Promise<void> {
  const s = ss.find(x => x.stepId === 'leadEnrichment');
  if (s) { s.status = 'running'; s.startedAt = new Date().toISOString(); }
  syncStatus(loopRunId, ss, loopRun);
  logger.info(`[WeldersPipeline] Stage B: Lead Enrichment - RUNNING`);

  try {
    const rawJobsPath = path.join(VAULT_PATH, 'raw_jobs.json');
    let rawJobs = [];
    if (fs.existsSync(rawJobsPath)) {
      rawJobs = JSON.parse(fs.readFileSync(rawJobsPath, 'utf-8'));
    } else if (loopRun.stepResults['jobDiscovery']?.rawJobs) {
      rawJobs = loopRun.stepResults['jobDiscovery'].rawJobs;
    }

    const enriched = await enrichLeads(rawJobs);
    
    let leadsMd = `# Welders Pipeline - Scraped Leads\n\n`;
    for (const comp of enriched) {
      let emailStr = comp.emails.length > 0 ? comp.emails[0].address : '*No email found*';
      if (comp.error) emailStr = `*Failed to scrape: ${comp.error}*`;
      leadsMd += `## Lead – ${comp.companyName}\n- Country: ${comp.country || 'Unknown'}\n- Role: ${comp.role || 'Unknown'}\n- Website: ${comp.websiteUrl}\n- Job posting: ${comp.jobUrl || comp.websiteUrl}\n- Email: ${emailStr}\n- Phone: ${comp.phone || 'N/A'}\n- Address: ${comp.address || 'N/A'}\n- Notes: Found via Stage A.\n\n`;
    }
    writeVault('leads.md', leadsMd);
    writeVault('status.md', buildStatusMd('running', ss, loopRunId));
  } catch (err: any) {
    logger.error(`[WeldersPipeline] Stage B Failed: ${err.message}`);
    throw err;
  }

  if (s) { s.status = 'completed'; s.completedAt = new Date().toISOString(); }
  syncStatus(loopRunId, ss, loopRun);
  logger.info(`[WeldersPipeline] Stage B: Lead Enrichment - COMPLETED`);
}

async function runStageOutreachPreparation(loopRunId: string, ss: StepStatus[], loopRun: LoopRun): Promise<void> {
  const s = ss.find(x => x.stepId === 'outreachPreparation');
  if (s) { s.status = 'running'; s.startedAt = new Date().toISOString(); }
  syncStatus(loopRunId, ss, loopRun);
  logger.info(`[WeldersPipeline] Stage C: Outreach Preparation - RUNNING`);

  try {
    const prompt = 'Draft 3 cold email templates in German and English for welders staffing outreach. Fee EUR 2000 per placement. Format as Markdown.';
    let rStr = mockTemplates();
    try {
      const ornRes = await fetch('http://localhost:11434/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'ornith:9b', messages: [{ role: 'system', content: 'You are an agentic orchestrator.' }, { role: 'user', content: prompt }], stream: false })
      });
      if (ornRes.ok) { const d = await ornRes.json(); rStr = d.message?.content || d.response || mockTemplates(); }
    } catch (e) { logger.warn('Ornith unreachable, using mock templates.'); }
    
    writeVault('email-templates.md', rStr);
    writeVault('status.md', buildStatusMd('completed', ss, loopRunId));
  } catch (err: any) {
    logger.error(`[WeldersPipeline] Stage C Failed: ${err.message}`);
    throw err;
  }

  if (s) { s.status = 'completed'; s.completedAt = new Date().toISOString(); }
  syncStatus(loopRunId, ss, loopRun);
  logger.info(`[WeldersPipeline] Stage C: Outreach Preparation - COMPLETED`);
}

async function executePipeline(loopRunId: string, def: LoopDefinition) {
  const ss: StepStatus[] = def.steps.map(s => ({ stepId: s.id, name: s.name, status: 'pending' as const }));
  const loopRun: LoopRun = {
    id: loopRunId, loopId: LOOP_ID, stepResults: {}, stepStatuses: ss,
    status: 'running', createdAt: new Date().toISOString(), iteration: 1, score: 0,
  };
  loopRuns.upsert(loopRun);
  loopDefinitions.upsert({ ...def, status: 'running' });
  activeRuns.set(loopRunId, ss);

  try {
    await runStageJobDiscovery(loopRunId, ss, loopRun);
    await runStageLeadEnrichment(loopRunId, ss, loopRun);
    await runStageOutreachPreparation(loopRunId, ss, loopRun);
    
    // Note: outreachExecution remains 'pending' because it is manual via UI
    loopRun.status = 'completed'; loopRun.completedAt = new Date().toISOString();
    loopDefinitions.upsert({ ...def, status: 'completed' });
    logger.info(`[WeldersPipeline] Run ${loopRunId} COMPLETED (A, B, C)`);
  } catch (err: any) {
    loopRun.status = 'failed'; loopRun.errorMessage = err.message;
    ss.forEach(s => { if (s.status === 'running' || s.status === 'pending') s.status = 'failed'; });
    loopDefinitions.upsert({ ...def, status: 'failed' });
    logger.error(`[WeldersPipeline] Run ${loopRunId} FAILED:`, err.message);
  }
  loopRuns.upsert({ ...loopRun, stepStatuses: ss });
  activeRuns.delete(loopRunId);
}

/* ====== ROUTES ====== */

router.get('/status', (req, res) => {
  const def = getOrSeedDef();
  const lastRun = loopRuns.list({ loopId: LOOP_ID })
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0] ?? null;
  let stepStatuses = lastRun?.stepStatuses ?? null;
  if (lastRun && activeRuns.has(lastRun.id)) stepStatuses = activeRuns.get(lastRun.id)!;
  
  const statusPath = path.join(VAULT_PATH, 'status.md');
  const statusMdContent = fs.existsSync(statusPath) ? fs.readFileSync(statusPath, 'utf-8') : '';

  res.json({
    loopDefinition: def,
    currentRun: lastRun ? { ...lastRun, stepStatuses } : null,
    obsidianFiles: ['raw_jobs.json', 'leads.md','email-templates.md','outreach-log.md','status.md'].map(vaultStat),
    statusMdContent
  });
});

router.get('/raw-jobs', (req, res) => {
  try {
    const rawPath = path.join(VAULT_PATH, 'raw_jobs.json');
    if (!fs.existsSync(rawPath)) return res.json([]);
    res.json(JSON.parse(fs.readFileSync(rawPath, 'utf-8')));
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/run', (req, res) => {
  const def = getOrSeedDef();
  const hasLive = activeRuns.size > 0;
  if (hasLive) { res.status(409).json({ error: 'Pipeline is already running.' }); return; }
  if (def.status === 'running') loopDefinitions.upsert({ ...def, status: 'draft' });

  const loopRunId = `lrun-${randomUUID().slice(0, 9)}`;
  executePipeline(loopRunId, { ...def, status: 'running' }).catch(logger.error);
  res.status(202).json({
    message: 'Welders Lead Pipeline started.', loopId: LOOP_ID, runId: loopRunId,
    steps: def.steps.map(s => ({ id: s.id, name: s.name, status: 'pending' })),
  });
});

router.post('/outreach/log', (req, res) => {
  const { recipient, company, template, status, notes } = req.body;
  if (!recipient || !company || !template || !status) {
    res.status(400).json({ error: 'recipient, company, template, and status are required' }); return;
  }
  const row = `| ${NOW()} | ${recipient} | ${company} | ${template} | ${status} | ${notes || ''} |`;
  appendVault('outreach-log.md', row);
  res.json({ logged: true, row });
});

router.post('/reply', async (req, res) => {
  const { fromName, fromCompany, replyText } = req.body;
  if (!replyText) { res.status(400).json({ error: 'replyText is required' }); return; }
  const prompt = `Draft 2 reply options to this inbound email from ${fromName||'an HR contact'} at ${fromCompany||'an industrial company'}:\n---\n${replyText}\n---\nOption A: Warm, ask needs. Option B: Professional, propose call.\nKeep under 150 words each. Markdown format.`;
  try {
    let rStr = 'Drafting reply...';
    try {
      const ornRes = await fetch('http://localhost:11434/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'ornith:9b', messages: [{ role: 'system', content: 'You are an agentic orchestrator.' }, { role: 'user', content: prompt }], stream: false })
      });
      if (ornRes.ok) { const d = await ornRes.json(); rStr = d.message?.content || d.response || rStr; }
    } catch (e) { logger.warn('Ornith unreachable.'); }
    appendVault('outreach-log.md', `| ${NOW()} | ${fromName||'-'} | ${fromCompany||'-'} | - | reply-received | Reply received |`);
    res.json({ templates: rStr });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/email-draft', async (req, res) => {
  const { tone = 'professional and direct' } = req.body || {};
  const prompt = `Draft 3 cold email templates for welders staffing outreach to DE/NL companies. Tone: ${tone}. Fee EUR 2000/placement. German and English variants. Markdown format.`;
  try {
    let rStr = 'Drafting...';
    try {
      const ornRes = await fetch('http://localhost:11434/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'ornith:9b', messages: [{ role: 'system', content: 'You are an agentic orchestrator.' }, { role: 'user', content: prompt }], stream: false })
      });
      if (ornRes.ok) { const d = await ornRes.json(); rStr = d.message?.content || d.response || rStr; }
    } catch (e) { logger.warn('Ornith unreachable.'); }
    writeVault('email-templates.md', `# Email Templates\n\n_Generated: ${NOW()}_\n\n${rStr}`);
    res.json({ templates: rStr });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/send-email', async (req, res) => {
  const { companyName, to, subject, body, templateId } = req.body || {};
  if (!to || !subject || !body) {
    res.status(400).json({ error: 'Missing to, subject, or body' });
    return;
  }

  const { OUTBOUND_SMTP_HOST, OUTBOUND_SMTP_PORT, OUTBOUND_SMTP_USER, OUTBOUND_SMTP_PASS } = process.env;

  if (!OUTBOUND_SMTP_HOST || !OUTBOUND_SMTP_USER || !OUTBOUND_SMTP_PASS) {
    res.status(500).json({ error: 'SMTP configuration is missing in the environment.' });
    return;
  }

  const port = parseInt(OUTBOUND_SMTP_PORT || '587', 10);
  const transport = nodemailer.createTransport({
    host: OUTBOUND_SMTP_HOST,
    port,
    secure: port === 465,
    auth: {
      user: OUTBOUND_SMTP_USER,
      pass: OUTBOUND_SMTP_PASS,
    },
  });

  try {
    const info = await transport.sendMail({
      from: OUTBOUND_SMTP_USER,
      to,
      subject,
      text: body,
    });

    const logEntry = `\n## Email Sent - ${NOW()}\nCompany: ${companyName || 'Unknown'}\n\nTo: ${to}\n\nSubject: ${subject}\n\nTemplate: ${templateId || 'None'}\n\nMessage ID: ${info.messageId || 'N/A'}\n\nStatus: SENT\n`;
    appendVault('outreach-log.md', logEntry);

    res.json({ ok: true, timestamp: new Date().toISOString() });
  } catch (err: any) {
    logger.error(`[WeldersPipeline] Failed to send email: ${err.message}`);
    const logEntry = `\n## Email Sent - ${NOW()}\nCompany: ${companyName || 'Unknown'}\n\nTo: ${to}\n\nSubject: ${subject}\n\nTemplate: ${templateId || 'None'}\n\nError: ${err.message}\n\nStatus: FAILED\n`;
    appendVault('outreach-log.md', logEntry);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/leads', (req, res) => {
  try {
    const leadsPath = path.join(VAULT_PATH, 'leads.md');
    if (!fs.existsSync(leadsPath)) return res.json([]);
    const content = fs.readFileSync(leadsPath, 'utf-8');
    
    const leads = content.split('## Lead – ').slice(1).map(block => {
      const lines = block.split('\n');
      const companyName = lines[0].trim();
      const extract = (key: string) => {
        const line = lines.find(l => l.startsWith(`- ${key}: `));
        return line ? line.replace(`- ${key}: `, '').trim() : 'N/A';
      };
      return {
        companyName,
        country: extract('Country'),
        role: extract('Role'),
        website: extract('Website'),
        jobPosting: extract('Job posting'),
        email: extract('Email'),
        phone: extract('Phone'),
        address: extract('Address'),
        notes: extract('Notes')
      };
    });
    res.json(leads);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/leads.csv', (req, res) => {
  try {
    const leadsPath = path.join(VAULT_PATH, 'leads.md');
    if (!fs.existsSync(leadsPath)) return res.status(404).send('No leads found.');
    const content = fs.readFileSync(leadsPath, 'utf-8');
    
    const leads = content.split('## Lead – ').slice(1).map(block => {
      const lines = block.split('\n');
      const companyName = lines[0].trim();
      const extract = (key: string) => {
        const line = lines.find(l => l.startsWith(`- ${key}: `));
        return line ? line.replace(`- ${key}: `, '').trim() : 'N/A';
      };
      
      const escapeCsv = (str: string) => {
        if (str.includes(';') || str.includes('\n')) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      };
      
      return [
        escapeCsv(companyName),
        escapeCsv(extract('Country')),
        escapeCsv(extract('Role')),
        escapeCsv(extract('Website')),
        escapeCsv(extract('Job posting')),
        escapeCsv(extract('Email')),
        escapeCsv(extract('Phone')),
        escapeCsv(extract('Address')),
        escapeCsv(extract('Notes'))
      ].join(';');
    });
    
    const header = 'Company;Country;Role;Website;JobPosting;Email;Phone;Address;Notes\n';
    const csvContent = header + leads.join('\n');
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="welders-leads.csv"');
    res.send(csvContent);
  } catch (e: any) {
    res.status(500).send(e.message);
  }
});

router.get('/templates', (req, res) => {
  try {
    const p = path.join(VAULT_PATH, 'email-templates.md');
    if (!fs.existsSync(p)) return res.json([]);
    const content = fs.readFileSync(p, 'utf-8');
    const blocks = content.split('## Template ').slice(1);
    const templates = blocks.map(b => {
      const lines = b.split('\n');
      const name = 'Template ' + lines[0].trim();
      const subjectLine = lines.find(l => l.includes('**Subject:**'));
      const subject = subjectLine ? subjectLine.replace('**Subject:**', '').trim() : '';
      const bodyStartIndex = lines.findIndex(l => l.includes('**Subject:**')) + 1;
      const body = lines.slice(bodyStartIndex).join('\n').trim();
      return { id: name, name, subject, body };
    });
    res.json(templates);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/outreach-log', (req, res) => {
  try {
    const p = path.join(VAULT_PATH, 'outreach-log.md');
    if (!fs.existsSync(p)) return res.json({ content: '' });
    const content = fs.readFileSync(p, 'utf-8');
    res.json({ content });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
