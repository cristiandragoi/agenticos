import { logger } from '../utils/logger.js';
import fs from 'fs';
import path from 'path';
import { db } from './db.js';
const VAULT_PATH = 'C:\\Users\\Cris\\obsidian-vault\\projects\\welders-de-nl';
export class GeminiInteractionsService {
    jobs = new Map();
    ensureDirectory() {
        if (!fs.existsSync(VAULT_PATH)) {
            fs.mkdirSync(VAULT_PATH, { recursive: true });
        }
    }
    async callLLM(prompt, model = 'openai/gpt-4o-mini') {
        const isOpenRouter = !model.startsWith('gemini');
        const url = isOpenRouter
            ? 'https://openrouter.ai/api/v1/chat/completions'
            : 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
        const apiKey = isOpenRouter ? process.env.OPENROUTER_API_KEY : process.env.GOOGLE_API_KEY;
        if (!apiKey)
            throw new Error(`${isOpenRouter ? 'OPENROUTER_API_KEY' : 'GOOGLE_API_KEY'} is not configured on the server.`);
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
        const data = await res.json();
        return data.choices?.[0]?.message?.content || '';
    }
    async startWeldersResearch(background) {
        const jobId = `job-${Date.now()}`;
        const job = {
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
        }
        else {
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
            }
            catch (err) {
                job.status = 'failed';
                job.error = err.message;
            }
            return job;
        }
    }
    async executeBackgroundResearch(jobId, prompt) {
        const job = this.jobs.get(jobId);
        if (!job)
            return;
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
        }
        catch (err) {
            logger.error(`[Gemini Service] Job ${jobId} failed:`, err);
            job.status = 'failed';
            job.error = err.message;
        }
    }
    getJob(jobId) {
        return this.jobs.get(jobId);
    }
    async generateEmailTemplates(interactivePrompt) {
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
    saveToMemoryGalaxy(key, content) {
        try {
            const entry = {
                id: `mem-ent-${Date.now()}`,
                scopeId: 'mem-global',
                key,
                title: key,
                kind: 'note',
                content,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };
            db.memoryEntries.upsert(entry);
        }
        catch (err) {
            logger.error('[Gemini Service] Memory Galaxy log failed:', err);
        }
    }
}
export const geminiInteractionsService = new GeminiInteractionsService();
