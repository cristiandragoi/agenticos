import { logger } from '../../utils/logger.js';
export class GatewayShutdownManager {
  private static instance: GatewayShutdownManager;
  private tasks: Array<() => Promise<void> | void> = [];
  private isShuttingDown = false;
  private hasRegistered = false;
  private MAX_TIMEOUT_MS = 3000;

  private constructor() {}

  public static getInstance(): GatewayShutdownManager {
    if (!GatewayShutdownManager.instance) {
      GatewayShutdownManager.instance = new GatewayShutdownManager();
    }
    return GatewayShutdownManager.instance;
  }

  public register(task: () => Promise<void> | void) {
    this.tasks.push(task);
    if (!this.hasRegistered) {
      this.hasRegistered = true;
      process.on('SIGINT', () => this.shutdown());
      process.on('SIGTERM', () => this.shutdown());
    }
  }

  public async shutdown() {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;
    
    logger.info('GatewayShutdownManager: Initiating graceful shutdown...');

    const flushPromises = this.tasks.map(async (task) => {
      try {
        await task();
      } catch (err) {
        logger.error('Error during shutdown task:', err);
      }
    });

    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Shutdown timeout exceeded')), this.MAX_TIMEOUT_MS)
    );

    try {
      await Promise.race([Promise.all(flushPromises), timeoutPromise]);
      logger.info('GatewayShutdownManager: Graceful shutdown complete.');
      process.exit(0);
    } catch (err) {
      logger.error('GatewayShutdownManager: Shutdown forced:', err);
      process.exit(1);
    }
  }
}
