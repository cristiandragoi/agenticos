export const CODEX_REPOSITORY = 'B:\\AgenticOS';
export const CODEX_PROVIDER = 'ollama';
export const CODEX_PROVIDER_LABEL = 'Ollama';
export const CODEX_BASE_URL = 'http://127.0.0.1:11434';

export function isRepositoryOnlyTask(value: string, repository = CODEX_REPOSITORY): boolean {
  const task = value.trim().replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
  const repo = repository.trim().replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
  return task === repo;
}
