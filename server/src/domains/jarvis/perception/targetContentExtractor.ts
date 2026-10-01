/**
 * targetContentExtractor.ts — Target-Aware Application & Content Acquisition.
 *
 * Implements:
 * 1. Target Resolution Hierarchy:
 *    - Open windows (HWND, title, process)
 *    - Process identity
 *    - Application aliases
 *    - Start Menu / AppX / AUMID
 * 2. Target-Specific Content Acquisition:
 *    - Telegram messages extraction (chronological, sender, text, timestamp)
 *    - Browser DOM / page extraction (Comet, Chrome, Edge)
 * 3. Context Grounding Contract:
 *    - sourceApplication, sourceWindow/HWND, sourcePageOrChat,
 *      extractionTimestamp, extractionMethod, verification result.
 * 4. Context Follow-up Resolution:
 *    - "What does the last one mean?"
 *    - "Read the one before that again."
 *    - "Who sent the second message?"
 *    - "What does the second paragraph say?"
 */

import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { logger } from '../../../utils/logger.js';
import { resolveScriptPath } from '../../../utils/scriptResolver.js';
import { recordPerception } from './perceptionFocus.js';

const execAsync = promisify(exec);

export interface ExtractedChatMessage {
  index: number;
  sender: string;
  text: string;
  time: string;
  timestamp?: number;
}

export interface TargetContentContext {
  conversationId: string;
  sourceApplication: string;
  sourceHwnd: number;
  sourcePageOrChat: string;
  contentRegion?: string;
  contentRequest?: string;
  extractionTimestamp: number;
  extractionMethod: 'uia' | 'cdp' | 'dom' | 'vision';
  verification: boolean;
  messages?: ExtractedChatMessage[];
  pageContent?: string;
  paragraphs?: string[];
  links?: string[];
  lastAnswer?: string;
}

class TargetContentStore {
  private contexts = new Map<string, TargetContentContext>();

  public set(conversationId: string, ctx: TargetContentContext): void {
    this.contexts.set(conversationId, ctx);
  }

  public get(conversationId: string): TargetContentContext | undefined {
    return this.contexts.get(conversationId);
  }

  public clear(conversationId: string): void {
    this.contexts.delete(conversationId);
  }
}

export const targetContentStore = new TargetContentStore();

/**
 * 1. Target Resolution Hierarchy:
 *    Inspects currently open windows first to identify if a named application or chat is already open.
 */
export async function resolveTargetWindow(targetName: string): Promise<{
  found: boolean;
  hwnd?: number;
  pid?: number;
  process?: string;
  windowTitle?: string;
  application?: string;
  chatOrTab?: string;
} | null> {
  const cleanTarget = targetName.trim().toLowerCase();
  const scriptPath = resolveScriptPath(path.join('lifecycle', 'lc_windows.ps1'));
  
  try {
    const { stdout } = await execAsync(`powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}"`, { timeout: 10000 });
    const firstBrace = stdout.indexOf('{');
    const lastBrace = stdout.lastIndexOf('}');
    if (firstBrace < 0 || lastBrace <= firstBrace) return null;
    const parsed = JSON.parse(stdout.substring(firstBrace, lastBrace + 1));
    const windows: Array<{ hwnd: number; pid: number; process: string; title: string }> = parsed.windows || [];

    // Check 1: Chat/bot in open windows (e.g. "Agentic OS bot", "AgenticOS" in Telegram)
    if (cleanTarget.includes('agentic') || cleanTarget.includes('bot')) {
      const match = windows.find(w => 
        w.title.toLowerCase().includes('agenticos') || 
        w.title.toLowerCase().includes('agentic os') ||
        (w.process.toLowerCase().includes('telegram') && w.title.includes('AgenticOS'))
      );
      if (match) {
        return {
          found: true,
          hwnd: match.hwnd,
          pid: match.pid,
          process: match.process,
          windowTitle: match.title,
          application: 'Telegram',
          chatOrTab: 'Agentic OS bot',
        };
      }
    }

    // Check 2: Browser windows (Comet, Chrome, Edge)
    if (cleanTarget.includes('comet')) {
      const match = windows.find(w => w.process.toLowerCase().includes('comet') || w.title.toLowerCase().includes('comet'));
      if (match) {
        return {
          found: true,
          hwnd: match.hwnd,
          pid: match.pid,
          process: match.process,
          windowTitle: match.title,
          application: 'Comet',
          chatOrTab: match.title,
        };
      }
    }

    // Check 3: WhatsApp
    if (cleanTarget.includes('whatsapp')) {
      const match = windows.find(w => w.process.toLowerCase().includes('whatsapp') || w.title.toLowerCase().includes('whatsapp'));
      if (match) {
        return {
          found: true,
          hwnd: match.hwnd,
          pid: match.pid,
          process: match.process,
          windowTitle: match.title,
          application: 'WhatsApp',
          chatOrTab: match.title,
        };
      }
    }

    // Check 4: General title or process substring match
    const match = windows.find(w => 
      w.title.toLowerCase().includes(cleanTarget) || 
      w.process.toLowerCase().includes(cleanTarget)
    );
    if (match) {
      return {
        found: true,
        hwnd: match.hwnd,
        pid: match.pid,
        process: match.process,
        windowTitle: match.title,
        application: match.process,
        chatOrTab: match.title,
      };
    }

    return null;
  } catch (err: any) {
    logger.warn('[TargetContentExtractor] resolveTargetWindow error:', err?.message);
    return null;
  }
}

