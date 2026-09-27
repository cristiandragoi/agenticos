/**
 * ControlPlaneExecutor.ts — Multi-Surface Action Executor
 *
 * Implements execution across all 11 surfaces identified by CapabilityDiscovery:
 * - Browser URLs & PWAs
 * - Windows Shortcuts (.lnk)
 * - Windows Executables (.exe)
 * - AppUserModelIDs (Store / UWP apps)
 * - Windows Shell commands
 * - Process foregrounding
 * - Internal AgenticOS entities
 */

import { spawn, exec } from 'node:child_process';
import { promisify } from 'node:util';
import { logger } from '../../utils/logger.js';
import { projectsStore } from '../../services/projectsStore.js';

const execAsync = promisify(exec);

export class ControlPlaneExecutor {
  private static instance: ControlPlaneExecutor;

  private constructor() {}

  public static getInstance(): ControlPlaneExecutor {
    if (!ControlPlaneExecutor.instance) {
      ControlPlaneExecutor.instance = new ControlPlaneExecutor();
    }
    return ControlPlaneExecutor.instance;
  }

  /**
   * Execute an action across any discovered execution surface.
   */
  public async execute(strategy: {
    surface: string;
    target: string;
    parameters?: Record<string, any>;
  }): Promise<{ executed: boolean; error?: string }> {
    const { surface, target, parameters } = strategy;

    try {
      switch (surface) {
        case 'browser': {
          const url = parameters?.url || target;
          return this.openBrowser(url);
        }

        case 'taskbar':
        case 'start_menu':
        case 'desktop': {
          const lnkPath = parameters?.shortcutPath || target;
          return this.launchShortcut(lnkPath);
        }

        case 'desktop_observe': {
          const { desktopPerceptionService } = await import('../../services/perception/DesktopPerceptionService.js');
          const res = await desktopPerceptionService.inspectWindow(parameters?.targetWindow || target);
          if (parameters) {
            parameters.__inspectionResult = res;
          }
          return { executed: res.success, error: res.error };
        }

        case 'screenshot': {
          const { desktopPerceptionService } = await import('../../services/perception/DesktopPerceptionService.js');
          const shot = await desktopPerceptionService.captureScreen({ targetWindow: parameters?.targetWindow });
          if (parameters) {
            parameters.__screenshotArtifact = shot;
          }
          return { executed: shot.success && shot.byteSize > 1024, error: shot.success ? undefined : 'Screenshot capture failed' };
        }

        case 'executable': {
          const exePath = parameters?.executablePath || target;
          return this.launchExecutable(exePath);
        }

        case 'app_user_model_id': {
          const appId = parameters?.appUserModelId || target;
          return this.launchAppUserModelId(appId);
        }

        case 'process': {
          const pid = parameters?.pid;
          const procName = parameters?.processName || target;
          return this.foregroundProcess(pid, procName);
        }

        case 'internal': {
          return this.executeInternal(target, parameters);
        }

        case 'shell': {
          const cmd = parameters?.command || target;
          return this.executeShell(cmd);
        }

        case 'camera': {
          const { cameraPerceptionService } = await import('../../services/perception/CameraPerceptionService.js');
          const q = parameters?.prompt || parameters?.userQuestion || target;
          const perception = await cameraPerceptionService.perceive(q);
          return { executed: true };
        }

        case 'location': {
          const { locationService } = await import('../../services/perception/LocationService.js');
          await locationService.readLocation();
          return { executed: true };
        }

        case 'learned': {
          if (parameters?.url) return this.openBrowser(parameters.url);
          if (parameters?.executablePath) return this.launchExecutable(parameters.executablePath);
          if (parameters?.resolvedCommand) return this.executeShell(parameters.resolvedCommand);
          if (target.includes('camera') || parameters?.capability === 'camera.perceive') {
            const { cameraPerceptionService } = await import('../../services/perception/CameraPerceptionService.js');
            await cameraPerceptionService.perceive(parameters?.prompt || target);
            return { executed: true };
          }
          if (target.includes('location') || parameters?.capability === 'location.read') {
            const { locationService } = await import('../../services/perception/LocationService.js');
            await locationService.readLocation();
            return { executed: true };
          }
          return this.executeShell(`start "" "${target}"`);
        }

        default: {
          return this.executeShell(`start "" "${target}"`);
        }
      }
    } catch (err: any) {
      logger.error(`[ControlPlaneExecutor] Execution failed for ${surface}:${target}: ${err?.message}`);
      return { executed: false, error: err?.message };
    }
  }

