import keytar from 'keytar';

// Reuse AgenticOS's OS-vault namespace. Deliberately no SQLite/plaintext backup.
const service='AgenticOS.Secrets';
const account='github.research_token';
export async function readResearchCredential():Promise<string> {
  try {
    const saved=await keytar.getPassword(service,account);
    if(saved?.trim()) return saved.trim();
  } catch { /* Explicit environment configuration remains supported. */ }
  return (process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '').trim();
}
export async function saveResearchCredential(token:string):Promise<void> {
  const value=token.trim();
  if(!/^(?:github_pat_|ghp_)[A-Za-z0-9_]{20,250}$/.test(value)) throw new Error('Enter a valid GitHub personal access token.');
  try { await keytar.setPassword(service,account,value); }
  catch { throw new Error('Windows credential storage is unavailable. The token was not saved.'); }
}
export async function hasResearchCredential():Promise<boolean> {
  return Boolean(await readResearchCredential());
}