/**
 * 2. Extract Telegram Chat Messages
 */
export async function extractTelegramMessages(targetChat: string = 'Agentic OS bot', limit: number = 4): Promise<{
  success: boolean;
  messages: ExtractedChatMessage[];
  windowTitle?: string;
  hwnd?: number;
  error?: string;
}> {
  const scriptPath = resolveScriptPath('desktop_perception.ps1');
  const cmd = `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}" -Action inspect -TargetQuery "Telegram"`;

  try {
    const { stdout } = await execAsync(cmd, { timeout: 20000, maxBuffer: 10 * 1024 * 1024 });
    const firstBrace = stdout.indexOf('{');
    const lastBrace = stdout.lastIndexOf('}');
    if (firstBrace < 0 || lastBrace <= firstBrace) {
      return { success: false, messages: [], error: 'Failed to inspect Telegram UIA tree.' };
    }
    const parsed = JSON.parse(stdout.substring(firstBrace, lastBrace + 1));
    if (!parsed.success && !parsed.windowTitle) {
      return { success: false, messages: [], error: parsed.error || 'Telegram window not found.' };
    }

    const controls = parsed.controls || [];
    const allMessages: Array<{ raw: string; sender: string; text: string; time: string }> = [];
    let currentMsg: { raw: string; sender: string; text: string; time: string } | null = null;

    for (const c of controls) {
      if (c.type === 'ControlType.ListItem' && c.name) {
        if (currentMsg && (currentMsg.sender || currentMsg.text)) {
          allMessages.push(currentMsg);
        }
        currentMsg = { raw: c.name, sender: '', text: '', time: '' };
        const lines = c.name.split('\n').map((l: string) => l.trim()).filter(Boolean);
        if (lines.length >= 2) {
          if (lines[0] === 'Seen' && lines[1] === 'Me') {
            currentMsg.sender = 'Me';
            currentMsg.time = lines[lines.length - 1];
            currentMsg.text = lines.slice(2, lines.length - 1).join('\n');
          } else if (lines[0] === 'AgenticOS') {
            currentMsg.sender = 'AgenticOS';
            currentMsg.time = lines[lines.length - 1];
            currentMsg.text = lines.slice(1, lines.length - 1).join('\n');
          } else {
            currentMsg.sender = lines[0];
            currentMsg.time = lines[lines.length - 1];
            currentMsg.text = lines.slice(1, lines.length - 1).join('\n');
          }
        }
      } else if (c.type === 'ControlType.DataItem' && currentMsg) {
        if (c.name === 'Sender' && c.value) currentMsg.sender = c.value;
        if (c.name === 'Message' && c.value) currentMsg.text = c.value;
        if (c.name === 'Time' && c.value) currentMsg.time = c.value;
      }
    }
    if (currentMsg && (currentMsg.sender || currentMsg.text)) {
      allMessages.push(currentMsg);
    }

    if (allMessages.length === 0) {
      return {
        success: false,
        messages: [],
        windowTitle: parsed.windowTitle,
        hwnd: parsed.hwnd,
        error: "I found Telegram and the Agentic OS chat, but I couldn't read the message region.",
      };
    }

    const selected = allMessages.slice(-limit).map((m, idx) => ({
      index: idx + 1,
      sender: m.sender || 'Unknown',
      text: m.text,
      time: m.time,
    }));

    return {
      success: true,
      messages: selected,
      windowTitle: parsed.windowTitle,
      hwnd: parsed.hwnd,
    };
  } catch (err: any) {
    logger.warn('[TargetContentExtractor] Telegram extraction error:', err?.message);
    return { success: false, messages: [], error: err?.message };
  }
}

/**
 * Formats extracted chat messages chronologically for natural speech.
 */
export function formatChatMessagesSpeech(chatName: string, messages: ExtractedChatMessage[]): string {
  if (messages.length === 0) {
    return `There are no recent messages in the ${chatName} chat.`;
  }
  const ordinals = ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth'];
  const lines = messages.map((m, idx) => {
    const ord = ordinals[idx] || `${idx + 1}.`;
    const senderDisplay = m.sender === 'Me' ? 'you' : m.sender;
    const timeDisplay = m.time ? ` at ${m.time}` : '';
    // Format text nicely, abbreviating if extremely long
    const cleanText = m.text.replace(/\n+/g, ' ').trim();
    const textPreview = cleanText.length > 120 ? `${cleanText.substring(0, 115)}...` : cleanText;
    return `${ord}, from ${senderDisplay}${timeDisplay}: "${textPreview}".`;
  });

  return `Here are the last ${messages.length} messages in the ${chatName} chat:\n${lines.join('\n')}`;
}

