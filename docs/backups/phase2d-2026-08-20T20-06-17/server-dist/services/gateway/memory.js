import { logger } from '../../utils/logger.js';
import fs from 'fs';
import path from 'path';
import { GatewayShutdownManager } from './shutdown.js';
export class WorkspaceMemoryManager {
    memoryPath;
    memory;
    dirty = false;
    flushTimeout = null;
    // Cache to prevent reading disk on every instantiation
    static cache = new Map();
    constructor(workspaceRoot, projectId) {
        const resolvedRoot = path.resolve(workspaceRoot);
        const safeProjectId = projectId.replace(/[^a-zA-Z0-9_-]/g, '');
        this.memoryPath = path.resolve(path.join(resolvedRoot, `workspace-${safeProjectId}.json`));
        if (!this.memoryPath.startsWith(resolvedRoot)) {
            throw new Error('Path traversal detected in workspace memory initialization');
        }
        const dir = path.dirname(this.memoryPath);
        if (!fs.existsSync(dir))
            fs.mkdirSync(dir, { recursive: true });
        this.memory = this.loadMemory(projectId, workspaceRoot);
        GatewayShutdownManager.getInstance().register(async () => {
            await this.flushAsync();
        });
    }
    static getInstance(workspaceRoot, projectId) {
        const key = `${workspaceRoot}:${projectId}`;
        if (!this.cache.has(key)) {
            this.cache.set(key, new WorkspaceMemoryManager(workspaceRoot, projectId));
        }
        return this.cache.get(key);
    }
    loadMemory(projectId, workspaceRoot) {
        if (fs.existsSync(this.memoryPath)) {
            try {
                const data = fs.readFileSync(this.memoryPath, 'utf8');
                return JSON.parse(data);
            }
            catch (err) { }
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
    scheduleSave() {
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
    async flushAsync() {
        if (this.dirty) {
            this.dirty = false;
            const tmpPath = `${this.memoryPath}.tmp`;
            try {
                await fs.promises.writeFile(tmpPath, JSON.stringify(this.memory, null, 2), 'utf8');
                await fs.promises.rename(tmpPath, this.memoryPath);
            }
            catch (err) {
                logger.error('Failed to flush workspace memory:', err);
            }
        }
    }
    getMemory() {
        return this.memory;
    }
    addHistory(entry) {
        this.memory.gatewayHistory.push(entry);
        this.scheduleSave();
    }
    addArtifact(artifactPath) {
        if (!this.memory.generatedArtifacts.includes(artifactPath)) {
            this.memory.generatedArtifacts.push(artifactPath);
            this.scheduleSave();
        }
    }
    updateSummary(summary) {
        this.memory.projectSummary = summary;
        this.scheduleSave();
    }
}
