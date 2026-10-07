import { afterEach, describe, expect, it, vi } from 'vitest';
import { authMiddleware, timingSafeTokenCompare } from '../middleware/auth.js';

function invoke(header?: string, method = 'POST', path = '/api/protected') {
  const next = vi.fn();
  const response = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
  authMiddleware(
    { headers: { authorization: header }, method, originalUrl: path } as any,
    response as any,
    next
  );
  return { next, response };
}

afterEach(() => vi.unstubAllEnvs());

describe('API authentication fails closed in every mode', () => {
  it.each(['production', 'development', 'test'])('missing token denies mutating requests in %s with 503', (mode) => {
    vi.stubEnv('NODE_ENV', mode);
    vi.stubEnv('AGENTOS_API_TOKEN', '');
    const result = invoke('Bearer caller-claim', 'POST');
    expect(result.next).not.toHaveBeenCalled();
    expect(result.response.status).toHaveBeenCalledWith(503);
  });

  it('missing token permits read-only GET requests when token is unconfigured', () => {
    vi.stubEnv('AGENTOS_API_TOKEN', '');
    const result = invoke(undefined, 'GET');
    expect(result.next).toHaveBeenCalledOnce();
  });

  it.each([undefined, 'Bearer incorrect', 'Basic fixture', 'Bearer', 'Bearer short', 'Bearer wrong-secret-token'])(
    'rejects invalid authentication %s with 401 when token is configured',
    (header) => {
      vi.stubEnv('AGENTOS_API_TOKEN', 'fixture-only-secret-token');
      const result = invoke(header);
      expect(result.next).not.toHaveBeenCalled();
      expect(result.response.status).toHaveBeenCalledWith(401);
    }
  );

  it('permits a matching configured token, without implying human approval', () => {
    vi.stubEnv('AGENTOS_API_TOKEN', 'fixture-only');
    expect(invoke('Bearer fixture-only').next).toHaveBeenCalledOnce();
  });

  it('dev/test bypass ONLY works when AGENTICOS_AUTH_TEST_BYPASS is explicitly set to true', () => {
    vi.stubEnv('AGENTOS_API_TOKEN', 'fixture-only');
    vi.stubEnv('AGENTICOS_AUTH_TEST_BYPASS', 'true');
    // Bypasses even without header
    const bypassed = invoke(undefined);
    expect(bypassed.next).toHaveBeenCalledOnce();

    // Does NOT bypass when flag is false or arbitrary string
    vi.stubEnv('AGENTICOS_AUTH_TEST_BYPASS', 'false');
    const blocked = invoke(undefined);
    expect(blocked.next).not.toHaveBeenCalled();
    expect(blocked.response.status).toHaveBeenCalledWith(401);
  });

  it('constant-time timingSafeTokenCompare correctly evaluates matches and mismatches', () => {
    expect(timingSafeTokenCompare('secret123', 'secret123')).toBe(true);
    expect(timingSafeTokenCompare('secret123', 'secret124')).toBe(false);
    expect(timingSafeTokenCompare('short', 'longer-string')).toBe(false);
    expect(timingSafeTokenCompare('', 'non-empty')).toBe(false);
    expect(timingSafeTokenCompare('prefix', 'prefix-extra')).toBe(false);
  });
});
