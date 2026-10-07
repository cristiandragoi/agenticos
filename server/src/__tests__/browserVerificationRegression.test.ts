import { describe, it, expect, vi, afterEach } from 'vitest';
import { browserCodeProvider } from '../domains/controlPlane/browser/BrowserCodeProvider.js';
import { browserCodeSession } from '../domains/controlPlane/browser/BrowserCodeSession.js';
import { browserCapabilityAdapter } from '../domains/controlPlane/adapters/BrowserCapabilityAdapter.js';
import { targetResolver } from '../domains/controlPlane/TargetResolver.js';
afterEach(() => vi.restoreAllMocks());
function readablePage() {
  vi.spyOn(browserCodeSession, 'getSession').mockResolvedValue({ page: {}, context: {}, browser: {} });
  vi.spyOn(browserCodeSession, 'extractStructuredDOM').mockResolvedValue({ url: 'https://example.com', title: 'Example', bodyText: 'Readable page, no button was clicked', inputs: [], interactiveElements: [], headings: [] } as any);
  vi.spyOn(browserCodeSession, 'getAccessibilityTree').mockResolvedValue({ summary: '', nodes: [] });
}
describe('browser action verification', () => {
  it('keeps YouTube connection diagnostics out of speech',async()=>{
    vi.spyOn(browserCodeProvider,'navigate').mockRejectedValue(new Error('connectOverCDP ws://127.0.0.1:9222/devtools/browser/internal-id 403 Forbidden'));
    const result=await browserCapabilityAdapter.executeYouTubeStage('YOUTUBE_OPEN_HOME','');
    expect(result.verified).toBe(false);
    expect(result.outputText).toContain('could not connect');
    expect(result.outputText).not.toMatch(/127\.0\.0\.1|devtools|internal-id/);
  });
  it('does not treat readable text as successful execution of an unsupported button action', async () => {
    readablePage();
    const result = await browserCapabilityAdapter.execute({ action: 'BROWSER_GOAL', target: 'Click the Confirm button' } as any, 'test', 'verification-test');
    expect(result.verified).toBe(false);
    expect(result.contextMutation).toBeUndefined();
    expect(result.outputText).not.toContain('completed');
    expect(browserCodeSession.extractStructuredDOM).toHaveBeenCalledTimes(1);
  });
  it('still verifies an explicitly requested content read', async () => {
    readablePage();
    expect((await browserCodeProvider.executeBrowserGoal({ goal: 'Read this page' })).status).toBe('SUCCESS');
  });
  it('does not fall through to title-based success after Chrome rejects authorization', async () => {
    vi.spyOn(browserCodeProvider, 'isAvailable').mockResolvedValue(true);
    vi.spyOn(browserCodeProvider, 'navigate').mockRejectedValue(new Error('403 Forbidden Connection rejected'));
    const windows = vi.spyOn(targetResolver, 'getOpenWindows');
    const result = await browserCapabilityAdapter.execute({ action: 'NAVIGATE_WEB', target: 'https://example.com' } as any, 'test', 'auth-test');
    expect(result.verified).toBe(false);
    expect(result.failureReason).toContain('not authorized');
    expect(windows).not.toHaveBeenCalled();
  });
});
