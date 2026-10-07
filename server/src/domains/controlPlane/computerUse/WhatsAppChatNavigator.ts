import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolveScriptPath } from '../../../utils/scriptResolver.js';
import { currentTurnOwnership } from '../../jarvis/perception/turnOwnership.js';
import { guardExternalSideEffect } from '../../jarvis/perception/perceptionOperation.js';
import { authoritativeDesktopComputerUseProvider as desktop, type ImmutableTargetIdentity } from './AuthoritativeDesktopComputerUseProvider.js';

const run = promisify(execFile);
export interface OcrLine { text: string; x: number; y: number; width: number; height: number }
export interface ChatScreen { width: number; height: number; lines: OcrLine[]; screenshotPath?: string }
const nameKey = (value: string) => value.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/** Layout is anchored to the observed Chats heading, never to desktop coordinates. */
export function inspectWhatsAppChat(screen: ChatScreen, requested: string) {
  const lines = screen.lines.filter(line => [line.x, line.y, line.width, line.height].every(Number.isFinite) && line.width > 0 && line.height > 0);
  const anchor = lines.find(line => /^chats$/i.test(line.text.trim()) && line.y < screen.height / 4);
  if (!anchor || !nameKey(requested)) return { header: undefined, contacts: [] as OcrLine[], search: undefined };
  const edge = anchor.x + anchor.width + anchor.height * 3;
  const center = (line: OcrLine) => line.y + line.height / 2;
  const header = lines.find(line => nameKey(line.text) === nameKey(requested) && line.x > edge && Math.abs(center(line) - center(anchor)) <= anchor.height * 1.3);
  const search = lines.find(line => line.x < edge && line.y > anchor.y + anchor.height && line.y < anchor.y + anchor.height * 5 && /(?:search|uchen|neuen\s+chat|new\s+chat)/i.test(line.text));
  const contacts = lines.filter(line => nameKey(line.text) === nameKey(requested) && line.x < edge && line.y > anchor.y + anchor.height * 5);
  return { header, contacts, search };
}

/** Ground visual-reader candidates in the same screenshot, never model array order or sender guesses. */
export function groundWhatsAppMessages(screen: ChatScreen, requested: string, candidates: ReadonlyArray<{ text: string }>, count: number) {
  const header = inspectWhatsAppChat(screen, requested).header;
  if (!header || !Number.isInteger(count) || count < 1) return [];
  const textKey = (text: string) => { const key = nameKey(text); return /[a-z]/i.test(key) ? key.replace(/0/g, 'o') : key; };
  const grounded = candidates.flatMap(message => {
    const matches = screen.lines.filter(line => line.x >= header.x - 25 && line.y > header.y + header.height * 3 &&
      line.y < screen.height - 65 && textKey(line.text) === textKey(message.text));
    if (matches.length !== 1) return [];
    return [{ text: message.text, sender: '', time: '', index: 0, top: matches[0].y, autoId: `ocr-${matches[0].x}-${matches[0].y}` }];
  }).sort((a, b) => a.top - b.top);
  const unique = grounded.filter((message, index) => !grounded.slice(0, index).some(other => other.autoId === message.autoId));
  // This conservative path supports a latest text bubble near the composer. Other layouts fail closed.
  if (unique.length < count || unique.at(-1)!.top < screen.height * .65) return [];
  const lowerText = screen.lines.some(line => line.x >= header.x - 25 && line.y > unique.at(-1)!.top + 5 && line.y < screen.height - 65 &&
    !/^\d{1,2}:\d{2}(?:\s*[a-z✓✔]+)?$/i.test(line.text.trim()));
  if (lowerText) return []; // A newer visible item was not returned by the reader.
  return unique.slice(-count).map((message, index) => ({ ...message, index: index + 1 }));
}

export async function groundWhatsAppScreenshot(screenshotPath: string, requested: string, candidates: ReadonlyArray<{ text: string }>, count: number) {
  const { stdout } = await run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', resolveScriptPath('run_ocr.ps1'), '-ImagePath', screenshotPath, '-Structured'], { timeout: 6000, windowsHide: true, maxBuffer: 1024 * 1024 });
  return groundWhatsAppMessages(JSON.parse(stdout.replace(/^\uFEFF/, '')), requested, candidates, count);
}

export async function selectWhatsAppConversation(target: ImmutableTargetIdentity, requested: string, correlationId: string, options: { observeOnly?: boolean } = {}) {
  if (/\b(?:and|then)\s+(?:read|send|write|open)\b/i.test(requested)) {
    return { verified: false, reason: 'The conversation name contains an unseparated instruction.' };
  }
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'agenticos-whatsapp-proof-'));
  let sequence = 0;
  const checkOwner = () => {
    const owner = currentTurnOwnership();
    if (owner && !guardExternalSideEffect({ ...owner, capability: 'gui_launch' }).ok) throw new Error('Chat navigation cancelled or superseded.');
  };
  const capture = async (): Promise<ChatScreen> => {
    checkOwner();
    const observed = await desktop.observe(target, correlationId);
    if (!observed.success || !observed.isForeground) throw new Error('WhatsApp is no longer the verified foreground window.');
    const screenshotPath = path.join(folder, `chat-${sequence++}.png`);
    await run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', resolveScriptPath('take_screenshot.ps1'), '-Hwnd', String(target.hwnd), '-OutputFile', screenshotPath], { timeout: 5000, windowsHide: true });
    const { stdout } = await run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', resolveScriptPath('run_ocr.ps1'), '-ImagePath', screenshotPath, '-Structured'], { timeout: 6000, windowsHide: true, maxBuffer: 1024 * 1024 });
    checkOwner();
    const data = JSON.parse(stdout.replace(/^\uFEFF/, ''));
    if (!Array.isArray(data.lines) || data.width <= 0 || data.height <= 0) throw new Error('No usable WhatsApp screen evidence.');
    return { ...data, screenshotPath };
  };
  const click = async (line: OcrLine) => {
    checkOwner();
    const current = await desktop.observe(target, correlationId);
    if (!current.success || !current.isForeground) throw new Error('WhatsApp lost foreground before selection.');
    const result = await desktop.act(target, { type: 'CLICK', coordinates: { x: line.x + line.width / 2, y: line.y + line.height / 2 } }, correlationId);
    if (!result.success) throw new Error(result.error || 'Contact click failed.');
  };
  let screen = await capture();
  let found = inspectWhatsAppChat(screen, requested);
  let selectionPerformed = false;
  if (options.observeOnly) return { verified: Boolean(found.header), hwnd: target.hwnd, pid: target.pid, requested,
    header: found.header, screenshotPath: screen.screenshotPath, observedAt: Date.now(), selectionPerformed };
  // OCR coordinates do not prove keyboard focus belongs to the search field.
  // Until that control can be verified, navigation is click-only; never type into a chat.
  if (!found.header) {
    if (found.contacts.length !== 1) return { verified: false, reason: found.contacts.length > 1 ? 'Multiple exact contact matches are visible.' : 'No unique exact contact match is visible.' };
    await click(found.contacts[0]);
    selectionPerformed = true;
    await new Promise(resolve => setTimeout(resolve, 300));
    screen = await capture(); found = inspectWhatsAppChat(screen, requested);
  }
  checkOwner();
  return { verified: Boolean(found.header), reason: found.header ? undefined : 'The requested name was not found in the selected conversation header.',
    hwnd: target.hwnd, pid: target.pid, requested, header: found.header, screenshotPath: screen.screenshotPath, observedAt: Date.now(), selectionPerformed };
}

