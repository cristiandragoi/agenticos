import { logger } from '../utils/logger.js';
import fs from 'fs';
import path from 'path';
import { db } from './db.js';

const VAULT_PATH = 'C:\\Users\\Cris\\obsidian-vault\\projects\\welders-de-nl';

interface ResearchJob {
  id: string;
  status: 'running' | 'completed' | 'failed';
  progress: number; // 0 to 100
  background: boolean;
  resultFile?: string;
  error?: string;
  createdAt: string;
  completedAt?: string;
}

export class GeminiInteractionsService {
  private jobs = new Map<string, ResearchJob>();

  private ensureDirectory() {
    if (!fs.existsSync(VAULT_PATH)) {
      fs.mkdirSync(VAULT_PATH, { recursive: true });
    }
  }

  private async callLLM(prompt: string, model: string = 'openai/gpt-4o-mini'): Promise<string> {
    const isOpenRouter = !model.startsWith('gemini');
    const url = isOpenRouter
      ? 'https://openrouter.ai/api/v1/chat/completions'
      : 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
    const apiKey = isOpenRouter ? process.env.OPENROUTER_API_KEY : process.env.GOOGLE_API_KEY;

    if (!apiKey) throw new Error(`${isOpenRouter ? 'OPENROUTER_API_KEY' : 'GOOGLE_API_KEY'} is not configured on the server.`);

    logger.info(`[LLM Service] Sending request to ${url} with model ${model}`);
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!res.ok) {
      throw new Error(`API Error from ${model}: ${await res.text()}`);
    }

    const data: any = await res.json();
    return data.choices?.[0]?.message?.content || '';
  }

  public async startWeldersResearch(background: boolean): Promise<ResearchJob> {
    const jobId = `job-${Date.now()}`;
    const job: ResearchJob = {
      id: jobId,
      status: 'running',
      progress: 10,
      background,
      createdAt: new Date().toISOString()
    };
    this.jobs.set(jobId, job);

    const prompt = `
      You are an expert recruiter researcher. Research job boards and company sites in Germany and the Netherlands looking for welders.
      Identify at least 10 sources (job boards, company career pages, recruiting agencies).
      Produce a structured report with:
      - site name
      - type (job board/company/agency)
      - country (DE/NL)
      - link to welders job postings
      - any relevant notes (volume, recurring demand)
      
      Format your response strictly as Markdown.
    `;

    if (background) {
      // Background execution
      this.executeBackgroundResearch(jobId, prompt);
      return job;
    } else {
      // Interactive/Synchronous execution
      try {
        job.progress = 50;
        const report = await this.callLLM(prompt, 'openai/gpt-4o-mini');
        this.ensureDirectory();
        
        const reportPath = path.join(VAULT_PATH, 'research-report.md');
        fs.writeFileSync(reportPath, report);
        
        job.status = 'completed';
        job.progress = 100;
        job.resultFile = 'research-report.md';
        job.completedAt = new Date().toISOString();
        
        this.saveToMemoryGalaxy('Welders Lead Research Report', `Completed welders research. Stored at ${reportPath}`);
      } catch (err: any) {
        job.status = 'failed';
        job.error = err.message;
      }
      return job;
    }
  }

  private async executeBackgroundResearch(jobId: string, prompt: string) {
    const job = this.jobs.get(jobId);
    if (!job) return;

    try {
      // Simulate progress updates
      await new Promise(r => setTimeout(r, 2000));
      job.progress = 40;
      
      await new Promise(r => setTimeout(r, 2000));
      job.progress = 70;

      const report = await this.callLLM(prompt, 'openai/gpt-4o-mini');
      this.ensureDirectory();
      
      const reportPath = path.join(VAULT_PATH, 'research-report.md');
      fs.writeFileSync(reportPath, report);

      job.status = 'completed';
      job.progress = 100;
      job.resultFile = 'research-report.md';
      job.completedAt = new Date().toISOString();

      this.saveToMemoryGalaxy('Background Welders Research', `Completed background research job ${jobId}. Saved to Obsidian.`);
    } catch (err: any) {
      logger.error(`[Gemini Service] Job ${jobId} failed:`, err);
      job.status = 'failed';
      job.error = err.message;
    }
  }

  public getJob(jobId: string): ResearchJob | undefined {
    return this.jobs.get(jobId);
  }

  public async generateEmailTemplates(interactivePrompt?: string): Promise<any> {
    const prompt = interactivePrompt || `
      Draft several cold email templates tailored to German and Dutch companies regarding welders staffing/placement.
      Provide options with different tones (formal, direct).
      Format as Markdown.
    `;

    const templates = await this.callLLM(prompt, 'openai/gpt-4o-mini');
    this.ensureDirectory();
    fs.writeFileSync(path.join(VAULT_PATH, 'email-templates.md'), templates);
    
    this.saveToMemoryGalaxy('Cold Email Templates Drafted', `Generated welders outreach templates in Obsidian.`);
    return { status: 'completed', templates };
  }

  private saveToMemoryGalaxy(key: string, content: string) {
    try {
      const entry = {
        id: `mem-ent-${Date.now()}`,
        scopeId: 'mem-global',
        key,
        title: key,
        kind: 'note' as const,
        content,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      db.memoryEntries.upsert(entry);
    } catch (err) {
      logger.error('[Gemini Service] Memory Galaxy log failed:', err);
    }
  }
}

export const geminiInteractionsService = new GeminiInteractionsService();
