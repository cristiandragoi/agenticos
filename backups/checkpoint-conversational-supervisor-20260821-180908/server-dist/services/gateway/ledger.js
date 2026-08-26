import { logger } from '../../utils/logger.js';
import fs from 'fs';
import path from 'path';
import { GatewayShutdownManager } from './shutdown.js';
export class GatewayRunLedger {
    ledgerPath;
    metricsPath;
    metrics = {};
    // Phase 2: Async debounced logging
    writeQueue = [];
    isWriting = false;
    flushTimeout = null;
    metricsDirty = false;
    constructor(logsPath) {
        // Prevent path traversal
        this.ledgerPath = path.resolve(logsPath);
        this.metricsPath = path.resolve(path.join(path.dirname(logsPath), 'gateway-metrics.json'));
        const dir = path.dirname(this.ledgerPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        this.loadMetrics();
        // Safe shutdown flush
        GatewayShutdownManager.getInstance().register(async () => {
            await this.flushAsync();
        });
    }
    loadMetrics() {
        if (fs.existsSync(this.metricsPath)) {
            try {
                this.metrics = JSON.parse(fs.readFileSync(this.metricsPath, 'utf8'));
            }
            catch (err) { }
        }
    }
    async flushAsync() {
        if (this.isWriting)
            return;
        this.isWriting = true;
        try {
            if (this.writeQueue.length > 0) {
                const payload = this.writeQueue.join('');
                this.writeQueue = [];
                await fs.promises.appendFile(this.ledgerPath, payload, 'utf8');
            }
            if (this.metricsDirty) {
                this.metricsDirty = false;
                const tmpPath = `${this.metricsPath}.tmp`;
                await fs.promises.writeFile(tmpPath, JSON.stringify(this.metrics, null, 2), 'utf8');
                await fs.promises.rename(tmpPath, this.metricsPath);
            }
        }
        catch (err) {
            logger.error('Failed to flush gateway ledger:', err);
        }
        finally {
            this.isWriting = false;
        }
    }
    scheduleFlush() {
        if (!this.flushTimeout) {
            this.flushTimeout = setTimeout(() => {
                this.flushTimeout = null;
                this.flushAsync();
            }, 5000); // 5s debounce
        }
    }
    getMetrics(provider) {
        if (!this.metrics[provider]) {
            this.metrics[provider] = {
                totalCalls: 0,
                totalSuccesses: 0,
                totalFailures: 0,
                totalTimeouts: 0,
                totalFallbacks: 0,
                averageLatencyMs: 0,
                totalPromptTokens: 0,
                totalCompletionTokens: 0,
                totalCost: 0
            };
        }
        return this.metrics[provider];
    }
    record(entry) {
        const fullEntry = {
            ...entry,
            timestamp: new Date().toISOString()
        };
        // Update metrics
        const pm = this.getMetrics(entry.provider);
        pm.totalCalls++;
        if (entry.status === 'success') {
            pm.totalSuccesses++;
        }
        else {
            if (entry.isProviderFault !== false) {
                pm.totalFailures++;
            }
        }
        pm.totalFallbacks += entry.fallbackAttempts;
        if (entry.responseMetadata?.error && typeof entry.responseMetadata.error === 'string') {
            if (entry.responseMetadata.error.toLowerCase().includes('timeout') || entry.responseMetadata.error.includes('abort')) {
                pm.totalTimeouts++;
            }
        }
        if (entry.promptTokens)
            pm.totalPromptTokens += entry.promptTokens;
        if (entry.completionTokens)
            pm.totalCompletionTokens += entry.completionTokens;
        if (entry.estimatedCost)
            pm.totalCost += entry.estimatedCost;
        // Rolling average
        if (pm.totalCalls === 1) {
            pm.averageLatencyMs = entry.latencyMs;
        }
        else {
            pm.averageLatencyMs = ((pm.averageLatencyMs * (pm.totalCalls - 1)) + entry.latencyMs) / pm.totalCalls;
        }
        this.metricsDirty = true;
        // Protect against unbounded memory growth
        if (this.writeQueue.length > 1000) {
            this.writeQueue.shift(); // Drop oldest entry to avoid OOM
        }
        this.writeQueue.push(JSON.stringify(fullEntry) + '\n');
        this.scheduleFlush();
    }
}
