/**
 * phase2VisualRead.test.ts — Phase 2 Visual Read Verification Suite
 *
 * Validates:
 * 1. TargetIdentity and VisualReadQuery contracts.
 * 2. Fail-closed validation: rejects missing/invalid HWND.
 * 3. Structured AcquiredVisualContent return (methodUsed = UI_TARS_VISION, chatMessages, text, evidenceArtifact).
 * 4. Preservation of target identity in sourceTarget.
 * 5. Mock read runner integration.
 * 6. Evidence artifact completeness.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  agentSComputerUseProvider,
  type TargetIdentity,
  type VisualReadQuery,
  type AcquiredVisualContent,
} from '../domains/controlPlane/computerUse/index.js';

describe('Phase 2 — Agent-S / UI-TARS Generic Visual Read Capability', () => {
  beforeEach(() => {
    agentSComputerUseProvider.setMockReadRunner(undefined);
  });

  it('fails closed when target HWND is missing or invalid', async () => {
    const invalidTarget: TargetIdentity = {
      targetId: 'invalid-target-1',
      application: 'TestApp',
      hwnd: 0, // Invalid HWND
    };

    const query: VisualReadQuery = {
      contentType: 'CHAT_MESSAGES',
      count: 2,
    };

    const res = await agentSComputerUseProvider.read(invalidTarget, query);
    expect(res.success).toBe(false);
    expect(res.confidence).toBe(0);
    expect(res.methodUsed).toBe('UI_TARS_VISION');
    expect(res.error).toContain('HWND must be a positive integer');
  });

  it('fails closed when target HWND is negative', async () => {
    const invalidTarget: TargetIdentity = {
      targetId: 'invalid-target-2',
      application: 'TestApp',
      hwnd: -1,
    };

    const res = await agentSComputerUseProvider.read(invalidTarget, { contentType: 'WINDOW_TEXT' });
    expect(res.success).toBe(false);
    expect(res.confidence).toBe(0);
    expect(res.error).toBeDefined();
  });

  it('correctly executes mock visual read and preserves sourceTarget and evidence', async () => {
    const target: TargetIdentity = {
      targetId: 'target_chat_1',
      application: 'Telegram',
      processName: 'Telegram.exe',
      hwnd: 133174,
      pid: 5904,
      bounds: { left: 100, top: 100, right: 800, bottom: 900, width: 700, height: 800 },
    };

    const query: VisualReadQuery = {
      contentType: 'CHAT_MESSAGES',
      count: 2,
    };

    agentSComputerUseProvider.setMockReadRunner(async (tgt, qry): Promise<AcquiredVisualContent> => {
      expect(tgt.hwnd).toBe(133174);
      expect(qry.contentType).toBe('CHAT_MESSAGES');
      return {
        success: true,
        sourceTarget: tgt,
        methodUsed: 'UI_TARS_VISION',
        text: 'Alice: Hello\nBob: Hi there',
        items: [],
        chatMessages: [
          { sender: 'Alice', text: 'Hello', timestamp: '12:00' },
          { sender: 'Bob', text: 'Hi there', timestamp: '12:01' },
        ],
        confidence: 0.95,
        evidenceArtifact: {
          screenshotPath: 'D:/AgenticOS/server/data/evidence_mock.png',
          hwnd: tgt.hwnd,
          pid: tgt.pid,
          processName: tgt.processName,
          bounds: tgt.bounds,
          timestamp: Date.now(),
          readQuery: qry,
          model: 'bytedance/ui-tars-1.5-7b',
          rawOutput: '{"messages": [{"sender": "Alice", "text": "Hello", "timestamp": "12:00"}, {"sender": "Bob", "text": "Hi there", "timestamp": "12:01"}]}',
        },
        timestamp: Date.now(),
      };
    });

    const res = await agentSComputerUseProvider.read(target, query);

    expect(res.success).toBe(true);
    expect(res.methodUsed).toBe('UI_TARS_VISION');
    expect(res.sourceTarget.hwnd).toBe(133174);
    expect(res.sourceTarget.pid).toBe(5904);
    expect(res.sourceTarget.processName).toBe('Telegram.exe');
    expect(res.chatMessages).toHaveLength(2);
    expect(res.chatMessages![0].sender).toBe('Alice');
    expect(res.chatMessages![0].text).toBe('Hello');
    expect(res.chatMessages![1].sender).toBe('Bob');
    expect(res.chatMessages![1].text).toBe('Hi there');
    expect(res.confidence).toBe(0.95);
    expect(res.evidenceArtifact?.model).toBe('bytedance/ui-tars-1.5-7b');
    expect(res.evidenceArtifact?.screenshotPath).toBe('D:/AgenticOS/server/data/evidence_mock.png');
  });

  it('returns unverified / failure when mock runner reports no visible content', async () => {
    const target: TargetIdentity = {
      targetId: 'empty_window_target',
      application: 'Notepad',
      hwnd: 5555,
      pid: 6666,
    };

    agentSComputerUseProvider.setMockReadRunner(async (tgt, qry): Promise<AcquiredVisualContent> => {
      return {
        success: false,
        sourceTarget: tgt,
        methodUsed: 'UI_TARS_VISION',
        text: undefined,
        items: [],
        chatMessages: [],
        confidence: 0,
        timestamp: Date.now(),
        error: 'No matching visible content could be verified in target window',
      };
    });

    const res = await agentSComputerUseProvider.read(target, { contentType: 'CHAT_MESSAGES' });
    expect(res.success).toBe(false);
    expect(res.confidence).toBe(0);
    expect(res.chatMessages).toHaveLength(0);
    expect(res.error).toBe('No matching visible content could be verified in target window');
  });
});
