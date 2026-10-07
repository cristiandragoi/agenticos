import {describe,it,expect,vi,afterEach} from 'vitest';
const vault=vi.hoisted(()=>({getPassword:vi.fn(),setPassword:vi.fn()}));
vi.mock('keytar',()=>({default:vault}));
import {readResearchCredential,saveResearchCredential} from '../domains/repositoryResearch/credentials.js';
afterEach(()=>{vi.resetAllMocks();vi.unstubAllEnvs();});
describe('GitHub research OS-vault credentials',()=>{
  it('reads the shared Windows-vault account before environment configuration',async()=>{
    vault.getPassword.mockResolvedValue('saved-fixture');vi.stubEnv('GITHUB_TOKEN','env-fixture');
    expect(await readResearchCredential()).toBe('saved-fixture');
    expect(vault.getPassword).toHaveBeenCalledWith('AgenticOS.Secrets','github.research_token');
  });
  it('supports explicit environment configuration when the vault is unavailable',async()=>{
    vault.getPassword.mockRejectedValue(new Error('offline'));vi.stubEnv('GITHUB_TOKEN','env-fixture');
    expect(await readResearchCredential()).toBe('env-fixture');
  });
  it('saves only in the vault and never reports success on vault failure',async()=>{
    const token='github_pat_'+'x'.repeat(30);vault.setPassword.mockRejectedValue(new Error('sensitive internal error'));
    await expect(saveResearchCredential(token)).rejects.toThrow('token was not saved');
    expect(vault.setPassword).toHaveBeenCalledWith('AgenticOS.Secrets','github.research_token',token);
  });
  it('rejects malformed input before saving',async()=>{
    await expect(saveResearchCredential('not a token')).rejects.toThrow('valid GitHub');
    expect(vault.setPassword).not.toHaveBeenCalled();
  });
});
