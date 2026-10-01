import * as fs from 'fs';
import path from 'path';
import { Lead } from './runWorkflow.js';

const LEADS_FILE = path.join(process.env.APPDATA || process.env.LOCALAPPDATA || 'C:/Users/cd-pr/AppData/Local', 'agenticos-leads.json');

export class LeadRepository {
  private leads: Lead[] = [];

  async init(): Promise<void> {
    if (fs.existsSync(LEADS_FILE)) {
      const content = fs.readFileSync(LEADS_FILE, 'utf-8');
      try {
        this.leads = JSON.parse(content);
      } catch {
        this.leads = [];
      }
    }
  }

  async create(lead: Lead): Promise<Lead> {
    const newLead: Lead = {
      ...lead,
      id: lead.id || `lead_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    };
    this.leads.push(newLead);
    await this.persist();
    return newLead;
  }

  async update(id: string, updates: Partial<Lead>): Promise<Lead | null> {
    const index = this.leads.findIndex(l => l.id === id);
    if (index === -1) return null;
    this.leads[index] = { ...this.leads[index], ...updates };
    await this.persist();
    return this.leads[index];
  }

  async getById(id: string): Promise<Lead | null> {
    return this.leads.find(l => l.id === id) || null;
  }

  async findAll(): Promise<Lead[]> {
    return [...this.leads];
  }

  async deduplicate(companyName: string, website: string): Promise<boolean> {
    const normalized = (s: string) => s.toLowerCase().replace(/\s+/g, '').replace(/www\./, '').replace(/https?:\/\//, '');
    return this.leads.some(l => 
      normalized(l.company_name || '').includes(normalized(companyName)) ||
      (l.website && normalized(l.website).includes(normalized(website)))
    );
  }

  private async persist(): Promise<void> {
    fs.writeFileSync(LEADS_FILE, JSON.stringify(this.leads, null, 2));
  }
}

export const leadRepository = new LeadRepository();
