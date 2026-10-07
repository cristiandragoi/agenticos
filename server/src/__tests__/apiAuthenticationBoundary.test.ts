import { afterEach, describe, expect, it, vi } from 'vitest';
import { authMiddleware } from '../middleware/auth.js';
function invoke(header?:string) {
 const next=vi.fn();
 const response={status:vi.fn().mockReturnThis(),json:vi.fn().mockReturnThis()};
 authMiddleware({headers:{authorization:header}} as any,response as any,next);
 return {next,response};
}
afterEach(()=>vi.unstubAllEnvs());
describe('API authentication fails closed in every mode',()=>{
 it.each(['production','development','test'])('missing token denies in %s',mode=>{
  vi.stubEnv('NODE_ENV',mode);vi.stubEnv('AGENTOS_API_TOKEN','');
  const result=invoke('Bearer caller-claim');
  expect(result.next).not.toHaveBeenCalled();expect(result.response.status).toHaveBeenCalledWith(503);
 });
 it.each([undefined,'Bearer incorrect','Basic fixture','Bearer'])('rejects invalid authentication %s',header=>{
  vi.stubEnv('AGENTOS_API_TOKEN','fixture-only');
  const result=invoke(header);expect(result.next).not.toHaveBeenCalled();expect(result.response.status).toHaveBeenCalledWith(401);
 });
 it('permits a matching configured token, without implying human approval',()=>{
  vi.stubEnv('AGENTOS_API_TOKEN','fixture-only');
  expect(invoke('Bearer fixture-only').next).toHaveBeenCalledOnce();
 });
});
