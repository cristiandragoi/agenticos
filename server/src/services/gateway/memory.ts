import { logger } from '../../utils/logger.js';
import fs from 'fs';
import path from 'path';
import { GatewayShutdownManager } from './shutdown.js';

export interface WorkspaceMemory {
  projectId: string;
  projectPath: string;
  projectSummary: string;
  preferredProvider: string;
  gatewayHistory: any[];
  importantSnippets: string[];
  generatedArtifacts: string[];
}

export class WorkspaceMemoryManager {
  private memoryPath: string;
  private memory: WorkspaceMemory;
  private dirty = false;
  private flushTimeout: NodeJS.Timeout | null = null;
  
  // Cache to prevent reading disk on every instantiation
  private static cache: Map<string, WorkspaceMemoryManager> = new Map();

  private constructor(workspaceRoot: string, projectId: string) {
    const resolvedRoot = path.resolve(workspaceRoot);
    const safeProjectId = projectId.replace(/[^a-zA-Z0-9_-]/g, '');
    this.memoryPath = path.resolve(path.join(resolvedRoot, `workspace-${safeProjectId}.json`));
    
    if (!this.memoryPath.startsWith(resolvedRoot)) {
      throw new Error('Path traversal detected in workspace memory initialization');
    }

    const dir = path.dirname(this.memoryPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    
    this.memory = this.loadMemory(projectId, workspaceRoot);
    
    GatewayShutdownManager.getInstance().register(async () => {
      await this.flushAsync();
    });
  }
  
  public static getInstance(workspaceRoot: string, projectId: string): WorkspaceMemoryManager {
    const key = `${workspaceRoot}:${projectId}`;
    if (!this.cache.has(key)) {
      this.cache.set(key, new WorkspaceMemoryManager(workspaceRoot, projectId));
    }
    return this.cache.get(key)!;
  }

  private loadMemory(projectId: string, workspaceRoot: string): WorkspaceMemory {
    if (fs.existsSync(this.memoryPath)) {
      try {
        const data = fs.readFileSync(this.memoryPath, 'utf8');
        return JSON.parse(data);
      } catch (err) {}
    }
    
    return {
      projectId,
      projectPath: workspaceRoot,
      projectSummary: '',
      preferredProvider: 'omniroot',
      gatewayHistory: [],
      importantSnippets: [],
      generatedArtifacts: []
    };
  }

  private scheduleSave() {
    this.dirty = true;
    if (!this.flushTimeout) {
      this.flushTimeout = setTimeout(() => {
        this.flushTimeout = null;
        if (this.dirty) {
           this.dirty = false;
           fs.promises.writeFile(this.memoryPath, JSON.stringify(this.memory, null, 2), 'utf8').catch(logger.error);
        }
      }, 5000);
    }
  }

  private async flushAsync() {
    if (this.dirty) {
      this.dirty = false;
      const tmpPath = `${this.memoryPath}.tmp`;
      try {
        await fs.promises.writeFile(tmpPath, JSON.stringify(this.memory, null, 2), 'utf8');
        await fs.promises.rename(tmpPath, this.memoryPath);
      } catch (err) {
        logger.error('Failed to flush workspace memory:', err);
      }
    }
  }

  public getMemory(): WorkspaceMemory {
    return this.memory;
  }

  public addHistory(entry: any) {
    this.memory.gatewayHistory.push(entry);
    this.scheduleSave();
  }

  public addArtifact(artifactPath: string) {
    if (!this.memory.generatedArtifacts.includes(artifactPath)) {
      this.memory.generatedArtifacts.push(artifactPath);
      this.scheduleSave();
    }
  }

  public updateSummary(summary: string) {
    this.memory.projectSummary = summary;
    this.scheduleSave();
  }
}
