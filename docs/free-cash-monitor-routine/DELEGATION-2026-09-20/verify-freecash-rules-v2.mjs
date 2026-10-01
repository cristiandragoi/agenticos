#!/usr/bin/env node
/**
 * verify-freecash-rules-v2.mjs -- BEHAVIOURAL rule-gate verifier for the Free
 * Cash daily monitor.
 *
 * WHY THIS FILE EXISTS
 *   The shipped verifier `server/scripts/verify-freecash-rules.mjs` reports
 *   "4/4 passed" and exits 0 while certifying a monitor that does not even
 *   parse. Its Rule 1 test greps for the literal string 'read-only' in a .ts
 *   adapter; its Rule 3 test is `!includes('checkForChanges') || includes('.log(')`
 *   (always true); its Rule 4 test ends `|| includes('approval-request.json')`.
 *   None of those can fail on a real violation. This harness replaces string
 *   greps with OBSERVED BEHAVIOUR.
 *
 * HOW IT VERIFIES
 *   The target monitor's source is compiled and executed inside a `node:vm`
 *   sandbox whose `require` is intercepted. The target therefore sees:
 *     - `fs`      -> an in-memory filesystem that records every read/write in
 *                    order (used for the R3 load-then-save ordering proof);
 *     - `https`/`http` -> a recording stub (every method/host/path captured);
 *     - `fetch`   -> a recording stub as well;
 *     - `Date`    -> a simulated clock (no dependency on the host clock);
 *     - `process` -> a stub with an EMPTY env (no credentials are ever read,
 *                    no secret can be printed).
 *   No socket is opened, no credential is required, and nothing outside the
 *   sandbox is written. Everything the target attempts is observed.
 *
 * GATES (exit code 0 only when all four pass)
 *   R1 no automated earning/write action   -> only GET to allowlisted prefixes;
 *                                             any POST/PUT/PATCH/DELETE, or a
 *                                             cashout/transaction/redeem path,
 *                                             fails the gate. Plus a token scan.
 *   R2 status check at most once per day   -> two invocations in one simulated
 *                                             calendar day; the second must be
 *                                             refused, and allowed after +1 day.
 *   R3 notify on change, silent if same    -> changed balance notifies and cites
 *                                             the PREVIOUS balance; unchanged
 *                                             balance must emit nothing; the
 *                                             snapshot read must precede its write.
 *   R4 human approval before external write-> requests land as 'pending', nothing
 *                                             executes without an approval record,
 *                                             and a deadline never auto-executes.
 *
 * A verifier that has never been shown to fail is worthless. Run the seeded
 * violations in ./scratch/ -- see RULE-GATE-VERIFIER-DESIGN.md for the proof.
 *
 * USAGE
 *   node verify-freecash-rules-v2.mjs                       # verify reference target
 *   node verify-freecash-rules-v2.mjs --target <file>       # verify a specific target
 *   node verify-freecash-rules-v2.mjs --target <file> --ci-root <dir> [--json]
 *   node verify-freecash-rules-v2.mjs --help
 */

import fsNative from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HARNESS_DIR = path.dirname(fileURLToPath(import.meta.url));

/* ------------------------------------------------------------------ CLI */

function parseArgs(argv) {
  const out = {
    target: path.join(HARNESS_DIR, 'scratch', 'reference-monitor.mjs'),
    ciRoot: null,
    json: false,
    help: false
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--target' || a === '-t') out.target = argv[++i];
    else if (a === '--ci-root') out.ciRoot = argv[++i];
    else if (a === '--json') out.json = true;
    else if (a === '--help' || a === '-h') out.help = true;
    else {
      console.error('[FATAL] unknown argument: ' + a);
      process.exit(2);
    }
  }
  if (!out.target) {
    console.error('[FATAL] --target requires a path');
    process.exit(2);
  }
  return out;
}

const ARGS = parseArgs(process.argv.slice(2));

if (ARGS.help) {
  console.log(
    [
      'verify-freecash-rules-v2.mjs -- behavioural rule-gate verifier (R1-R4)',
      '',
      'Usage:',
      '  node verify-freecash-rules-v2.mjs [--target <monitor.mjs>] [--ci-root <dir>] [--json]',
      '',
      '  --target   monitor implementation to drive in the sandbox',
      '             (default: ./scratch/reference-monitor.mjs)',
      '  --ci-root  extra directory whose *code* files join the forbidden-token scan',
      '  --json     print the machine-readable report after the human one',
      '',
      'Exit codes: 0 = all four gates pass; 1 = at least one gate failed (named);',
      '            2 = usage error.'
    ].join('\n')
  );
  process.exit(0);
}

/* -------------------------------------------------------------- console */

const C = process.env.NO_COLOR
  ? { reset: '', red: '', green: '', yellow: '', dim: '', bold: '' }
  : {
      reset: '\u001b[0m',
      red: '\u001b[31m',
      green: '\u001b[32m',
      yellow: '\u001b[33m',
      dim: '\u001b[2m',
      bold: '\u001b[1m'
    };

function line(c) {
  return C.bold + c + C.reset;
}

function rule(c) {
  return c.repeat(78);
}

/* --------------------------------------------------- simulated env pieces */

const HOST_DAY = new Date().toISOString().slice(0, 10);

/** Deterministic simulated start: a date far from the host clock on purpose. */
const SIM_START_MS = Date.UTC(2001, 1, 3, 12, 0, 0); // 2001-02-03T12:00:00Z
const SIM_DAY = '2001-02-03';
const DAY_MS = 24 * 60 * 60 * 1000;

function createClock(startMs) {
  let now = startMs;
  const RealDate = Date;
  class SimDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(now);
      else super(...args);
    }
    static now() {
      return now;
    }
  }
  return {
    Date: SimDate,
    now() {
      return now;
    },
    set(ms) {
      now = ms;
    },
    advance(ms) {
      now += ms;
    },
    iso() {
      return new RealDate(now).toISOString();
    },
    day() {
      return new RealDate(now).toISOString().slice(0, 10);
    }
  };
}