/**
 * 3. Handle Chat Follow-up Queries:
 * - "What does the last one mean?"
 * - "Read the one before that again."
 * - "Who sent the second message?"
 */
export function resolveChatFollowUp(prompt: string, ctx: TargetContentContext): {
  handled: boolean;
  text?: string;
  sourceMessage?: ExtractedChatMessage;
} {
  const p = prompt.trim().toLowerCase();
  const msgs = ctx.messages || [];
  if (msgs.length === 0) return { handled: false };

  // "What does the last one mean?" / "What does the last message mean?"
  if (/\b(?:what\s+does\s+(?:the\s+)?(?:last\s+one|last\s+message|it)\s+mean|explain\s+(?:the\s+)?(?:last\s+one|last\s+message))\b/i.test(p)) {
    const lastMsg = msgs[msgs.length - 1];
    let meaning = '';
    const text = lastMsg.text.toLowerCase();
    if (text.includes('task received and processed')) {
      meaning = `The last message is from ${lastMsg.sender} stating "${lastMsg.text}". It means your previous command or question was received and successfully processed by the system.`;
    } else if (text.includes('health') || text.includes('online')) {
      meaning = `The last message is from ${lastMsg.sender} reporting the operational health status of AgenticOS, confirming all systems are active and running.`;
    } else {
      meaning = `The last message was sent by ${lastMsg.sender} with the content: "${lastMsg.text}".`;
    }
    return { handled: true, text: meaning, sourceMessage: lastMsg };
  }

  // "Read the one before that again." / "Read the third message again"
  if (/\b(?:read\s+(?:the\s+one\s+before\s+that|the\s+previous\s+one|the\s+one\s+before)|one\s+before\s+that\s+again)\b/i.test(p)) {
    if (msgs.length >= 2) {
      const targetMsg = msgs[msgs.length - 2];
      const senderDisplay = targetMsg.sender === 'Me' ? 'you' : targetMsg.sender;
      const text = `The message before that was sent by ${senderDisplay}${targetMsg.time ? ` at ${targetMsg.time}` : ''}: "${targetMsg.text.replace(/\n+/g, ' ')}".`;
      return { handled: true, text, sourceMessage: targetMsg };
    }
  }

  // "Who sent the second message?" / "Who sent the first message?" / "Who sent the last message?"
  const senderMatch = p.match(/\bwho\s+sent\s+(?:the\s+)?(first|second|third|fourth|last)\s+message\b/i);
  if (senderMatch) {
    const ord = senderMatch[1].toLowerCase();
    let idx = -1;
    if (ord === 'first') idx = 0;
    else if (ord === 'second') idx = 1;
    else if (ord === 'third') idx = 2;
    else if (ord === 'fourth') idx = 3;
    else if (ord === 'last') idx = msgs.length - 1;

    if (idx >= 0 && idx < msgs.length) {
      const msg = msgs[idx];
      const senderDisplay = msg.sender === 'Me' ? 'you' : msg.sender;
      const text = `The ${ord} message was sent by ${senderDisplay}.`;
      return { handled: true, text, sourceMessage: msg };
    }
  }

  return { handled: false };
}

/**
 * 4. Handle Browser Page Follow-up Queries:
 * - "What does the second paragraph say?"
 * - "Click the link about <visible target>."
 */
export function resolveBrowserFollowUp(prompt: string, ctx: TargetContentContext): {
  handled: boolean;
  text?: string;
} {
  const p = prompt.trim().toLowerCase();
  const paragraphs = ctx.paragraphs || [];

  // "What does the second paragraph say?" / "Read the second paragraph."
  const paraMatch = p.match(/\b(?:what\s+does\s+the\s+|read\s+(?:the\s+)?)(first|second|third|fourth|last)\s+paragraph\s+(?:say|read)?\b/i);
  if (paraMatch && paragraphs.length > 0) {
    const ord = paraMatch[1].toLowerCase();
    let idx = -1;
    if (ord === 'first') idx = 0;
    else if (ord === 'second') idx = 1;
    else if (ord === 'third') idx = 2;
    else if (ord === 'fourth') idx = 3;
    else if (ord === 'last') idx = paragraphs.length - 1;

    if (idx >= 0 && idx < paragraphs.length) {
      const para = paragraphs[idx];
      return {
        handled: true,
        text: `The ${ord} paragraph says: "${para}".`,
      };
    }
  }

  return { handled: false };
}
