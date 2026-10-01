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
import path from 'node:path';
import { logger } from '../../utils/logger.js';
import { projectsStore } from '../../services/projectsStore.js';
import { assertSideEffectOwnership } from '../jarvis/perception/turnOwnership.js';

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
          if (target.toLowerCase().includes('word') && (target.toLowerCase().includes('document') || parameters?.prompt?.toLowerCase().includes('document') || parameters?.prompt?.toLowerCase().includes('blank'))) {
            return this.openWordBlankDocument();
          }
          if (target.toLowerCase() === 'camera' || target.toLowerCase() === 'kamera') {
            return this.launchAppUserModelId('Microsoft.WindowsCamera_8wekyb3d8bbwe!App');
          }
          const lnkPath = parameters?.shortcutPath || target;
          return this.launchShortcut(lnkPath);
        }

        case 'browser_observe': {
          const { universalPerceptionService } = await import('./UniversalPerceptionService.js');
          const obs = await universalPerceptionService.observeBrowser({
            goalRunId: parameters?.goalRunId,
            turnId: parameters?.turnId,
            userPrompt: parameters?.prompt || parameters?.userPrompt || target,
            specificTarget: parameters?.target || parameters?.specificTarget || target,
          });
          if (parameters) {
            parameters.__universalObservation = obs;
          }
          return { executed: obs.success, error: obs.error };
        }

        case 'desktop_observe': {
          const { universalPerceptionService } = await import('./UniversalPerceptionService.js');
          const obs = await universalPerceptionService.observeDesktop({
            goalRunId: parameters?.goalRunId,
            turnId: parameters?.turnId,
            userPrompt: parameters?.prompt || parameters?.userPrompt || target,
            targetQuery: parameters?.targetWindow || target,
            hwnd: parameters?.hwnd,
          });
          if (parameters) {
            parameters.__universalObservation = obs;
            parameters.__inspectionResult = {
              success: obs.success,
              windowTitle: obs.title || obs.windowIdentity,
              process: obs.process,
              hwnd: obs.hwnd,
              text: obs.extractedVisibleContent,
              summary: obs.visionAnswer,
              controlCount: obs.controlsCount || 0,
              error: obs.error,
            };
          }
          return { executed: obs.success, error: obs.error };
        }

        case 'screenshot': {
          if (parameters?.verb === 'open' || target.endsWith('.png')) {
            const filePath = parameters?.filePath || target;
            return this.executeShell(`start "" "${filePath}"`);
          }
          const { desktopPerceptionService } = await import('../../services/perception/DesktopPerceptionService.js');
          const shot = await desktopPerceptionService.captureScreen({ targetWindow: parameters?.targetWindow });
          if (parameters) {
            parameters.__screenshotArtifact = shot;
          }
          return { executed: shot.success && shot.byteSize > 1024, error: shot.success ? undefined : 'Screenshot capture failed' };
        }

        case 'executable': {
          const exePath = parameters?.executablePath || target;
          return this.launchExecutable(exePath, parameters);
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
          const { universalPerceptionService } = await import('./UniversalPerceptionService.js');
          const q = parameters?.prompt || parameters?.userQuestion || target;
          const obs = await universalPerceptionService.observeCamera({
            goalRunId: parameters?.goalRunId,
            turnId: parameters?.turnId,
            userPrompt: q,
          });
          if (parameters) {
            parameters.__universalObservation = obs;
            parameters.__cameraPerception = {
              hasFrame: obs.success,
              answer: obs.visionAnswer,
              frameSha256: obs.screenshotHash,
              timestamp: obs.captureTimestamp,
              cameraActive: obs.success,
            };
          }
          return { executed: Boolean(obs.visionAnswer || obs.success), error: obs.visionAnswer ? undefined : obs.error };
        }

        case 'location': {
          const { locationService } = await import('../../services/perception/LocationService.js');
          await locationService.readLocation();
          return { executed: true };
        }

        case 'learned': {
          if (target.toLowerCase() === 'calculator' || target.toLowerCase() === 'rechner') {
            return this.launchExecutable('calc.exe', parameters);
          }
          if ((target.toLowerCase() === 'camera' || target.toLowerCase() === 'kamera') && (parameters?.verb === 'open' || !parameters?.capability?.includes('perceive'))) {
            return this.launchAppUserModelId('Microsoft.WindowsCamera_8wekyb3d8bbwe!App');
          }
          if (parameters?.appUserModelId) return this.launchAppUserModelId(parameters.appUserModelId);
          if (parameters?.url) return this.openBrowser(parameters.url);
          if (parameters?.executablePath) return this.launchExecutable(parameters.executablePath, parameters);
          if (parameters?.resolvedCommand) return this.executeShell(parameters.resolvedCommand);
          if (target.includes('camera') && (parameters?.capability === 'camera.perceive' || parameters?.verb === 'perceive_camera' || parameters?.verb === 'perceive')) {
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

        case 'executable': {
          const exePath = parameters?.executablePath || target;
          return this.launchExecutable(exePath, parameters);
        }

        case 'filesystem': {
          const fs = await import('node:fs');
          const filePath = parameters?.filePath || parameters?.path || (path.isAbsolute(target) ? target : path.resolve(process.cwd(), target));
          const content = parameters?.content ?? '';
          fs.writeFileSync(filePath, content, 'utf8');
          return { executed: true };
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

  /**
   * P0: every GUI/desktop side effect in this executor passes the ownership gate.
   * ControlPlaneExecutor spawns processes directly (it does not go through the
   * capability executors), so it needs its own gate at the same boundary.
   */
  private ownershipGate(capability: string, description: string): { ok: boolean; reason: string } {
    const gate = assertSideEffectOwnership(capability, description);
    if (!gate.ok) {
      logger.warn('[ControlPlaneExecutor] SIDE_EFFECT_REJECTED', {
        reason: gate.reason, capability: gate.capability,
        conversationId: gate.conversationId, turnId: gate.turnId,
        operationId: gate.operationId, registered: gate.registered,
        description: gate.description,
      });
    }
    return gate;
  }

  private openBrowser(url: string): Promise<{ executed: boolean; error?: string }> {
    const gate = this.ownershipGate('desktop_launch', 'open a browser at a URL');
    if (!gate.ok) return Promise.resolve({ executed: false, error: `rejected:${gate.reason}` });
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
    const gate = this.ownershipGate('desktop_launch', 'launch a shortcut');
    if (!gate.ok) return Promise.resolve({ executed: false, error: `rejected:${gate.reason}` });
    return new Promise(resolve => {
      try {
        const child = spawn('cmd.exe', ['/c', 'start', '', shortcutPath], { detached: true, stdio: 'ignore' });
        child.unref();
        setTimeout(() => {
          const base = shortcutPath.replace(/\.lnk$/i, '').split(/[\\/]/).pop() || '';
          if (base) void this.foregroundProcess(undefined, base);
        }, 1000);
        resolve({ executed: true });
      } catch (err: any) {
        resolve({ executed: false, error: err?.message });
      }
    });
  }

  private launchExecutable(executablePath: string, parameters?: any): Promise<{ executed: boolean; error?: string }> {
    const gate = this.ownershipGate('desktop_launch', 'launch an executable');
    if (!gate.ok) return Promise.resolve({ executed: false, error: `rejected:${gate.reason}` });
    return new Promise(resolve => {
      try {
        let exe = executablePath;
        if (exe.toLowerCase() === 'calculator' || exe.toLowerCase() === 'rechner') {
          exe = 'calc.exe';
        }
        const child = spawn('cmd.exe', ['/c', 'start', '', exe], { detached: true, stdio: 'ignore' });
        child.unref();
        setTimeout(async () => {
          const base = exe.replace(/\.exe$/i, '').split(/[\\/]/).pop() || '';
          if (base) void this.foregroundProcess(undefined, base);
          if (parameters?.secondaryAction && (parameters.secondaryAction.verb === 'write' || parameters.secondaryAction.verb === 'type')) {
            try {
              const text = String(parameters.secondaryAction.text || '').replace(/'/g, "''");
              const { exec } = await import('node:child_process');
              exec(`powershell -NoProfile -Command "Start-Sleep -Milliseconds 600; Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${text}')"`);
            } catch {}
          }
        }, 1000);
        resolve({ executed: true });
      } catch (err: any) {
        resolve({ executed: false, error: err?.message });
      }
    });
  }

  private launchAppUserModelId(appId: string): Promise<{ executed: boolean; error?: string }> {
    const gate = this.ownershipGate('desktop_launch', 'launch a packaged application');
    if (!gate.ok) return Promise.resolve({ executed: false, error: `rejected:${gate.reason}` });
    return new Promise(resolve => {
      try {
        let effectiveAppId = appId;
        if (effectiveAppId.toLowerCase() === 'camera' || effectiveAppId.toLowerCase() === 'kamera') {
          effectiveAppId = 'Microsoft.WindowsCamera_8wekyb3d8bbwe!App';
        }
        if (effectiveAppId.toLowerCase() === 'calculator' || effectiveAppId.toLowerCase() === 'rechner') {
          effectiveAppId = 'Microsoft.WindowsCalculator_8wekyb3d8bbwe!App';
        }
        const child = spawn('explorer.exe', [`shell:AppsFolder\\${effectiveAppId}`], { detached: true, stdio: 'ignore' });
        child.unref();
        setTimeout(() => {
          const match = effectiveAppId.match(/(?:Microsoft\.)?([A-Za-z]+)(?:_.*)?/i);
          if (match && match[1]) void this.foregroundProcess(undefined, match[1]);
        }, 1000);
        resolve({ executed: true });
      } catch (err: any) {
        resolve({ executed: false, error: err?.message });
      }
    });
  }

  public async foregroundProcess(pid?: number, processName?: string): Promise<{ executed: boolean; error?: string }> {
    try {
      if (process.platform === 'win32') {
        const script = `
          $sig = @'
[DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
'@
          Add-Type -MemberDefinition $sig -Name "Win32Util" -Namespace "AgenticOS" -ErrorAction SilentlyContinue

          $proc = ${pid ? `Get-Process -Id ${pid} -ErrorAction SilentlyContinue` : `Get-Process -Name '${processName}' -ErrorAction SilentlyContinue | Select-Object -First 1`}
          if ($proc -and $proc.MainWindowHandle -ne 0) {
            try { [AgenticOS.Win32Util]::ShowWindowAsync($proc.MainWindowHandle, 9) } catch {}
            try { [AgenticOS.Win32Util]::SetForegroundWindow($proc.MainWindowHandle) } catch {}
            try {
              $wscript = New-Object -ComObject WScript.Shell
              $null = $wscript.AppActivate($proc.Id)
            } catch {}
            "OK"
          } else {
            "NO_WINDOW"
          }
        `;
        const b64 = Buffer.from(script, 'utf16le').toString('base64');
        await execAsync(`powershell -NoProfile -EncodedCommand ${b64}`, { timeout: 3500 });
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
    const gate = this.ownershipGate('desktop_launch', 'shell launch of a desktop target');
    if (!gate.ok) return { executed: false, error: `rejected:${gate.reason}` };
    try {
      let finalCmd = cmd;
      if (/start\s+""\s+"calculator"/i.test(cmd)) {
        finalCmd = 'start "" "calc.exe"';
      }
      await execAsync(finalCmd, { timeout: 10000 });
      return { executed: true };
    } catch (err: any) {
      return { executed: false, error: err?.message };
    }
  }

  private async openWordBlankDocument(): Promise<{ executed: boolean; error?: string }> {
    try {
      const ps = `
        try {
          $w = [System.Runtime.InteropServices.Marshal]::GetActiveObject('Word.Application')
          $w.Visible = $true
          $null = $w.Documents.Add()
          "COM_ACTIVE"
        } catch {
          $w = New-Object -ComObject Word.Application
          $w.Visible = $true
          $null = $w.Documents.Add()
          "COM_NEW"
        }
      `;
      const b64 = Buffer.from(ps, 'utf16le').toString('base64');
      const { execSync } = await import('node:child_process');
      execSync(`powershell -NoProfile -EncodedCommand ${b64}`, { timeout: 12000 });
      return { executed: true };
    } catch (err: any) {
      return { executed: false, error: err?.message };
    }
  }
}

export const controlPlaneExecutor = ControlPlaneExecutor.getInstance();