  private openBrowser(url: string): Promise<{ executed: boolean; error?: string }> {
    return new Promise(resolve => {
      try {
        if (process.platform === 'win32') {
          const child = spawn('cmd.exe', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' });
          child.unref();
          resolve({ executed: true });
        } else {
          const child = spawn('xdg-open', [url], { detached: true, stdio: 'ignore' });
          child.unref();
          resolve({ executed: true });
        }
      } catch (err: any) {
        resolve({ executed: false, error: err?.message });
      }
    });
  }

  private launchShortcut(shortcutPath: string): Promise<{ executed: boolean; error?: string }> {
    return new Promise(resolve => {
      try {
        const child = spawn('cmd.exe', ['/c', 'start', '', shortcutPath], { detached: true, stdio: 'ignore' });
        child.unref();
        resolve({ executed: true });
      } catch (err: any) {
        resolve({ executed: false, error: err?.message });
      }
    });
  }

  private launchExecutable(executablePath: string): Promise<{ executed: boolean; error?: string }> {
    return new Promise(resolve => {
      try {
        const child = spawn('cmd.exe', ['/c', 'start', '', executablePath], { detached: true, stdio: 'ignore' });
        child.unref();
        resolve({ executed: true });
      } catch (err: any) {
        resolve({ executed: false, error: err?.message });
      }
    });
  }

  private launchAppUserModelId(appId: string): Promise<{ executed: boolean; error?: string }> {
    return new Promise(resolve => {
      try {
        const child = spawn('explorer.exe', [`shell:AppsFolder\\${appId}`], { detached: true, stdio: 'ignore' });
        child.unref();
        resolve({ executed: true });
      } catch (err: any) {
        resolve({ executed: false, error: err?.message });
      }
    });
  }

  private async foregroundProcess(pid?: number, processName?: string): Promise<{ executed: boolean; error?: string }> {
    try {
      if (process.platform === 'win32') {
        const script = `
          $proc = ${pid ? `Get-Process -Id ${pid} -ErrorAction SilentlyContinue` : `Get-Process -Name '${processName}' -ErrorAction SilentlyContinue | Select-Object -First 1`}
          if ($proc -and $proc.MainWindowHandle -ne 0) {
            $wscript = New-Object -ComObject WScript.Shell
            $wscript.AppActivate($proc.Id)
            "OK"
          } else {
            "NO_WINDOW"
          }
        `;
        await execAsync(`powershell -NoProfile -Command "${script.replace(/\r?\n/g, ' ')}"`, { timeout: 3000 });
      }
      return { executed: true };
    } catch (err: any) {
      return { executed: false, error: err?.message };
    }
  }

  private async executeInternal(target: string, parameters?: Record<string, any>): Promise<{ executed: boolean; error?: string }> {
    const entityType = parameters?.entityType || 'project';
    const entityId = parameters?.entityId || target;
    const verb = parameters?.verb || 'operate';

    // Check dynamic capabilities (e.g. registered after engineering self-heal)
    try {
      const { getDynamicCapabilities } = await import('../jarvisNext/turnRouter.js');
      const dynamicCaps = getDynamicCapabilities();
      const handler = dynamicCaps.get(`${verb}:${entityType}`.toLowerCase()) || dynamicCaps.get(verb.toLowerCase());
      if (handler) {
        const outcome = await handler({
          entityId,
          entityName: parameters?.entityName || target,
          entityType,
          prompt: parameters?.prompt || `${verb} ${target}`,
          lower: (parameters?.prompt || `${verb} ${target}`).toLowerCase(),
          conversationId: parameters?.conversationId || 'default',
        });
        return { executed: outcome.executed, error: outcome.verified ? undefined : outcome.text };
      }
    } catch {}

    if (entityType === 'project') {
      if (verb === 'start' || verb === 'operate' || verb === 'run' || verb === 'continue') {
        const { operateProject } = await import('../../services/projectExecution/projectController.js');
        const outcome = await operateProject({
          projectId: entityId,
          conversationId: parameters?.conversationId,
        });
        return { executed: outcome.executed };
      }

      // Capability is not currently wired in AgenticOS
      return {
        executed: false,
        error: `Capability jarvis.capability.${verb}.${entityId} is not wired to entity type ${entityType}.`,
      };
    }

    return { executed: false, error: `Unsupported internal entity type ${entityType} for action ${verb}.` };
  }

  private async executeShell(cmd: string): Promise<{ executed: boolean; error?: string }> {
    try {
      await execAsync(cmd, { timeout: 10000 });
      return { executed: true };
    } catch (err: any) {
      return { executed: false, error: err?.message };
    }
  }
}

export const controlPlaneExecutor = ControlPlaneExecutor.getInstance();
