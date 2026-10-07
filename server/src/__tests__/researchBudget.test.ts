import { describe, it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { GitHubResearchClient } from '../domains/repositoryResearch/github.js';
import { runRepositoryResearch } from '../domains/repositoryResearch/service.js';

function stalledClient() {
  const client = new GitHubResearchClient('test-only');
  vi.spyOn(client, 'get').mockImplementation(async (_path, signal) => new Promise((_resolve, reject) => {
    signal!.throwIfAborted();
    signal!.addEventListener('abort', () => reject(signal!.reason), { once: true });
  }));
  return client;
}
describe('bounded research completion', () => {
  it('delivers an honest partial report when its evidence budget expires', async () => {
    const report = await runRepositoryResearch({ goalId: randomUUID(), goal: 'Research one GitHub repository for browser automation', budgetMs: 30 }, stalledClient());
    expect(report).toMatchObject({ incomplete: true, budgetExpired: true, assessed: 0, top: [] });
    expect(report.presentationText).toContain('no qualifying recommendation');
  });
  it('user cancellation remains cancellation, not successful partial completion', async () => {
    const controller = new AbortController();
    const result = runRepositoryResearch({ goalId: randomUUID(), goal: 'Research one GitHub repository for browser automation', budgetMs: 500, signal: controller.signal }, stalledClient());
    controller.abort(new Error('user stop'));
    await expect(result).rejects.toThrow('user stop');
  });
});
