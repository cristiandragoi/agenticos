export const SENSITIVE_KEYS = [
  'authorization',
  'x-api-key',
  'apikey',
  'api_key',
  'token',
  'accesstoken',
  'bearer',
  'secret',
  'credential',
  'providerkey',
  'providerkeys',
  'password'
];

export function redactSensitiveData(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === 'string') {
    let redactedStr = value;
    // Replace embedded Bearer tokens or sk- tokens anywhere in strings
    redactedStr = redactedStr.replace(/Bearer\s+[A-Za-z0-9-._~+/]+=*/gi, '[REDACTED]');
    redactedStr = redactedStr.replace(/sk-[A-Za-z0-9_-]+/gi, '[REDACTED]');
    return redactedStr;
  }

  if (Array.isArray(value)) {
    return value.map(item => redactSensitiveData(item));
  }

  if (typeof value === 'object') {
    const redacted: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (SENSITIVE_KEYS.includes(k.toLowerCase())) {
        redacted[k] = '[REDACTED]';
      } else {
        redacted[k] = redactSensitiveData(v);
      }
    }
    return redacted;
  }

  return value;
}

export const logger = {
  info(message: string, meta?: any, ...args: any[]) {
    console.log(JSON.stringify({ level: 'info', message, meta: redactSensitiveData(meta), ...(args.length ? { detail: redactSensitiveData(args.length === 1 ? args[0] : args) } : {}) }));
  },
  warn(message: string, meta?: any, ...args: any[]) {
    console.warn(JSON.stringify({ level: 'warn', message, meta: redactSensitiveData(meta), ...(args.length ? { detail: redactSensitiveData(args.length === 1 ? args[0] : args) } : {}) }));
  },
  error(message: string, error?: unknown, meta?: any) {
    let errInfo = error;
    if (error instanceof Error) {
      errInfo = { message: error.message, stack: error.stack };
    }
    console.error(JSON.stringify({ level: 'error', message, error: redactSensitiveData(errInfo), meta: redactSensitiveData(meta) }));
  },
  debug(message: string, meta?: any, ...args: any[]) {
    if (process.env.DEBUG) {
      console.debug(JSON.stringify({ level: 'debug', message, meta: redactSensitiveData(meta), ...(args.length ? { detail: redactSensitiveData(args.length === 1 ? args[0] : args) } : {}) }));
    }
  }
};