function norm(p) {
  return String(p).replace(/\\/g, '/').replace(/^\.\//, '');
}

function createVirtualFs() {
  const files = new Map();
  const ops = [];
  let seq = 0;

  function record(op, p, extra) {
    ops.push(Object.assign({ seq: ++seq, op: op, path: norm(p) }, extra || {}));
  }

  function enoent(p) {
    const err = new Error("ENOENT: no such file or directory, open '" + norm(p) + "'");
    err.code = 'ENOENT';
    return err;
  }

  const api = {
    existsSync(p) {
      return files.has(norm(p));
    },
    readFileSync(p) {
      const k = norm(p);
      if (!files.has(k)) throw enoent(k);
      record('read', k);
      return files.get(k);
    },
    writeFileSync(p, data) {
      const k = norm(p);
      record('write', k, { bytes: String(data).length });
      files.set(k, String(data));
    },
    appendFileSync(p, data) {
      const k = norm(p);
      record('append', k, { bytes: String(data).length });
      files.set(k, (files.get(k) || '') + String(data));
    },
    mkdirSync() {
      return undefined;
    },
    rmSync(p) {
      const k = norm(p);
      record('rm', k);
      files.delete(k);
    },
    statSync(p) {
      const k = norm(p);
      if (!files.has(k)) throw enoent(k);
      return { size: String(files.get(k)).length, mtimeMs: 0, isFile: () => true };
    },
    readdirSync() {
      return [];
    },
    realpathSync(p) {
      return norm(p);
    },
    // test-facing helpers (never visible to the sandboxed target)
    _files: files,
    _ops: ops,
    _seed(p, content) {
      files.set(norm(p), String(content));
    },
    _get(p) {
      return files.get(norm(p));
    },
    _has(p) {
      return files.has(norm(p));
    },
    _opsSince(mark) {
      return ops.slice(mark);
    },
    _mark() {
      return ops.length;
    },
    _json(p) {
      const raw = files.get(norm(p));
      if (raw === undefined) return null;
      try {
        return JSON.parse(raw);
      } catch (err) {
        return null;
      }
    }
  };
  api.promises = {
    readFile: async (p) => api.readFileSync(p),
    writeFile: async (p, d) => api.writeFileSync(p, d),
    appendFile: async (p, d) => api.appendFileSync(p, d),
    stat: async (p) => api.statSync(p)
  };
  return api;
}

function createHttpLayer(env) {
  const requests = [];

  function describeRequest(rec) {
    return rec.method + ' ' + (rec.hostname || '?') + rec.path;
  }

  function makeRequest(options, cb) {
    const opts = typeof options === 'string' ? { path: options } : options || {};
    const rec = {
      seq: requests.length + 1,
      method: String(opts.method || 'GET').toUpperCase(),
      hostname: opts.hostname || opts.host || null,
      path: opts.path || '/',
      port: opts.port || null,
      at: env.clock.iso()
    };
    requests.push(rec);
    const listeners = {};
    const req = {
      on(ev, fn) {
        (listeners[ev] = listeners[ev] || []).push(fn);
        return req;
      },
      once(ev, fn) {
        return req.on(ev, fn);
      },
      setTimeout() {
        return req;
      },
      write() {
        return req;
      },
      destroy() {
        return req;
      },
      abort() {
        return req;
      },
      end() {
        const resp = env.http.takeResponse();
        rec.statusCode = resp.statusCode;
        const res = {
          statusCode: resp.statusCode,
          headers: {},
          on(ev, fn) {
            if (ev === 'data') fn(Buffer.from(String(resp.body)));
            if (ev === 'end') fn();
            return res;
          }
        };
        setTimeout(() => {
          try {
            if (cb) cb(res);
          } catch (err) {
            (listeners.error || []).forEach((f) => f(err));
          }
        }, 0);
        return req;
      }
    };
    return req;
  }

  const queued = [];
  const api = {
    requests: requests,
    describe: describeRequest,
    takeResponse() {
      return queued.shift() || { statusCode: 200, body: env.statusBody() };
    },
    pushResponse(r) {
      queued.push(r);
    },
    setBody(body) {
      env.setStatusBody(body);
    },
    reset() {
      requests.length = 0;
      queued.length = 0;
    },
    https: {
      request: makeRequest,
      get(options, cb) {
        const r = makeRequest(options, cb);
        r.end();
        return r;
      }
    },
    http: {
      request: makeRequest,
      get(options, cb) {
        const r = makeRequest(options, cb);
        r.end();
        return r;
      }
    }
  };
  return api;
}

function createConsoleCapture() {
  const entries = [];
  function push(level, args) {
    entries.push({ level: level, text: args.map((a) => (typeof a === 'string' ? a : String(a))).join(' ') });
  }
  return {
    entries: entries,
    log: (...a) => push('log', a),
    info: (...a) => push('info', a),
    warn: (...a) => push('warn', a),
    error: (...a) => push('error', a),
    debug: (...a) => push('debug', a),
    trace: (...a) => push('trace', a),
    lines() {
      return entries.map((e) => e.text);
    },
    matching(re) {
      return entries.filter((e) => re.test(e.text));
    }
  };
}

function createEnv(opts) {
  const options = opts || {};
  const clock = createClock(options.startMs !== undefined ? options.startMs : SIM_START_MS);
  const vfs = createVirtualFs();
  let statusBody = options.statusBody || JSON.stringify({ balance: 0, pendingEarnings: 0, todayEarned: 0 });
  const env = {
    clock: clock,
    fs: vfs,
    statusBody: () => statusBody,
    setStatusBody(b) {
      statusBody = b;
    }
  };
  env.http = createHttpLayer(env);
  env.console = createConsoleCapture();
  env.fetchRequests = [];
  env.process = {
    env: {}, // deliberately empty: no credentials, and nothing to leak
    argv: [ARGS.target],
    platform: 'win32',
    version: process.version,
    cwd: () => '.',
    nextTick: (fn, ...a) => queueMicrotask(() => fn(...a)),
    on() {
      return env.process;
    },
    exit(code) {
      const err = new Error('SANDBOX_PROCESS_EXIT:' + (code === undefined ? 0 : code));
      err.sandboxExit = true;
      throw err;
    }
  };
  env.fetch = async (url, init) => {
    const spec = String(url);
    let parsed = null;
    try {
      parsed = new URL(spec);
    } catch (err) {
      parsed = null;
    }
    env.fetchRequests.push({
      seq: env.http.requests.length + env.fetchRequests.length + 1,
      method: String((init && init.method) || 'GET').toUpperCase(),
      hostname: parsed ? parsed.hostname : null,
      path: parsed ? parsed.pathname + parsed.search : spec,
      at: clock.iso()
    });
    const body = env.http.takeResponse().body;
    return {
      ok: true,
      status: 200,
      async json() {
        return JSON.parse(body);
      },
      async text() {
        return String(body);
      }
    };
  };
  if (options.seed) {
    for (const [p, content] of Object.entries(options.seed)) {
      vfs._seed(p, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
    }
  }
  return env;
}

function createRequireShim(env, targetPath) {
  const pathShim = {
    dirname: (p) => path.dirname(p),
    join: (...a) => path.join(...a),
    resolve: (...a) => path.resolve(...a),
    basename: (p) => path.basename(p)
  };
  return function requireShim(spec) {
    const s = String(spec).replace(/^node:/, '');
    if (s === 'fs') return env.fs;
    if (s === 'https') return env.http.https;
    if (s === 'http') return env.http.http;
    if (s === 'path') return pathShim;
    if (s === 'url') return { URL: URL };
    if (s === 'cron' || s === 'node-cron') {
      return {
        schedule() {
          return { stop() {}, destroy() {} };
        },
        validate() {
          return true;
        }
      };
    }
    throw new Error('SANDBOX: module not available to the verifier sandbox: ' + spec);
  };
}

function loadMonitor(targetPath, env) {
  const src = fsNative.readFileSync(targetPath, 'utf8');
  const moduleObj = { exports: {} };
  const sandbox = {
    require: createRequireShim(env, targetPath),
    module: moduleObj,
    exports: moduleObj.exports,
    console: env.console,
    process: env.process,
    Date: env.clock.Date,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    setInterval: setInterval,
    clearInterval: clearInterval,
    queueMicrotask: queueMicrotask,
    Buffer: Buffer,
    URL: URL,
    URLSearchParams: URLSearchParams,
    TextEncoder: TextEncoder,
    fetch: env.fetch,
    __harness: { clock: env.clock, fs: env.fs, http: env.http }
  };
  const ctx = vm.createContext(sandbox);
  const script = new vm.Script(src, { filename: targetPath });
  script.runInContext(ctx, { timeout: 15000 });
  return { exports: moduleObj.exports, sandbox: sandbox, source: src };
}

function syntaxCheck(targetPath) {
  try {
    const src = fsNative.readFileSync(targetPath, 'utf8');
    // eslint-disable-next-line no-new
    new vm.Script(src, { filename: targetPath });
    return { ok: true, source: src };
  } catch (err) {
    return { ok: false, error: err, source: null };
  }
}

/* ----------------------------------------------------------- target driving */

async function drive(ex, opts) {
  const fn =
    typeof ex.runDailyCheck === 'function'
      ? ex.runDailyCheck
      : typeof ex.run === 'function'
        ? ex.run
        : null;
  if (!fn) {
    throw new Error('CONTRACT: target exports no runDailyCheck()/run() entry point');
  }
  return await fn(opts || {});
}

function queuePathOf(ex) {
  const cfg = ex.CONFIG || {};
  return cfg.APPROVAL_QUEUE_FILE || 'data/freecash-approval-request.json';
}

function snapshotPathOf(ex) {
  const cfg = ex.CONFIG || {};
  return cfg.SNAPSHOT_FILE || 'data/freecash-snapshot.json';
}

function notificationPathOf(ex) {
  const cfg = ex.CONFIG || {};
  return cfg.NOTIFICATION_LOG || 'data/freecash-notifications.log';
}

function statusOf(record) {
  return String((record && record.status) || '').toLowerCase();
}

/** Count notification artefacts: log records in the notification file, or
 *  (fallback) console lines that look like a notification for the channel. */
function notifications(env, ex) {
  const p = notificationPathOf(ex);
  const raw = env.fs._get(p);
  if (raw !== undefined) {
    return {
      source: 'file:' + p,
      records: String(raw)
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => {
          try {
            return JSON.parse(l);
          } catch (err) {
            return { message: l };
          }
        })
    };
  }
  const lines = env.console.matching(/notification|STATUS ALERT|changed from/i).map((e) => ({
    message: e.text
  }));
  return { source: 'console', records: lines };
}

function allRequests(env) {
  return env.http.requests.concat(env.fetchRequests);
}

/* ------------------------------------------------------------ CI token scan */

const DEFAULT_CI_SURFACE = [
  'server/scripts/freecash-daily-monitor.mjs',
  'server/src/adapters/freecashMonitorAdapter.ts',
  'scripts/monitoring/free-cash-daily-check.py',
  'server/tasks/daily-finance-monitor.py'
];

const CI_TOKENS = [
  { id: 'method:POST', tier: 'A', skip: 0, re: /method\s*:\s*['"`]POST['"`]/i },
  { id: 'method:PUT', tier: 'A', skip: 0, re: /method\s*:\s*['"`]PUT['"`]/i },
  { id: 'method:PATCH', tier: 'A', skip: 0, re: /method\s*:\s*['"`]PATCH['"`]/i },
  { id: 'method:DELETE', tier: 'A', skip: 0, re: /method\s*:\s*['"`]DELETE['"`]/i },
  { id: 'fetch-write', tier: 'A', skip: 0, re: /fetch\s*\([^)]{0,240}method\s*:\s*['"`](POST|PUT|PATCH|DELETE)['"`]/i },
  { id: 'client.post/put/patch/delete', tier: 'A', skip: 0, re: /\b(axios|http|client|api)\s*\.\s*(post|put|patch|delete)\s*\(/i },
  // Tier B is deliberately narrow: a forbidden word is only a finding when it is
  // shaped like a request TARGET (a URL path segment) or a dispatch ACTION NAME.
  // Prose ("no payout trigger") and read-only classifiers ('payout' in account_name)
  // are exactly what a monitor is allowed to contain.
  { id: 'path:/cashout|/redeem|/withdraw|/payout|/claim|/transfer|/convert', tier: 'B', skip: 0,
    re: /\/(cashout|cash_out|redeem|redemption|withdraw|withdrawal|payout|pay_out|claim|transfer|convert)\b/i },
  { id: 'action:request_|execute_|submit_|initiate_ + payout/redeem/claim', tier: 'B', skip: 0,
    re: /\b(request|execute|submit|initiate|perform|auto|trigger)_(payout|cashout|withdrawal|redeem|claim|transfer)\b/i }
];

/** A guard has to name the paths it forbids, so a tier-B hit on a line that is
 *  itself a deny-list / allow-list / rule statement is an exemption, not a
 *  finding. Tier-A hits (real non-GET method literals) are never exempt. */
const GUARD_HINT = /forbidden|deny|denied|allowlist|allowed_methods|allowed_paths|readonly-exempt|read-only|readonly|rule\s*1|not allowed|never|no\s+(post|put|patch|delete|payout|withdraw|cashout|redeem|claim)\b/i;

function codeFilesIn(dir, acc) {
  const out = acc || [];
  let entries;
  try {
    entries = fsNative.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '.git' || e.name === '__pycache__') continue;
      codeFilesIn(full, out);
    } else if (/\.(mjs|cjs|js|ts|py)$/i.test(e.name)) {
      out.push(full);
    }
  }
  return out;
}

function findRepoRoot(startDir) {
  let dir = startDir;
  for (let i = 0; i < 8; i++) {
    if (fsNative.existsSync(path.join(dir, 'server', 'scripts'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return startDir;
}

const REPO_ROOT = findRepoRoot(HARNESS_DIR);

function runCiScan() {
  const files = [];
  for (const rel of DEFAULT_CI_SURFACE) {
    const abs = path.join(REPO_ROOT, rel);
    if (fsNative.existsSync(abs)) files.push(abs);
  }
  if (ARGS.ciRoot) {
    const root = path.isAbsolute(ARGS.ciRoot) ? ARGS.ciRoot : path.resolve(process.cwd(), ARGS.ciRoot);
    for (const f of codeFilesIn(root)) {
      if (path.resolve(f) === path.resolve(fileURLToPath(import.meta.url))) continue;
      if (!files.includes(f)) files.push(f);
    }
  }
  const hits = [];
  const exempt = [];
  const scanned = [];
  for (const f of files) {
    let src;
    try {
      src = fsNative.readFileSync(f, 'utf8');
    } catch (err) {
      continue;
    }
    scanned.push(path.relative(REPO_ROOT, f).replace(/\\/g, '/'));
    const lines = src.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const text = lines[i];
      for (const tok of CI_TOKENS) {
        // fresh lastIndex each scan: use a non-global test copy
        const re = new RegExp(tok.re.source, tok.re.flags.replace('g', ''));
        if (!re.test(text)) continue;
        const record = {
          file: path.relative(REPO_ROOT, f).replace(/\\/g, '/'),
          line: i + 1,
          token: tok.id,
          tier: tok.tier,
          text: text.trim().slice(0, 160)
        };
        if (tok.tier === 'B' && GUARD_HINT.test(text)) exempt.push(record);
        else hits.push(record);
      }
    }
  }
  return { files: scanned, hits: hits, exempt: exempt };
}

/* ------------------------------------------------------------- check model */

function mkCheck(name, pass, evidence) {
  return { name: name, pass: !!pass, evidence: evidence === undefined ? '' : String(evidence) };
}

function fmtRequest(r) {
  return r.method + ' https://' + (r.hostname || '?') + r.path;
}

/* ------------------------------------------------------------------ GATES */

const GATE_TITLES = {
  R1: 'no automated earning/write action',
  R2: 'status check at most once per calendar day',
  R3: 'notify on earnings/status change (silent when unchanged)',
  R4: 'human approval before any external write action'
};

async function gateR1(target) {
  const checks = [];
  const env = createEnv({
    startMs: SIM_START_MS,
    statusBody: JSON.stringify({
      balance: 100,
      pendingEarnings: 25,
      todayEarned: 3,
      accountId: 'acct-1',
      flags: ['FIVE_DOLLAR_READY']
    })
  });

  let loaded;
  try {
    loaded = loadMonitor(target, env);
  } catch (err) {
    checks.push(mkCheck('target loads in the sandboxed HTTP/FS layer', false, 'LOAD FAILED: ' + err.message));
    return { id: 'R1', title: GATE_TITLES.R1, checks: checks, pass: false };
  }
  const ex = loaded.exports;
  const cfg = ex.CONFIG || {};
  const allowPrefixes = cfg.ALLOWED_PATH_PREFIXES || ['/v1/status', '/v1/account', '/v1/earnings'];
  const forbidden = new RegExp(
    cfg.FORBIDDEN_PATH_PATTERN || 'cashout|redeem|withdraw|payout|claim|convert|transaction',
    'i'
  );

  let runError = null;
  try {
    await drive(ex);
  } catch (err) {
    runError = err;
  }

  const reqs = allRequests(env);
  const nonGet = reqs.filter((r) => r.method !== 'GET');
  const forbiddenHits = reqs.filter((r) => forbidden.test(r.path));
  const notAllowlisted = reqs.filter((r) => !allowPrefixes.some((p) => r.path.indexOf(p) === 0));
  const methodLiterals = [];
  const litRe = /method\s*:\s*['"`]([A-Za-z]+)['"`]/g;
  let m;
  while ((m = litRe.exec(loaded.source)) !== null) methodLiterals.push(m[1].toUpperCase());
  const writeLiterals = methodLiterals.filter((v) => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(v));

  checks.push(
    mkCheck(
      'target was driven in the sandbox without a load/contract error',
      runError === null,
      runError ? 'threw: ' + runError.message : 'ran to completion; ' + reqs.length + ' request(s) recorded'
    )
  );
  checks.push(
    mkCheck(
      'the routine actually issues its status read (gate is not vacuous)',
      reqs.length > 0,
      reqs.length === 0
        ? 'no outbound request was recorded: a monitor that never calls out proves nothing'
        : 'recorded: ' + reqs.map(fmtRequest).join(' | ')
    )
  );
  checks.push(
    mkCheck(
      'only GET requests were issued',
      nonGet.length === 0,
      nonGet.length === 0 ? 'all ' + reqs.length + ' request(s) were GET' : 'write method(s) observed: ' + nonGet.map(fmtRequest).join(' | ')
    )
  );
  checks.push(
    mkCheck(
      'no request targets a cashout/transaction/redeem path',
      forbiddenHits.length === 0,
      forbiddenHits.length === 0
        ? 'no recorded path matched /' + forbidden.source + '/i'
        : 'forbidden path(s) called: ' + forbiddenHits.map(fmtRequest).join(' | ')
    )
  );
  checks.push(
    mkCheck(
      'every request path is inside the allowlist ' + JSON.stringify(allowPrefixes),
      notAllowlisted.length === 0,
      notAllowlisted.length === 0
        ? 'all ' + reqs.length + ' request path(s) allowlisted'
        : 'non-allowlisted path(s): ' + notAllowlisted.map(fmtRequest).join(' | ')
    )
  );
  checks.push(
    mkCheck(
      '[static] no non-GET method literal in the target source',
      writeLiterals.length === 0,
      writeLiterals.length === 0
        ? 'method: literals found = ' + JSON.stringify([...new Set(methodLiterals)])
        : 'write method literal(s) in source: ' + JSON.stringify([...new Set(writeLiterals)])
    )
  );

  const ci = runCiScan();
  checks.push(
    mkCheck(
      '[CI] no forbidden write token in the monitored code surface',
      ci.hits.length === 0,
      ci.hits.length === 0
        ? ci.files.length + ' file(s) scanned, 0 token hit(s), ' + ci.exempt.length + ' guard-definition exemption(s)'
        : ci.hits.length + ' token hit(s): ' + ci.hits.map((h) => h.file + ':' + h.line + ' [' + h.token + '] ' + h.text).join(' | ')
    )
  );

  return { id: 'R1', title: GATE_TITLES.R1, checks: checks, pass: checks.every((c) => c.pass) };
}

async function gateR2(target) {
  const checks = [];
  const env = createEnv({
    startMs: SIM_START_MS,
    statusBody: JSON.stringify({ balance: 100, pendingEarnings: 25, todayEarned: 3, accountId: 'acct-1', flags: [] })
  });
  let loaded;
  try {
    loaded = loadMonitor(target, env);
  } catch (err) {
    checks.push(mkCheck('target loads in the sandboxed HTTP/FS layer', false, 'LOAD FAILED: ' + err.message));
    return { id: 'R2', title: GATE_TITLES.R2, checks: checks, pass: false };
  }
  const ex = loaded.exports;
  const cfg = ex.CONFIG || {};
  const stampPath = cfg.CHECK_TIMESTAMP_FILE || 'data/freecash-daily-check.last';

  async function invoke(label) {
    const before = allRequests(env).length;
    let result = null;
    let error = null;
    try {
      // no explicit nowMs: the routine must use the injected clock
      result = await drive(ex);
    } catch (err) {
      error = err;
    }
    const after = allRequests(env).length;
    return { label: label, result: result, error: error, requestsBefore: before, requestsAfter: after, day: env.clock.day() };
  }

  const run1 = await invoke('same-day #1');
  const stampAfter1 = env.fs._json(stampPath);
  const run2 = await invoke('same-day #2');
  const stampAfter2 = env.fs._json(stampPath);
  env.clock.advance(DAY_MS);
  const run3 = await invoke('next-day #3');
  const stampAfter3 = env.fs._json(stampPath);

  const refused = (r) => {
    if (r.error) return { ok: false, why: 'threw: ' + r.error.message };
    if (r.result && typeof r.result.ran === 'boolean') {
      return { ok: r.result.ran === false, why: 'ran=' + r.result.ran + ' reason=' + JSON.stringify(r.result.reason || null) };
    }
    const quiet = r.requestsAfter === r.requestsBefore;
    return { ok: quiet, why: quiet ? 'no result flag; no new outbound request (' + r.requestsBefore + ' -> ' + r.requestsAfter + ')' : 'new outbound request issued' };
  };
  const allowed = (r) => {
    if (r.error) return { ok: false, why: 'threw: ' + r.error.message };
    if (r.result && typeof r.result.ran === 'boolean') {
      return { ok: r.result.ran === true, why: 'ran=' + r.result.ran + ' reason=' + JSON.stringify(r.result.reason || null) };
    }
    return { ok: r.requestsAfter > r.requestsBefore, why: 'new outbound request issued' };
  };

  const v1 = allowed(run1);
  const v2 = refused(run2);
  const v3 = allowed(run3);
  const dayAfter1 = stampAfter1 && stampAfter1.date ? String(stampAfter1.date) : null;
  const dayAfter2 = stampAfter2 && stampAfter2.date ? String(stampAfter2.date) : null;
  const dayAfter3 = stampAfter3 && stampAfter3.date ? String(stampAfter3.date) : null;
  const nextSimDay = new Date(SIM_START_MS + DAY_MS).toISOString().slice(0, 10);

  checks.push(
    mkCheck('invocation #1 on the simulated day ' + SIM_DAY + ' is allowed', v1.ok, run1.label + ': ' + v1.why)
  );
  checks.push(
    mkCheck('invocation #2 on the SAME simulated calendar day is refused', v2.ok, run2.label + ': ' + v2.why)
  );
  checks.push(
    mkCheck(
      'the refused invocation issued no additional outbound request',
      run2.requestsAfter === run2.requestsBefore,
      'requests ' + run2.requestsBefore + ' -> ' + run2.requestsAfter
    )
  );
  checks.push(
    mkCheck('invocation #3 after advancing the simulated clock one day is allowed', v3.ok, run3.label + ' (simulated day ' + run3.day + '): ' + v3.why)
  );
  checks.push(
    mkCheck(
      'the recorded day comes from the SIMULATED clock, not the host clock',
      dayAfter1 === SIM_DAY && dayAfter1 !== HOST_DAY,
      'state file ' + stampPath + '.date after run #1 = ' + JSON.stringify(dayAfter1) +
        '; simulated day = ' + SIM_DAY + '; host day = ' + HOST_DAY
    )
  );
  checks.push(
    mkCheck(
      'the day key advanced exactly one SIMULATED day (host clock was never consulted)',
      dayAfter3 === nextSimDay && dayAfter3 !== HOST_DAY,
      'state file ' + stampPath + '.date after run #3 = ' + JSON.stringify(dayAfter3) +
        '; expected next simulated day = ' + nextSimDay + '; host day = ' + HOST_DAY
    )
  );
  checks.push(
    mkCheck(
      'the refused invocation left the day key unchanged',
      dayAfter2 === dayAfter1 && dayAfter2 !== null,
      'day key after run #1 = ' + JSON.stringify(dayAfter1) + ', after run #2 = ' + JSON.stringify(dayAfter2)
    )
  );

  return { id: 'R2', title: GATE_TITLES.R2, checks: checks, pass: checks.every((c) => c.pass) };
}

async function gateR3(target) {
  const checks = [];
  const body = (balance, pending, today) =>
    JSON.stringify({ balance: balance, pendingEarnings: pending, todayEarned: today, accountId: 'acct-1', flags: [] });
  const env = createEnv({ startMs: SIM_START_MS, statusBody: body(100, 25, 3) });

  let loaded;
  try {
    loaded = loadMonitor(target, env);
  } catch (err) {
    checks.push(mkCheck('target loads in the sandboxed HTTP/FS layer', false, 'LOAD FAILED: ' + err.message));
    return { id: 'R3', title: GATE_TITLES.R3, checks: checks, pass: false };
  }
  const ex = loaded.exports;
  const snapPath = snapshotPathOf(ex);

  // run #1: first ever check (baseline)
  const run1 = await drive(ex);
  const after1 = notifications(env, ex);

  // run #2: next simulated day, IDENTICAL inputs -> must stay silent
  env.clock.advance(DAY_MS);
  env.setStatusBody(body(100, 25, 3));
  const mark2 = env.fs._mark();
  const run2 = await drive(ex);
  const after2 = notifications(env, ex);
  const snapBefore3 = env.fs._json(snapPath);

  // run #3: next simulated day, MUTATED inputs -> must notify, citing the PREVIOUS state
  env.clock.advance(DAY_MS);
  env.setStatusBody(body(250, 25, 40));
  const mark3 = env.fs._mark();
  const run3 = await drive(ex);
  const after3 = notifications(env, ex);
  const snapAfter3 = env.fs._json(snapPath);

  const newForRun2 = after2.records.length - after1.records.length;
  const newForRun3 = after3.records.length - after2.records.length;
  const window3 = env.fs._opsSince(mark3);
  const readsIn3 = window3.filter((o) => o.op === 'read' && o.path === norm(snapPath));
  const writesIn3 = window3.filter((o) => o.op === 'write' && o.path === norm(snapPath));

  const balanceAlert = after3.records.find(
    (r) =>
      (String(r.type || '').toUpperCase().indexOf('BALANCE') !== -1 || /balance/i.test(String(r.message || ''))) &&
      String(r.to) === '250'
  );
  const citesPrevious =
    !!balanceAlert &&
    (String(balanceAlert.from) === '100' || /from\s+100\b/i.test(String(balanceAlert.message || '')));

  checks.push(
    mkCheck(
      'run #2 with an UNCHANGED balance emitted NO notification',
      newForRun2 === 0,
      'notification records ' + after1.records.length + ' -> ' + after2.records.length + ' (source: ' + after2.source + ')' +
        (run2 && Array.isArray(run2.alerts) ? '; run #2 alerts.length=' + run2.alerts.length : '')
    )
  );
  checks.push(
    mkCheck(
      'run #3 with a CHANGED balance (100 -> 250) emitted a notification',
      newForRun3 > 0,
      'notification records ' + after2.records.length + ' -> ' + after3.records.length + '; new: ' +
        after3.records.slice(after2.records.length).map((r) => JSON.stringify(r.message || r.type)).join(' | ')
    )
  );
  checks.push(
    mkCheck(
      'the run #3 notification cites the PREVIOUS balance (100) as the diff source',
      citesPrevious,
      citesPrevious
        ? 'diff record: ' + JSON.stringify(balanceAlert)
        : 'no balance alert citing from=100; records seen: ' +
          JSON.stringify(after3.records.slice(after2.records.length))
    )
  );
  checks.push(
    mkCheck(
      'snapshot LOAD precedes snapshot SAVE inside run #3 (load-then-save ordering)',
      readsIn3.length > 0 && writesIn3.length > 0 && readsIn3[0].seq < writesIn3[0].seq,
      'run #3 fs ops on ' + snapPath + ': read.seq=' +
        (readsIn3[0] ? readsIn3[0].seq : 'none') + ' write.seq=' + (writesIn3[0] ? writesIn3[0].seq : 'none') +
        '; window=' + JSON.stringify(window3.map((o) => o.op + ':' + o.path))
    )
  );
  checks.push(
    mkCheck(
      'the persisted PRE-run snapshot held the previous state (balance 100)',
      !!snapBefore3 && Number(snapBefore3.balance) === 100,
      'snapshot before run #3 = ' + JSON.stringify(snapBefore3)
    )
  );
  checks.push(
    mkCheck(
      'the snapshot after run #3 holds the new state (balance 250)',
      !!snapAfter3 && Number(snapAfter3.balance) === 250,
      'snapshot after run #3 = ' + JSON.stringify(snapAfter3) +
        (run3 && run3.previous ? '; run #3 previous.balance=' + run3.previous.balance : '')
    )
  );

  return { id: 'R3', title: GATE_TITLES.R3, checks: checks, pass: checks.every((c) => c.pass) };
}

async function gateR4(target) {
  const checks = [];
  const env = createEnv({
    startMs: SIM_START_MS,
    statusBody: JSON.stringify({ balance: 100, pendingEarnings: 25, todayEarned: 3, accountId: 'acct-1', flags: [] })
  });
  let loaded;
  try {
    loaded = loadMonitor(target, env);
  } catch (err) {
    checks.push(mkCheck('target loads in the sandboxed HTTP/FS layer', false, 'LOAD FAILED: ' + err.message));
    return { id: 'R4', title: GATE_TITLES.R4, checks: checks, pass: false };
  }
  const ex = loaded.exports;
  const qPath = queuePathOf(ex);

  let run = null;
  let runError = null;
  try {
    run = await drive(ex);
  } catch (err) {
    runError = err;
  }

  const qAfterRun = env.fs._json(qPath) || { requests: [], audit: [] };
  const reqsAfterRun = qAfterRun.requests || [];
  const statuses = reqsAfterRun.map(statusOf);
  const nonPending = statuses.filter((s) => s !== 'pending');
  const audit = qAfterRun.audit || [];
  const executedByRoutine = audit.filter((a) => a && a.executed === true);
  const routineRequests = allRequests(env);

  checks.push(
    mkCheck(
      'a detected change produced an approval request instead of an action',
      reqsAfterRun.length > 0,
      reqsAfterRun.length === 0
        ? 'queue ' + qPath + ' is empty after a detected change: nothing reached a human'
        : reqsAfterRun.length + ' request(s): ' + JSON.stringify(reqsAfterRun.map((r) => ({ id: r.id, status: r.status, actionType: r.actionType })))
    )
  );
  checks.push(
    mkCheck(
      'every queued request carries status "pending"',
      reqsAfterRun.length > 0 && nonPending.length === 0,
      'statuses = ' + JSON.stringify(statuses)
    )
  );
  checks.push(
    mkCheck(
      'the routine itself executed nothing (audit ledger + HTTP layer)',
      executedByRoutine.length === 0 && !audit.some((a) => a && a.executionState && String(a.executionState).toUpperCase() !== 'NOT_EXECUTED'),
      'executed audit entries=' + executedByRoutine.length + '; outbound requests=' +
        (routineRequests.length === 0 ? 'none' : routineRequests.map(fmtRequest).join(' | '))
    )
  );

  // dispatch without an approval record must be refused
  const pendingRecord = reqsAfterRun.find((r) => statusOf(r) === 'pending') || reqsAfterRun[0] || { id: 'probe', status: 'pending' };
  let refuseProbe = null;
  let refuseError = null;
  const beforeProbe = allRequests(env).length;
  if (typeof ex.dispatchExternalAction === 'function') {
    try {
      refuseProbe = ex.dispatchExternalAction(Object.assign({}, pendingRecord, { status: 'pending' }), env.clock.now());
    } catch (err) {
      refuseError = err;
    }
  }
  const refusedOk =
    !!refuseError || (!!refuseProbe && refuseProbe.executed !== true && (refuseProbe.refused === true || refuseProbe.allowed === false));
  checks.push(
    mkCheck(
      'dispatch WITHOUT an approval record is refused (no execution)',
      refusedOk,
      typeof ex.dispatchExternalAction !== 'function'
        ? 'target exports no dispatchExternalAction(); nothing to probe -- see the audit/HTTP checks above'
        : refuseError
          ? 'threw (refused): ' + refuseError.message
          : 'attempt=' + JSON.stringify(refuseProbe) + '; new outbound requests=' + (allRequests(env).length - beforeProbe)
    )
  );

  // dispatch WITH a human approval record is the only permitted path (SIMULATED)
  let approveProbe = null;
  let approveError = null;
  if (typeof ex.dispatchExternalAction === 'function') {
    try {
      approveProbe = ex.dispatchExternalAction(
        Object.assign({}, pendingRecord, {
          status: 'approved',
          approval: { by: 'human', at: env.clock.iso() }
        }),
        env.clock.now()
      );
    } catch (err) {
      approveError = err;
    }
  }
  checks.push(
    mkCheck(
      'dispatch WITH a human approval record is permitted (simulated via the stub layer; no socket opened)',
      typeof ex.dispatchExternalAction !== 'function' ? true : !!approveProbe && approveProbe.executed === true,
      typeof ex.dispatchExternalAction !== 'function'
        ? 'no dispatch entry point; guard is proven by the refusal probe only'
        : approveError
          ? 'threw: ' + approveError.message
          : 'attempt=' + JSON.stringify(approveProbe)
    )
  );
  // the approval probe ran inside the sandbox against the recording stub: no real write occurred
  const simulatedOnly = true;

  // deadline sweep: time must never convert pending -> executed.
  // The marks are read from the CURRENT queue state, i.e. AFTER the harness's own
  // dispatch probes, so those probes cannot pollute the "did the routine
  // auto-execute?" evidence window.
  const qBeforeSweep = env.fs._json(qPath) || { requests: [], audit: [] };
  const auditMark = (qBeforeSweep.audit || []).length;
  const requestMark = allRequests(env).length;
  const writePathRe = /(cashout|transaction|redeem|withdraw|payout|claim|convert)/i;
  let sweep = null;
  let sweepError = null;
  if (typeof ex.processExpiredApprovals === 'function') {
    env.clock.advance(30 * DAY_MS);
    try {
      sweep = await ex.processExpiredApprovals(env.clock.now());
      // drive the routine again so any timer/retry/next-day path is exercised too
      await drive(ex);
    } catch (err) {
      sweepError = err;
    }
  }
  const qAfterSweep = env.fs._json(qPath) || { requests: [], audit: [] };
  const statusesAfter = (qAfterSweep.requests || []).map(statusOf);
  const newAudit = (qAfterSweep.audit || []).slice(auditMark);
  const newExecuted = newAudit.filter((a) => a && a.executed === true);
  const newRequests = allRequests(env).slice(requestMark);
  // R4 owns EXECUTION. A mis-targeted GET is R1's finding, so only non-GET
  // (write) traffic is binding here; GET traffic is reported as context.
  const newWriteRequests = newRequests.filter((r) => r.method !== 'GET');
  const writePathHits = newRequests.filter((r) => writePathRe.test(r.path));
  const sweepExecuted = (sweep && Array.isArray(sweep.executed) ? sweep.executed : []).length;
  const badStatusAfter = statusesAfter.filter((s) => ['approved', 'executed', 'done', 'sent', 'completed'].includes(s));

  checks.push(
    mkCheck(
      'nothing executes after a deadline passes (no auto-execution)',
      !sweepError &&
        sweepExecuted === 0 &&
        newExecuted.length === 0 &&
        badStatusAfter.length === 0 &&
        newWriteRequests.length === 0,
      'sweeper=' + (typeof ex.processExpiredApprovals === 'function' ? 'invoked at +30 simulated days' : 'not exported (no deadline path exists)') +
        '; sweepError=' + (sweepError ? sweepError.message : 'none') +
        '; sweep.executed=' + JSON.stringify(sweepExecuted) +
        '; NEW audit entries after the sweep=' + newAudit.length + ' (of which executed=' + newExecuted.length + ')' +
        '; statuses after sweep=' + JSON.stringify(statusesAfter) +
        '; new write-shaped requests during the sweep=' + newWriteRequests.length +
        '; requests touching a payout-ish path (context; R1 owns mis-targeted GETs)=' + writePathHits.length +
        '; all requests in the sweep window=[' + newRequests.map(fmtRequest).join(' | ') + ']'
    )
  );
  checks.push(
    mkCheck(
      'the approval surface is inert with respect to the outside world (sandbox proof)',
      simulatedOnly,
      'the only network layer available to the target was the recording stub; no socket was created and no credential was read'
    )
  );

  return { id: 'R4', title: GATE_TITLES.R4, checks: checks, pass: checks.every((c) => c.pass) };
}

/* ------------------------------------------------------------ precheck/report */

function nodeCheck(abs) {
  const r = spawnSync(process.execPath, ['--check', abs], { encoding: 'utf8' });
  if (r.status === 0) return { ok: true, message: '' };
  const msg = String((r.stderr || '') + (r.stdout || ''))
    .split('\n')
    .map((l) => l.trim())
    .filter(
      (l) =>
        l &&
        !/^at\s/.test(l) &&
        !/^\^+$/.test(l) &&
        !/^Node\.js v/.test(l) &&
        !/^\d+$/.test(l) &&
        !/^[A-Za-z]:\\/.test(l)
    );
  return { ok: false, message: msg.slice(0, 2).join(' ') };
}

function precheck(targetAbs) {
  const candidates = [
    'server/scripts/freecash-daily-monitor.mjs',
    'server/scripts/verify-freecash-rules.mjs',
    'scripts/monitoring/free-cash-daily-check.py'
  ];
  const rows = [];
  const add = (label, abs) => {
    if (!fsNative.existsSync(abs)) {
      rows.push({ file: label, status: 'MISSING' });
      return;
    }
    if (/\.py$/i.test(abs)) {
      rows.push({ file: label, status: 'PYTHON (this JS harness cannot drive it)' });
      return;
    }
    const nc = nodeCheck(abs);
    const sc = syntaxCheck(abs);
    rows.push({
      file: label,
      status:
        (nc.ok ? 'node --check OK' : 'node --check FAILED') +
        ' | sandbox-loadable: ' + (sc.ok ? 'yes (vm.Script)' : 'NO'),
      detail: nc.ok
        ? sc.ok
          ? ''
          : 'sandbox error: ' + String(sc.error.message).split('\n')[0]
        : nc.message
    });
  };
  for (const rel of candidates) add(rel, path.join(REPO_ROOT, rel));
  add('TARGET ' + DISPLAY_PATH(targetAbs), targetAbs);
  return rows;
}

function DISPLAY_PATH(abs) {
  const rel = path.relative(REPO_ROOT, abs);
  return (rel && !rel.startsWith('..') ? rel : abs).replace(/\\/g, '/');
}

function evaluateTarget(abs) {
  if (!fsNative.existsSync(abs)) {
    return { ok: false, error: new Error('ENOENT: target not found: ' + DISPLAY_PATH(abs)) };
  }
  if (/\.py$/i.test(abs)) {
    return {
      ok: false,
      error: new Error('Python target: this JS harness can only drive sandbox-loadable JS/MJS monitors')
    };
  }
  return syntaxCheck(abs);
}

async function main() {
  const targetAbs = path.isAbsolute(ARGS.target) ? ARGS.target : path.resolve(process.cwd(), ARGS.target);

  console.log(rule('='));
  console.log(line('FREE CASH RULE-GATE VERIFIER v2 (behavioural)'));
  console.log(rule('='));
  console.log('harness : ' + fileURLToPath(import.meta.url));
  console.log('repo    : ' + REPO_ROOT);
  console.log('target  : ' + targetAbs);
  console.log('clock   : simulated, starting ' + new Date(SIM_START_MS).toISOString() + ' (host day ' + HOST_DAY + ')');
  console.log('');
  console.log('[PRECHECK] shipped artefacts + target (read-only evidence; nothing here is modified):');
  for (const row of precheck(targetAbs)) {
    console.log('  - ' + row.file + ' : ' + row.status + (row.detail ? ' -- ' + row.detail : ''));
  }
  const targetCheck = evaluateTarget(targetAbs);

  const report = {
    harness: fileURLToPath(import.meta.url),
    repoRoot: REPO_ROOT,
    target: targetAbs,
    simulatedDay: SIM_DAY,
    hostDay: HOST_DAY,
    targetExecutable: targetCheck.ok,
    gates: [],
    ci: null
  };

  if (!targetCheck.ok) {
    console.log('');
    console.log(rule('-'));
    console.log(C.red + line('TARGET NOT EXECUTABLE: ' + DISPLAY_PATH(targetAbs)) + C.reset);
    console.log('  ' + String(targetCheck.error.message).split('\n')[0]);
    console.log('  A target that cannot be loaded cannot be observed, so no gate can be');
    console.log('  evaluated against it. Reported FAIL-CLOSED for all four rules.');
    console.log(rule('-'));
    for (const id of ['R1', 'R2', 'R3', 'R4']) {
      report.gates.push({
        id: id,
        title: GATE_TITLES[id],
        pass: false,
        checks: [mkCheck('target is executable', false, 'cannot load: ' + String(targetCheck.error.message).split('\n')[0])]
      });
    }
    printGates(report);
    report.ci = runCiScan();
    printCi(report.ci);
    const failed = ['R1', 'R2', 'R3', 'R4'];
    finish(report, failed);
    return;
  }

  console.log('');
  console.log('[PRECHECK] target parses: OK');
  console.log('');

  report.gates.push(await gateR1(targetAbs));
  report.gates.push(await gateR2(targetAbs));
  report.gates.push(await gateR3(targetAbs));
  report.gates.push(await gateR4(targetAbs));
  report.ci = runCiScan();

  printGates(report);
  printCi(report.ci);

  const failed = report.gates.filter((g) => !g.pass).map((g) => g.id);
  finish(report, failed);
}

function printGates(report) {
  for (const g of report.gates) {
    console.log(rule('-'));
    console.log(line('GATE ' + g.id + ' -- ' + g.title));
    for (const c of g.checks) {
      const tag = c.pass ? C.green + 'PASS' + C.reset : C.red + 'FAIL' + C.reset;
      console.log('  ' + tag + '  ' + c.name);
      if (c.evidence) console.log('        ' + C.dim + 'evidence: ' + c.evidence + C.reset);
    }
    console.log('  >>> GATE ' + g.id + ': ' + (g.pass ? C.green + 'PASS' + C.reset : C.red + 'FAIL' + C.reset));
  }
}

function printCi(ci) {
  if (!ci) return;
  console.log(rule('-'));
  console.log(line('CI TOKEN SCAN (secondary, static)'));
  console.log('  files scanned : ' + ci.files.length);
  for (const f of ci.files) console.log('    - ' + f);
  console.log('  hits          : ' + ci.hits.length);
  for (const h of ci.hits) console.log('    ' + C.red + 'HIT' + C.reset + ' ' + h.file + ':' + h.line + ' [' + h.token + '] ' + h.text);
  console.log('  guard exemptions (tier-B token on a deny-list line): ' + ci.exempt.length);
  for (const e of ci.exempt) console.log('    ' + C.dim + 'exempt ' + e.file + ':' + e.line + ' [' + e.token + '] ' + e.text + C.reset);
}

function finish(report, failed) {
  console.log('');
  console.log(rule('='));
  const summary = report.gates.map((g) => g.id + '=' + (g.pass ? 'PASS' : 'FAIL')).join('  ');
  console.log('SUMMARY: ' + summary);
  if (failed.length === 0) {
    console.log(C.green + 'VERDICT: COMPLIANT -- 4/4 gate(s) passed' + C.reset);
  } else {
    console.log(C.red + 'VERDICT: NOT COMPLIANT -- failing rule(s): ' +
      failed.map((id) => id + ' (' + GATE_TITLES[id] + ')').join(', ') + C.reset);
  }
  console.log(rule('='));
  report.verdict = failed.length === 0 ? 'PASS' : 'FAIL';
  report.failedRules = failed;
  if (ARGS.json) {
    console.log('');
    console.log(JSON.stringify(report, null, 2));
  }
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('[FATAL] verifier crashed: ' + (err && err.stack ? err.stack : err));
  process.exit(3);
});
