import { describe, it, expect } from 'vitest';
import { redactSensitiveData } from '../utils/logger.js';

describe('Logger Redaction', () => {
  it('redacts Authorization variants', () => {
    const input = {
      Authorization: 'Bearer secret123',
      authorization: 'Bearer token',
      'x-api-key': 'abc',
      apiKey: 'sk-1234',
      api_key: 'sk-5678',
      safeField: 'hello'
    };

    const result = redactSensitiveData(input) as any;
    expect(result.Authorization).toBe('[REDACTED]');
    expect(result.authorization).toBe('[REDACTED]');
    expect(result['x-api-key']).toBe('[REDACTED]');
    expect(result.apiKey).toBe('[REDACTED]');
    expect(result.api_key).toBe('[REDACTED]');
    expect(result.safeField).toBe('hello');
  });

  it('redacts nested credential fields', () => {
    const input = {
      user: {
        id: 1,
        token: 'secret'
      }
    };
    const result = redactSensitiveData(input) as any;
    expect(result.user.token).toBe('[REDACTED]');
    expect(result.user.id).toBe(1);
  });

  it('redacts arrays containing sensitive objects', () => {
    const input = [
      { id: 1, password: 'abc' },
      { id: 2, secret: 'def' }
    ];
    const result = redactSensitiveData(input) as any[];
    expect(result[0].password).toBe('[REDACTED]');
    expect(result[1].secret).toBe('[REDACTED]');
  });

  it('redacts strings containing Bearer or sk- tokens anywhere', () => {
    expect(redactSensitiveData('Error: API key sk-ant-api03-abcdef-1234 is invalid')).toBe('Error: API key [REDACTED] is invalid');
    expect(redactSensitiveData('Failed with Authorization: Bearer abcdef123')).toBe('Failed with Authorization: [REDACTED]');
  });

  it('preserves non-sensitive fields and does not mutate original object', () => {
    const input = { a: 1, b: 'safe', c: { token: 'secret' } };
    const result = redactSensitiveData(input) as any;
    expect(result.a).toBe(1);
    expect(result.b).toBe('safe');
    expect(result.c.token).toBe('[REDACTED]');
    expect(input.c.token).toBe('secret'); // Original not mutated
  });
});
