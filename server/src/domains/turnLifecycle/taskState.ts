/**
 * turnLifecycle/taskState.ts — Authoritative desktop task state.
 *
 * Tracks active desktop tasks across turns, verifying real window existence
 * and enabling instant recovery when the user asks "Wo ist das?" or "Ich sehe nichts".
 */
import { logger } from '../../utils/logger.js';
import { observeWindows } from './probes.js';
import { execFile } from 'node:child_process';
import path from 'node:path';

export interface ActiveDesktopTask {
  taskId: string;
  requestId: string;
  conversationId: string;
  type: 'OPEN_EMAIL' | 'COMPOSE_EMAIL' | 'LAUNCH_APP' | 'OPEN_URL';
  requestedApp: string; // e.g. 'comet', 'chrome'
  targetUrl?: string;
  hwnd?: number;
  pid?: number;
  windowTitle?: string;
  isForeground?: boolean;
  composeOpened?: boolean;
  pendingQuestion?: string;
  startedAt: string;
  updatedAt: string;
  lastVerifiedAt?: string;
  status: 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
  failureReason?: string;
}

let currentActiveTask: ActiveDesktopTask | null = null;

export function setActiveDesktopTask(task: ActiveDesktopTask): void {
  currentActiveTask = { ...task };
  logger.info('[TaskState] active desktop task updated', {
    taskId: task.taskId,
    type: task.type,
    requestedApp: task.requestedApp,
    hwnd: task.hwnd,
    title: task.windowTitle,
  });
}

export function getActiveDesktopTask(conversationId?: string): ActiveDesktopTask | null {
  if (!currentActiveTask) return null;
  // If the task was started more than 10 minutes ago, consider it expired
  const ageMs = Date.now() - Date.parse(currentActiveTask.updatedAt);
  if (ageMs > 10 * 60 * 1000) {
    currentActiveTask = null;
    return null;
  }
  return currentActiveTask;
}

export function clearActiveDesktopTask(): void {
  currentActiveTask = null;
}

export function isVisibilityQuery(text: string): boolean {
  const t = (text || '').toLowerCase().trim();
  const germanVisibility =
    /\b(?:wo\s+ist\s+(?:das|es|das\s+fenster|gmail|comet|der\s+browser))\b/i.test(t) ||
    /\b(?:ich\s+sehe\s+(?:nichts|kein\s+fenster|es\s+nicht|das\s+nicht))\b/i.test(t) ||
    /\b(?:da\s+ist\s+nichts|kann\s+nichts\s+sehen|wo\s+ist\s+denn\s+das)\b/i.test(t) ||
    /\b(?:wo\s+ist\s+das\??\s*ich\s+sehe\s+nichts)\b/i.test(t);

  const englishVisibility =
    /\b(?:where\s+is\s+(?:it|that|the\s+window|gmail|comet|the\s+browser))\b/i.test(t) ||
    /\b(?:i\s+(?:don't|do\s+not)\s+see\s+(?:it|anything|the\s+window)|i\s+see\s+nothing)\b/i.test(t) ||
    /\b(?:where\s+is\s+it\??\s*i\s+see\s+nothing)\b/i.test(t);

  return germanVisibility || englishVisibility;
}

async function focusWindow(hwnd: number): Promise<boolean> {
  const script = path.join(process.cwd(), 'server', 'scripts', 'lifecycle', 'lc_type_text.ps1');
  return new Promise((resolve) => {
    // Calling lc_type_text.ps1 with empty text just executes LcFg::Focus(hwnd)
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Hwnd', String(hwnd), '-TextB64', ''],
      { timeout: 8000, windowsHide: true },
      (err, stdout) => {
        try {
          const raw = JSON.parse(String(stdout || '').trim());
          resolve(Boolean(raw?.foregroundConfirmed));
        } catch {
          resolve(false);
        }
      }
    );
  });
}

export async function handleVisibilityRecovery(lang: string = 'de'): Promise<{ handled: boolean; responseText: string }> {
  const task = getActiveDesktopTask();
  if (!task) {
    return {
      handled: true,
      responseText: lang === 'de'
        ? 'Ich sehe aktuell kein aktives Fenster einer vorherigen Aufgabe. Was möchtest du öffnen?'
        : "I don't see any active window from a previous task. What would you like to open?",
    };
  }

  try {
    const obs = await observeWindows();
    const appLower = task.requestedApp.toLowerCase();
    
    // Look for task's specific HWND or any window matching the requested process/title
    let found = obs.windows.find((w) => task.hwnd && w.hwnd === task.hwnd);
    if (!found) {
      found = obs.windows.find((w) => {
        const proc = (w.process || '').toLowerCase();
        const title = (w.title || '').toLowerCase();
        return proc.includes(appLower) || (appLower === 'comet' && (proc === 'comet' || title.includes('comet')));
      });
    }

    if (found) {
      task.hwnd = found.hwnd;
      task.windowTitle = found.title;
      task.updatedAt = new Date().toISOString();

      const wasForeground = obs.foreground === found.hwnd;
      if (!wasForeground) {
        await focusWindow(found.hwnd);
      }

      const postObs = await observeWindows();
      const isNowForeground = postObs.foreground === found.hwnd;
      const appNameDisplay = task.requestedApp === 'comet' ? 'Comet' : task.requestedApp;

      let msg = '';
      if (lang === 'de') {
        if (!wasForeground && isNowForeground) {
          msg = `Das Fenster von ${appNameDisplay} mit Gmail war im Hintergrund. Ich habe es jetzt direkt für dich in den Vordergrund geholt.`;
        } else if (isNowForeground) {
          msg = `Das Fenster von ${appNameDisplay} mit Gmail ist direkt vor dir im Vordergrund geöffnet (Titel: „${found.title}“).`;
        } else {
          msg = `Das Fenster von ${appNameDisplay} ist geöffnet (Titel: „${found.title}“), aber konnte nicht vollständig in den Vordergrund fokussiert werden. Bitte klicke es in deiner Taskleiste an.`;
        }
        if (task.composeOpened) {
          msg += ` Der Entwurf für eine neue E-Mail ist bereit. An wen soll die E-Mail gehen?`;
        }
      } else {
        if (!wasForeground && isNowForeground) {
          msg = `The ${appNameDisplay} window was in the background. I have brought it to the foreground for you.`;
        } else if (isNowForeground) {
          msg = `The ${appNameDisplay} window with Gmail is open in the foreground (Title: "${found.title}").`;
        } else {
          msg = `The ${appNameDisplay} window is open, but could not be brought to the foreground automatically.`;
        }
        if (task.composeOpened) {
          msg += ` Who should the email go to?`;
        }
      }

      return { handled: true, responseText: msg };
    }

    // Window not found on desktop
    const appNameDisplay = task.requestedApp === 'comet' ? 'Comet' : task.requestedApp;
    const msg = lang === 'de'
      ? `Ich kann das Fenster von ${appNameDisplay} auf deinem Desktop nicht mehr finden. Es scheint geschlossen worden zu sein. Soll ich Gmail in ${appNameDisplay} noch einmal öffnen?`
      : `I cannot find the ${appNameDisplay} window on your desktop. It appears to have been closed. Would you like me to open Gmail in ${appNameDisplay} again?`;
    
    return { handled: true, responseText: msg };
  } catch (err: any) {
    logger.error('[TaskState] visibility recovery failed', err);
    return {
      handled: true,
      responseText: lang === 'de'
        ? `Ich konnte den Fensterstatus nicht prüfen: ${err?.message || 'Unbekannter Fehler'}.`
        : `Could not inspect window status: ${err?.message || 'Unknown error'}.`,
    };
  }
}
