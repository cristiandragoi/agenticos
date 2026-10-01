#!/usr/bin/env python3
"""verify_freecash_rules.py -- falsifiable verifier for the Free Cash read-only monitor (R1-R4).

    python verify_freecash_rules.py <TARGET_TREE> [--workdir DIR] [--keep] [--json]

``<TARGET_TREE>`` is the directory that holds ``run_daily_check.py``, ``gate.py``,
``changedetect.py``, ``notify.py``, ``approval_queue.py``, ``readonly_client.py``,
``paths.py``, ``operator_state.py``, ``watchdog.py`` and ``verify_readonly.py``
(canonically ``D:/AgenticOS/monitoring/freecash``).

Because the tree root is an argv parameter, the very same checker can be aimed at
a deliberately broken copy in a throw-away directory.  That is the only way to
prove the checker can fail: a verifier that has never been observed to fail
certifies nothing.

WHAT THIS CHECKER IS NOT
------------------------
It is not a grep for keywords.  Every assertion below is a definite predicate
over either (a) a subprocess that actually imports and runs the inspected tree
against a throw-away ``FREECASH_DATA_ROOT``, or (b) the parsed source of the
inspected tree with a positive control.  No assertion is written as ``A || B``
where one disjunct is trivially true; that is exactly the defect (a tautological
``!includes('checkForChanges') || includes('.log(')``) that made an earlier
verifier print ``4/4 PASSED`` for every input.

Offline by construction: the only read source exercised is the operator-entered
state file; no provider host is ever contacted; the toast channel is the
recording/stub seam.

Exit codes
----------
    0   every rule assertion passed on the inspected tree
    1   at least one rule assertion FAILED (a rule violation exists in the tree)
    2   the check could not be carried out at all (target missing, required
        module absent, probe could not be launched) -- absence of evidence is
        NOT a pass
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

VERSION = "1.0.0"

REQUIRED_MODULES = (
    "run_daily_check.py",
    "gate.py",
    "changedetect.py",
    "notify.py",
    "approval_queue.py",
    "readonly_client.py",
    "paths.py",
    "operator_state.py",
    "watchdog.py",
    "verify_readonly.py",
)

#: Modules allowed to name a socket library.  Everything else must not.
SOCKET_ALLOWED_MODULES = ("readonly_client.py", "verify_readonly.py")

LOOPBACK_HOSTS = {"localhost", "127.0.0.1", "::1", "[::1]"}
HOST_PATTERN = re.compile(r"https?://([A-Za-z0-9._\-]+)")

RULE_TITLES = {
    "R1": "at most one status check per Europe/Berlin calendar day",
    "R2": "zero automated earning / transaction actions (read-only verbs and paths only)",
    "R3": "notification fires on an earnings/status change and is deduplicated",
    "R4": "no external action without human approval (queue is written, never auto-executed)",
}

CONCURRENCY_PROCS = 5

# --------------------------------------------------------------------------- probes
# Every probe runs as a fresh subprocess with PYTHONPATH=<target> so the inspected
# tree is imported, never the checker's own process.  A probe prints one JSON
# object with an "ok" key on its last line.

PROBE_DAYKEY = r'''
import json
from datetime import datetime, timezone
import gate
m = datetime(2026, 9, 17, 22, 30, tzinfo=timezone.utc)   # 2026-09-18T00:30 Europe/Berlin
berlin = gate.day_key(m, tz="Europe/Berlin")
utc = gate.day_key(m, tz="UTC")
ok = (berlin == "2026-09-18") and (utc == "2026-09-17") and (berlin != utc)
print(json.dumps({"ok": bool(ok), "detail": "day_key(22:30Z, Europe/Berlin)=%s  day_key(22:30Z, UTC)=%s" % (berlin, utc)}))
'''

PROBE_GUARDS = r'''
import json
import readonly_client as rc
METRICS = "http://localhost:3001/api/v1/status/metrics"
calls = []
def spy(method, url, timeout=None, headers=None):
    calls.append((method, url))
    return {"method": method, "url": url, "status": 200, "headers": {}, "body": b"{}"}
def refused(fn):
    try:
        fn()
        return False
    except rc.ForbiddenWriteError:
        return True
    except Exception:
        return False
r = {}
r["post_refused"] = refused(lambda: rc.request("POST", METRICS, transport=spy))
r["put_refused"] = refused(lambda: rc.request("PUT", METRICS, transport=spy))
r["delete_refused"] = refused(lambda: rc.request("DELETE", METRICS, transport=spy))
r["withdraw_path_refused"] = refused(lambda: rc.request("GET", "http://localhost:3001/api/v1/withdraw", transport=spy))
r["claim_path_refused"] = refused(lambda: rc.request("GET", "http://localhost:3001/api/v1/status/claim", transport=spy))
r["admin_path_refused"] = refused(lambda: rc.request("GET", "http://localhost:3001/admin", transport=spy))
r["body_carrying_get_refused"] = refused(lambda: rc.request("GET", METRICS, json={}, transport=spy))
r["nonloopback_host_refused"] = refused(lambda: rc.request("GET", "http://provider.invalid/api/v1/status/metrics", transport=spy))
r["bad_scheme_refused"] = refused(lambda: rc.request("GET", "file:///etc/passwd", transport=spy))
r["audit_hook_refuses_remote"] = refused(lambda: rc._audit_hook("socket.connect", (None, ("provider.invalid", 443))))
def _loopback_ok():
    rc._audit_hook("socket.connect", (None, ("127.0.0.1", 3001)))
    rc._audit_hook("open", ("C:/tmp/x", "r", 0))
    return True
r["audit_hook_allows_loopback"] = _loopback_ok()
r["no_transport_call_before_allowlisted_get"] = (calls == [])
r["allowlisted_get_reaches_transport"] = (rc.request("GET", METRICS, transport=spy)["status"] == 200)
print(json.dumps({"ok": all(r.values()), "detail": json.dumps(r, sort_keys=True)}))
'''

PROBE_ALLOWLIST = r'''
import json
import readonly_client as rc
pats = [p.pattern for p in rc.ALLOWED_PATHS]
methods = sorted(rc.ALLOWED_METHODS)
hosts = sorted(rc.ALLOWED_HOSTS)
ok = (pats == [r"^/api/v1/status/metrics$", r"^/api/v1/status$"]
      and methods == ["GET", "HEAD"]
      and set(hosts) <= {"localhost", "127.0.0.1", "::1", "[::1]"})
print(json.dumps({"ok": bool(ok), "detail": "paths=%s methods=%s hosts=%s" % (pats, methods, hosts)}))
'''

PROBE_R3 = r'''
import json
from datetime import datetime, timedelta, timezone
import changedetect, notify, paths, run_daily_check

BASE = datetime(2026, 10, 1, 6, 35, tzinfo=timezone.utc)   # 08:35 Europe/Berlin
def day_at(o): return (BASE.date() + timedelta(days=o)).isoformat()
def moment(o): return BASE + timedelta(days=o)

class Sender:
    delivery_label = "TOAST_OK"
    def __init__(self): self.messages = []
    def __call__(self, m): self.messages.append(m)

root = paths.data_root()
(root / "state").mkdir(parents=True, exist_ok=True)

def write_record(day, earnings, balance):
    p = root / "state" / "operator-state.json"
    doc = json.loads(p.read_text(encoding="utf-8")) if p.exists() else {
        "schema_version": 1, "kind": "operator_entered_daily_status", "records": []}
    doc["records"].append({"day_key": day, "entered_at_utc": day + "T06:40:00Z",
        "account_status": "ACTIVE", "earnings_total_cents": earnings,
        "balance_cents": balance, "pending_cents": 0, "currency": "USD"})
    p.write_text(json.dumps(doc), encoding="utf-8")

s = Sender()
write_record(day_at(0), 1025, 1025)
c0 = run_daily_check.run([], now=moment(0), sender=s)
write_record(day_at(1), 1340, 1340)          # earnings moved -> must notify once
c1 = run_daily_check.run([], now=moment(1), sender=s)
write_record(day_at(2), 1340, 1340)          # nothing moved -> log only
c2 = run_daily_check.run([], now=moment(2), sender=s)

records = paths.read_jsonl(paths.alerts_path())
def count(et): return sum(1 for r in records if r.get("event_type") == et)
counts = {"INITIAL_BASELINE": count("INITIAL_BASELINE"),
          "EARNINGS_CHANGED": count("EARNINGS_CHANGED"),
          "OK_NO_CHANGE": count("OK_NO_CHANGE"),
          "notifications": len(s.messages)}
ok = (c0 == 0 and c1 == 0 and c2 == 0
      and counts["INITIAL_BASELINE"] == 1
      and counts["EARNINGS_CHANGED"] == 1
      and counts["OK_NO_CHANGE"] == 1
      and counts["notifications"] == 1)
print(json.dumps({"ok": bool(ok), "detail": json.dumps(counts, sort_keys=True) + " rc=(%s,%s,%s)" % (c0, c1, c2)}))
'''

PROBE_R3_DEDUPE = r'''
import json
import changedetect, notify

class Sender:
    delivery_label = "TOAST_OK"
    def __init__(self): self.messages = []
    def __call__(self, m): self.messages.append(m)

s = Sender()
change = {"change_type": "EARNINGS_CHANGED", "field": "earnings_total_cents",
          "old_value": 1025, "new_value": 1340, "prior_day_key": "2026-10-01"}
day = "2026-10-02"
key = changedetect.dedupe_key(day, "EARNINGS_CHANGED", "earnings_total_cents", 1025, 1340)
other_day = "2026-10-03"
other_key = changedetect.dedupe_key(other_day, "EARNINGS_CHANGED", "earnings_total_cents", 1025, 1340)

first = notify.notify_change(day, change, "m1", key, sender=s, sleep_seconds=0)
second = notify.notify_change(day, change, "m1", key, sender=s, sleep_seconds=0)
third = notify.notify_change(other_day, change, "m2", other_key, sender=s, sleep_seconds=0)
res = {"first": first, "second": second, "third": third,
       "messages": len(s.messages), "keys_differ": key != other_key}
ok = (first == "NOTIFIED" and second == "DEDUPED" and third == "NOTIFIED"
      and len(s.messages) == 2 and key != other_key)
print(json.dumps({"ok": bool(ok), "detail": json.dumps(res, sort_keys=True)}))
'''

PROBE_R4_ENQUEUE = r'''
import json
from datetime import datetime, timedelta, timezone
import paths, run_daily_check

BASE = datetime(2026, 10, 1, 6, 35, tzinfo=timezone.utc)
def day_at(o): return (BASE.date() + timedelta(days=o)).isoformat()
def moment(o): return BASE + timedelta(days=o)

class Sender:
    delivery_label = "TOAST_OK"
    def __init__(self): self.messages = []
    def __call__(self, m): self.messages.append(m)

root = paths.data_root()
(root / "state").mkdir(parents=True, exist_ok=True)
def write_record(day, earnings, balance):
    p = root / "state" / "operator-state.json"
    doc = json.loads(p.read_text(encoding="utf-8")) if p.exists() else {
        "schema_version": 1, "kind": "operator_entered_daily_status", "records": []}
    doc["records"].append({"day_key": day, "entered_at_utc": day + "T06:40:00Z",
        "account_status": "ACTIVE", "earnings_total_cents": earnings,
        "balance_cents": balance, "pending_cents": 0, "currency": "USD"})
    p.write_text(json.dumps(doc), encoding="utf-8")

s = Sender()
write_record(day_at(0), 1025, 1025)
run_daily_check.run([], now=moment(0), sender=s)
write_record(day_at(1), 1340, 1340)
run_daily_check.run([], now=moment(1), sender=s)

doc = json.loads(paths.pending_path().read_text(encoding="utf-8"))
items = doc.get("items", [])
res = {"items": len(items)}
ok = (len(items) == 1)
if items:
    it = items[0]
    res.update({"status": it.get("status"), "expires_at_utc": it.get("expires_at_utc"),
                "execution_state": it.get("execution_state"),
                "execution_allowed_by_this_routine": it.get("execution_allowed_by_this_routine")})
    ok = ok and it.get("status") == "PENDING" and it.get("expires_at_utc") is None \
        and it.get("execution_state") == "NOT_EXECUTED" \
        and it.get("execution_allowed_by_this_routine") is False
print(json.dumps({"ok": bool(ok), "detail": json.dumps(res, sort_keys=True, default=str)}))
'''

PROBE_R4_DECIDE = r'''
import json
import approval_queue as aq

item = aq.enqueue("2026-10-02",
                  {"change_type": "EARNINGS_CHANGED", "field": "earnings_total_cents",
                   "old_value": 1025, "new_value": 1340},
                  "earnings moved")
refused = False
try:
    aq.decide(item["approval_id"], "approve", "system", "auto")
except aq.NotHumanError:
    refused = True
decided = aq.decide(item["approval_id"], "approve", "Operator Jane", "checked the figures myself")
res = {"machine_refused": refused, "status": decided.get("status"),
       "execution_state": decided.get("execution_state"),
       "expires_at_utc": decided.get("expires_at_utc"),
       "execution_allowed_by_this_routine": decided.get("execution_allowed_by_this_routine")}
ok = (refused and decided.get("status") == "APPROVED"
      and decided.get("execution_state") == "NOT_EXECUTED"
      and decided.get("expires_at_utc") is None
      and decided.get("execution_allowed_by_this_routine") is False)
print(json.dumps({"ok": bool(ok), "detail": json.dumps(res, sort_keys=True, default=str)}))
'''

# --------------------------------------------------------------------------- infra


def _json_line(text):
    for line in reversed((text or "").splitlines()):
        line = line.strip()
        if not line or line[0] != "{":
            continue
        try:
            obj = json.loads(line)
        except ValueError:
            continue
        if isinstance(obj, dict) and "ok" in obj:
            return obj
    return None


def _tail(text, n=300):
    return (text or "").strip()[-n:]


def _line_with(text, token):
    for line in (text or "").splitlines():
        if token in line:
            return line.strip()
    return None


class Runner:
    """Runs subprocesses against *target* with an isolated data root."""

    def __init__(self, target: Path, workdir: Path):
        self.target = target
        self.workdir = workdir
        self._n = 0

    def fresh_root(self) -> Path:
        self._n += 1
        root = self.workdir / ("data-%02d" % self._n)
        root.mkdir(parents=True, exist_ok=True)
        return root

    def env(self, data_root: Path, extra=None) -> dict:
        env = dict(os.environ)
        env["PYTHONPATH"] = str(self.target)
        env["PYTHONDONTWRITEBYTECODE"] = "1"
        env["FREECASH_DATA_ROOT"] = str(data_root)
        env["FREECASH_TZ"] = "Europe/Berlin"
        env["FREECASH_TOAST_STUB"] = "1"
        env["FREECASH_TOAST_RETRY_SLEEP_SECONDS"] = "0"
        for key in ("FREECASH_READ_SOURCE", "FREECASH_READ_BASE_URL", "FREECASH_HTTP_TIMEOUT"):
            env.pop(key, None)
        env.update(extra or {})
        return env

    def probe(self, code: str, data_root: Path, extra_env=None, timeout=120):
        return subprocess.run(
            [sys.executable, "-c", code],
            capture_output=True, text=True,
            env=self.env(data_root, extra_env),
            cwd=str(self.target), timeout=timeout,
        )

    def entry(self, args=(), data_root=None, extra_env=None, timeout=180):
        root = data_root or self.fresh_root()
        return subprocess.run(
            [sys.executable, str(self.target / "run_daily_check.py"), *args],
            capture_output=True, text=True,
            env=self.env(root, extra_env),
            cwd=str(self.target), timeout=timeout,
        ), root

    def popen(self, data_root, extra_env=None):
        return subprocess.Popen(
            [sys.executable, str(self.target / "run_daily_check.py")],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
            env=self.env(data_root, extra_env), cwd=str(self.target),
        )


def _result(rule, aid, title, ok, detail):
    return {"rule": rule, "id": aid, "title": title, "ok": bool(ok), "detail": detail}


def _probe_result(runner, rule, aid, title, code, timeout=120):
    root = runner.fresh_root()
    proc = runner.probe(code, root, timeout=timeout)
    obj = _json_line(proc.stdout)
    if obj is None:
        return _result(rule, aid, title, False,
                       "probe produced no result (rc=%s) stderr=%s"
                       % (proc.returncode, _tail(proc.stderr)))
    return _result(rule, aid, title, obj["ok"], str(obj.get("detail", "")))


def _module_files(target: Path):
    return sorted(p for p in target.glob("*.py"))


# --------------------------------------------------------------------------- R1


def check_r1(runner: Runner):
    out = []

    # R1.1 -- the same command twice on the same operator-local day.
    root = runner.fresh_root()
    p1, _ = runner.entry(data_root=root)
    p2, _ = runner.entry(data_root=root)
    snaps = sorted(p.name for p in (root / "snapshots").glob("*.json")) if (root / "snapshots").exists() else []
    r1 = _line_with(p1.stdout, "RUN_OK")
    r2 = _line_with(p2.stdout, "SKIP_DUPLICATE_DAY")
    ok = (p1.returncode == 0 and p2.returncode == 0 and r1 is not None and r2 is not None and len(snaps) == 1)
    out.append(_result(
        "R1", "R1.1", "a second run on an already-consumed operator-local day performs no second read",
        ok,
        "run1=%r run2=%r snapshots=%d rc=(%d,%d)" % (r1, r2, len(snaps), p1.returncode, p2.returncode)
        + ("" if ok else " stderr=%s%s" % (_tail(p1.stderr, 150), _tail(p2.stderr, 150)))))

    # R1.2 -- the day key is the operator wall clock, not UTC and not a constant.
    out.append(_probe_result(runner, "R1", "R1.2",
                             "the day key is the operator-local calendar day (Europe/Berlin by default)",
                             PROBE_DAYKEY))

    # R1.3 -- simultaneous copies cannot both consume the day (atomic exclusive create).
    root = runner.fresh_root()
    procs = [runner.popen(root) for _ in range(CONCURRENCY_PROCS)]
    outs = [p.communicate(timeout=300) for p in procs]
    runs = sum(1 for o, _e in outs if "RUN_OK" in o)
    skips = sum(1 for o, _e in outs if "SKIP_DUPLICATE_DAY" in o)
    codes = [p.returncode for p in procs]
    ok = (runs == 1 and skips == CONCURRENCY_PROCS - 1 and all(c == 0 for c in codes))
    out.append(_result(
        "R1", "R1.3", "%d simultaneous runs yield exactly one reader" % CONCURRENCY_PROCS,
        ok, "runs=%d skips=%d rc=%s" % (runs, skips, codes)))

    return out


# --------------------------------------------------------------------------- R2


def check_r2(runner: Runner, target: Path):
    out = []

    root = runner.fresh_root()
    proc = runner.probe(PROBE_GUARDS, root)
    obj = _json_line(proc.stdout)
    if obj is None:
        detail = "probe produced no result (rc=%s) stderr=%s" % (proc.returncode, _tail(proc.stderr))
        out.append(_result("R2", "R2.1", "write verbs are refused before the transport is reached", False, detail))
        out.append(_result("R2", "R2.2", "non-allowlisted paths are refused", False, detail))
        out.append(_result("R2", "R2.3", "non-loopback hosts and the process audit guard refuse a connect", False, detail))
    else:
        detail = str(obj.get("detail", ""))
        try:
            flags = json.loads(detail)
        except ValueError:
            flags = {}
        # R2.1 write verbs + transport never reached
        v = flags.get("post_refused"), flags.get("put_refused"), flags.get("delete_refused")
        b = flags.get("body_carrying_get_refused")
        t = flags.get("no_transport_call_before_allowlisted_get")
        a = flags.get("allowlisted_get_reaches_transport")
        out.append(_result(
            "R2", "R2.1", "write verbs (POST/PUT/DELETE) are refused before the transport is reached",
            all(x is True for x in v + (b, t, a)),
            "POST/PUT/DELETE refused=%s body-refused=%s transport-untouched=%s allowlisted-GET-ok=%s"
            % (v, b, t, a)))
        # R2.2 paths
        paths_flags = (flags.get("withdraw_path_refused"), flags.get("claim_path_refused"),
                       flags.get("admin_path_refused"), b, t)
        out.append(_result(
            "R2", "R2.2", "write/earning endpoint paths are refused",
            all(x is True for x in paths_flags),
            "withdraw=%s claim=%s admin=%s body=%s transport-untouched=%s"
            % paths_flags))
        # R2.3 host + audit guard
        h = (flags.get("nonloopback_host_refused"), flags.get("bad_scheme_refused"),
             flags.get("audit_hook_refuses_remote"), flags.get("audit_hook_allows_loopback"))
        out.append(_result(
            "R2", "R2.3", "non-loopback host is refused and the audit hook aborts a remote connect",
            all(x is True for x in h),
            "nonloopback=%s bad-scheme=%s audit-refuses-remote=%s audit-allows-loopback=%s" % h))

    # R2.4 -- allowlists are exactly the two local read operations; no provider host hardcoded.
    guard = _probe_result(runner, "R2", "R2.4", "transport allowlists admit only the two local read ops",
                          PROBE_ALLOWLIST)
    files = _module_files(target)
    hosts = set()
    for path in files:
        try:
            text = path.read_text(encoding="utf-8")
        except OSError:
            continue
        hosts |= {m.group(1) for m in HOST_PATTERN.finditer(text)}
    rc_text = ""
    try:
        rc_text = (target / "readonly_client.py").read_text(encoding="utf-8")
    except OSError:
        pass
    hard_hosts = sorted(h for h in hosts if h not in LOOPBACK_HOSTS)
    positive_control = bool(hosts)
    provider_marker = "PROVIDER_ENDPOINT_UNKNOWN" in rc_text
    host_ok = (positive_control and not hard_hosts and provider_marker
               and "freecash.com" not in rc_text)
    out.append(_result(
        "R2", "R2.4", "no provider host is hardcoded; the unresolved provider contract keeps its literal",
        host_ok and guard["ok"],
        "allowlists=%s | hosts=%s hardcoded_non_loopback=%s PROVIDER_ENDPOINT_UNKNOWN_present=%s"
        % (guard["detail"], sorted(hosts), hard_hosts, provider_marker)))

    # R2.5 -- only the single transport module may name a socket library.
    violations = []
    transport_seen = False
    for path in files:
        try:
            text = path.read_text(encoding="utf-8")
        except OSError:
            continue
        if "http.client" in text:
            transport_seen = True
        if path.name in SOCKET_ALLOWED_MODULES:
            continue
        for token in ("import socket", "import requests", "import httpx",
                      "http.client", "urllib.request", "socket.socket("):
            if token in text:
                violations.append("%s: %s" % (path.name, token))
    out.append(_result(
        "R2", "R2.5", "only the single transport module (readonly_client.py) may name a socket library",
        (not violations) and transport_seen,
        "violations=%s transport_present=%s" % (violations, transport_seen)))

    return out


# --------------------------------------------------------------------------- R3


def check_r3(runner: Runner):
    out = []
    root = runner.fresh_root()
    proc = runner.probe(PROBE_R3, root)
    obj = _json_line(proc.stdout)
    if obj is None:
        detail = "probe produced no result (rc=%s) stderr=%s" % (proc.returncode, _tail(proc.stderr))
        for aid, title in (("R3.1", "an earnings change notifies exactly once and a baseline notifies zero times"),
                           ("R3.2", "the same dedupe key is never delivered twice"),
                           ("R3.3", "a no-change day is log-only")):
            out.append(_result("R3", aid, title, False, detail))
        return out

    detail = str(obj.get("detail", ""))
    try:
        counts = json.loads(detail.split(" rc=")[0])
    except ValueError:
        counts = {}
    baseline = counts.get("INITIAL_BASELINE")
    earnings = counts.get("EARNINGS_CHANGED")
    nochange = counts.get("OK_NO_CHANGE")
    notifications = counts.get("notifications")

    out.append(_result(
        "R3", "R3.1", "an earnings change notifies exactly once; the baseline day notifies zero times",
        baseline == 1 and earnings == 1 and notifications == 1,
        "INITIAL_BASELINE=%s EARNINGS_CHANGED=%s notifications=%s (%s)"
        % (baseline, earnings, notifications, detail)))

    dedupe = _probe_result(runner, "R3", "R3.2", "the same dedupe key is never delivered twice", PROBE_R3_DEDUPE)
    out.append(dedupe)

    out.append(_result(
        "R3", "R3.3", "a no-change day is OK_NO_CHANGE and log-only (zero notifications)",
        nochange == 1 and notifications == 1,
        "OK_NO_CHANGE=%s notifications=%s (%s)" % (nochange, notifications, detail)))

    return out


# --------------------------------------------------------------------------- R4


def check_r4(runner: Runner, target: Path):
    out = []

    out.append(_probe_result(
        runner, "R4", "R4.1",
        "a detected change enqueues exactly one frozen PENDING item (no expiry, NOT_EXECUTED)",
        PROBE_R4_ENQUEUE))

    out.append(_probe_result(
        runner, "R4", "R4.2",
        "a machine identity cannot sign a decision and a decision never arms the item",
        PROBE_R4_DECIDE))

    executed = re.compile(r"(?<!NOT_)EXECUTED")
    approved = re.compile(r"==\s*[\"']APPROVED[\"']")
    hits = []
    for path in _module_files(target):
        try:
            text = path.read_text(encoding="utf-8")
        except OSError:
            continue
        for lineno, line in enumerate(text.splitlines(), start=1):
            if executed.search(line):
                hits.append("%s:%d bare EXECUTED token: %s" % (path.name, lineno, line.strip()[:90]))
            if approved.search(line):
                hits.append("%s:%d reads an APPROVED status: %s" % (path.name, lineno, line.strip()[:90]))
            if 'execution_state"] =' in line and "EXECUTION_STATE_NOT_EXECUTED" not in line:
                hits.append("%s:%d assigns a non-frozen execution_state: %s" % (path.name, lineno, line.strip()[:90]))
    try:
        aq_text = (target / "approval_queue.py").read_text(encoding="utf-8")
    except OSError:
        aq_text = ""
    positive_control = "NOT_EXECUTED" in aq_text
    out.append(_result(
        "R4", "R4.3", "no module carries an executable state token or treats APPROVED as a trigger",
        (not hits) and positive_control,
        "hits=%s NOT_EXECUTED_present=%s" % (hits, positive_control)))

    return out


# --------------------------------------------------------------------------- driver


def run(target: Path, workdir: Path) -> tuple:
    missing = [name for name in REQUIRED_MODULES if not (target / name).is_file()]
    if not target.is_dir() or missing:
        return 2, {"error": "target tree incomplete", "target": str(target), "missing": missing}

    runner = Runner(target, workdir)
    results = []
    results += check_r1(runner)
    results += check_r2(runner, target)
    results += check_r3(runner)
    results += check_r4(runner, target)
    return 0, {"target": str(target), "results": results}


def report(payload: dict, stream=None, as_json=False) -> int:
    out = stream or sys.stdout
    results = payload["results"]
    if as_json:
        rules = {}
        for r in results:
            rules.setdefault(r["rule"], {"pass": 0, "fail": 0})["pass" if r["ok"] else "fail"] += 1
        failed_rules = sorted({r["rule"] for r in results if not r["ok"]})
        print(json.dumps({
            "target": payload["target"],
            "rules": {k: v for k, v in sorted(rules.items())},
            "failed_rules": failed_rules,
            "assertions_passed": sum(1 for r in results if r["ok"]),
            "assertions_total": len(results),
            "exit": 1 if failed_rules else 0,
        }))
        return 1 if failed_rules else 0

    print("[verify_freecash_rules] target=%s" % payload["target"])
    print("[verify_freecash_rules] checker=%s  interpreter=%s" % (VERSION, sys.executable))
    print("-" * 78)
    for rule in ("R1", "R2", "R3", "R4"):
        block = [r for r in results if r["rule"] == rule]
        failed = [r for r in block if not r["ok"]]
        print("%s  %s  [%s]" % (rule, RULE_TITLES[rule], "FAIL" if failed else "PASS"))
        for r in block:
            print("    [%s] %s  %s" % (r["id"], "PASS" if r["ok"] else "FAIL", r["title"]))
            print("           %s" % r["detail"])
    print("-" * 78)
    failed_rules = sorted({r["rule"] for r in results if not r["ok"]})
    passed = sum(1 for r in results if r["ok"])
    print("--- per-rule summary ---")
    for rule in ("R1", "R2", "R3", "R4"):
        block = [r for r in results if r["rule"] == rule]
        ok = sum(1 for r in block if r["ok"])
        print("%s  %-4s  (%d/%d assertions)" % (rule, "PASS" if ok == len(block) else "FAIL", ok, len(block)))
    if failed_rules:
        print("[verify_freecash_rules] RESULT FAIL target=%s failed_rules=%s assertions=%d/%d"
              % (payload["target"], ",".join(failed_rules), passed, len(results)))
        print("[verify_freecash_rules] FAIL - a rule violation exists in the inspected tree.")
        return 1
    print("[verify_freecash_rules] RESULT PASS target=%s rules=4/4 assertions=%d/%d"
          % (payload["target"], passed, len(results)))
    print("[verify_freecash_rules] PASS - every rule assertion held on the inspected tree.")
    return 0


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(
        prog="verify_freecash_rules.py",
        description="Falsifiable verifier for the Free Cash read-only monitor (R1-R4). "
                    "Point it at the routine tree; it runs the tree in isolation and checks 14 assertions.",
    )
    parser.add_argument("target", help="routine tree root (contains run_daily_check.py, gate.py, ...)")
    parser.add_argument("--workdir", default=None, help="directory for throwaway data roots (default: system temp)")
    parser.add_argument("--keep", action="store_true", help="keep the throwaway directories")
    parser.add_argument("--json", action="store_true", dest="as_json", help="emit a machine-readable summary")
    args = parser.parse_args(sys.argv[1:] if argv is None else argv)

    target = Path(args.target).resolve()
    workdir = Path(args.workdir).resolve() if args.workdir else Path(tempfile.mkdtemp(prefix="fcverify-work-"))
    created_workdir = args.workdir is None
    workdir.mkdir(parents=True, exist_ok=True)
    try:
        code, payload = run(target, workdir)
        if code == 2:
            print("[verify_freecash_rules] ERROR target tree incomplete: %s" % payload["target"], file=sys.stderr)
            print("[verify_freecash_rules] missing=%s" % payload["missing"], file=sys.stderr)
            print("[verify_freecash_rules] FAIL - absence of evidence is not evidence of a read-only routine.",
                  file=sys.stderr)
            return 2
        return report(payload, as_json=args.as_json)
    finally:
        if created_workdir and not args.keep:
            shutil.rmtree(workdir, ignore_errors=True)
        elif args.keep:
            print("[verify_freecash_rules] workdir kept: %s" % workdir)


if __name__ == "__main__":
    sys.exit(main())
