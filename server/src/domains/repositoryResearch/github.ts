import { setTimeout as sleep } from 'node:timers/promises';
import { hash, researchStore } from './store.js';

export class GitHubResearchClient {
  requests = 0;
  cacheHits = 0;
  constructor(private token: string | undefined = undefined, private transport: typeof fetch = fetch) {}
  async get(endpoint: string, signal?: AbortSignal, ttlMs = 3600_000): Promise<any> {
    signal?.throwIfAborted();
    if(this.token===undefined) this.token=await (await import('./credentials.js')).readResearchCredential();
    if (!this.token) throw new Error('GitHub research requires a saved read-only GitHub credential or a configured GITHUB_TOKEN/GH_TOKEN.');
    if (!endpoint.startsWith('/') || endpoint.startsWith('//') || /[\r\n\\]/.test(endpoint)) throw new Error('Invalid GitHub API path');
    const url = new URL(endpoint, 'https://api.github.com');
    if (url.origin !== 'https://api.github.com') throw new Error('GitHub API origin rejected');
    const key = hash(`${hash(this.token)}:${url.href}`);
    const cached = researchStore.cached(key);
    if (cached && Date.now() - cached.fetched_at < ttlMs) { this.cacheHits++; return JSON.parse(cached.body); }
    for (let attempt = 0; attempt < 3; attempt++) {
      signal?.throwIfAborted();
      if (++this.requests > 650) throw new Error('GitHub request budget exhausted; saved research can be inspected.');
      const response = await this.transport(url, { redirect: 'error', signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(20000)]), headers: {
        Authorization: `Bearer ${this.token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'AgenticOS-Repository-Research', ...(cached?.etag ? { 'If-None-Match': cached.etag } : {}),
      } });
      if (response.status === 304 && cached) { this.cacheHits++; researchStore.cache(key, JSON.parse(cached.body), cached.etag); return JSON.parse(cached.body); }
      if (response.status === 429 || (response.status === 403 && (response.headers.has('retry-after') || response.headers.get('x-ratelimit-remaining') === '0'))) {
        const delay = response.headers.get('retry-after') ? Number(response.headers.get('retry-after')) * 1000 : Math.max(1000, Number(response.headers.get('x-ratelimit-reset')) * 1000 - Date.now());
        if (!Number.isFinite(delay) || delay > 30000 || attempt === 2) throw new Error('GitHub rate limit reached; partial history is saved. Retry after the rate limit resets.');
        await sleep(Math.max(1000, delay), undefined, { signal }); continue;
      }
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`GitHub API request failed (HTTP ${response.status}).`);
      const reader = response.body?.getReader();
      if (!reader) throw new Error('Empty GitHub response');
      const chunks: Uint8Array[] = []; let length = 0;
      while (true) { const { done, value } = await reader.read(); if (done) break; length += value.length; if (length > 2_000_000) { await reader.cancel(); throw new Error('GitHub response exceeds research size limit'); } chunks.push(value); }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      researchStore.cache(key, body, response.headers.get('etag')); return body;
    }
    throw new Error('GitHub retry budget exhausted');
  }
}
