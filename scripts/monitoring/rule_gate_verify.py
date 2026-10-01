#!/usr/bin/env python3
"""rule_gate_verify.py -- EXECUTABLE rule-gate verifier for the Free Cash daily
monitoring routine.

It answers one question, per implementation file:

    Does this code structurally enforce the 4 operational rules?

        R1  the status check happens at most ONCE per calendar day
            (atomic same-day guard, no double run, missed day detectable)
        R2  NO automated earning action
            (no POST/PUT/PATCH/DELETE, no claim/withdraw/payout/redeem/
             survey/offer execution)
        R3  the operator is notified when earnings or account status CHANGES
            (prior-state load BEFORE the snapshot write; one change = one notify)
        R4  human approval required before ANY external action
            (the routine may enqueue a request; it contains no execution path;
             a timeout must never convert pending -> executed)

Design rules of this verifier itself
------------------------------------
* FAIL-CLOSED.  If the target does not parse, every rule FAILs.  An
  implementation that cannot be executed cannot be verified, and "not
  verified" must never be reported as "passed".
* Every PASS and every FAIL carries evidence: a file:line, a quoted token, or
  an observed runtime behaviour.  A verdict with no evidence is not emitted.
* SAFETY.  Runtime probing (`--run`) happens only in a throwaway temp copy with
  cwd = temp dir.  It is REFUSED (and the refusal is reported as evidence) when
  the implementation contains (a) a write-call shape, or (b) a hardcoded
  absolute path pointing back into the repo, because running it would either
  touch a remote service or write outside the sandbox.

Usage
-----
    python scripts/monitoring/rule_gate_verify.py TARGET [--run] [--json]

Exit codes
----------
    0  every rule PASS (in the modes that were run)
    1  at least one rule FAIL
    2  verifier could not evaluate the target (missing file / unknown type)
"""

from __future__ import annotations

import argparse
import ast
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass, field, asdict
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]

RULE_TEXT = {
    "R1": "status check at most ONCE per calendar day (atomic same-day guard, no double run, missed day detectable)",
    "R2": "NO automated earning action (no POST/PUT/PATCH/DELETE; no claim/withdraw/payout/redeem/survey/offer execution)",
    "R3": "operator notified when earnings/account status CHANGES (prior-state load BEFORE snapshot write; dedupe = one change = one notification)",
    "R4": "human approval before ANY external action (may enqueue; no execution path; timeout never converts pending -> executed)",
}

# ---------------------------------------------------------------------------
# token banks
# ---------------------------------------------------------------------------

# (label, compiled) -- mirrors docs/free-cash-monitor-routine/verify-readonly.sh §3.3
FORBIDDEN_TOKENS = [
    ("http-verb", re.compile(r"\b(POST|PUT|PATCH|DELETE)\b")),
    ("write-call-shape", re.compile(
        r"\.post\(|\.put\(|\.patch\(|\.delete\(|"
        r"requests\.(post|put|patch|delete)|axios\.(post|put|patch|delete)|"
        r"urlopen\(|http\.client|socket\.socket\(")),
    ("earning-verb", re.compile(
        r"\b(claim|withdraw|withdrawal|cashout|cash_out|redeem|payout|pay_out|"
        r"transfer|wager|bet|spin|deposit|purchase|checkout)\b", re.I)),
    ("earning-action", re.compile(
        r"(submit_offer|complete_survey|complete_task|start_task|accept_offer|"
        r"claim_reward|redeem_reward|request_payout)", re.I)),
    ("write-endpoint-path", re.compile(
        r"/(claim|withdraw|withdrawal|cashout|redeem|payout|transfer|deposit|checkout)\b|"
        r"/offers/[^/]+/claim|/surveys/[^/]+/complete|/tasks/[^/]+/complete|/rewards/claim",
        re.I)),
    ("account-mutation", re.compile(
        r"(update_balance|set_balance|credit_account|debit_account)", re.I)),
]

# decisive: an actual outbound write
NET_WRITE_CALL = re.compile(
    r"requests\.(post|put|patch|delete)\s*\(|"
    r"axios\.(post|put|patch|delete)\s*\(|"
    r"\.(post|put|patch|delete)\s*\(|"
    r"method\s*[:=]\s*['\"](POST|PUT|PATCH|DELETE)|"
    r"fetch\s*\([^)]*method\s*:\s*['\"](POST|PUT|PATCH|DELETE)", re.I)

NET_READ_CALL = re.compile(r"requests\.get\s*\(|urlopen\s*\(|https\.request|fetch\s*\(|\bGET\b")

ALLOWLIST_MARKERS = re.compile(
    r"ALLOWED_METHODS|allowed_methods|ALLOWED_PATHS|allowed_paths|"
    r"ForbiddenWriteError|ForbiddenWrite|deny[-_]by[-_]default", re.I)

ATOMIC_LOCK = re.compile(
    r"O_EXCL|os\.O_EXCL|"
    r"open\([^)]*,\s*['\"](x|xb|x\+|wx|wx\+|ax)['\"]|"          # exclusive create mode
    r"fs\.openSync\([^)]*,\s*['\"]wx?\+?['\"]|"                  # node exclusive create
    r"openSync\([^)]*,\s*['\"]wx|"
    r"\.mkdir\([^)]*exist_ok\s*=\s*False|mkdirSync\([^)]*\)|"    # atomic dir create == mutual exclusion
    r"os\.link\(|linkSync\(")

NON_ATOMIC_GUARD = re.compile(
    r"exists\s*\(|existsSync\s*\(|\.is_file\(\)|\.exists\(\)")

CALENDAR_DAY = re.compile(
    r"%Y-%m-%d|toDateString|date\(\)\.isoformat|\.strftime\([^)]*%Y-%m-%d|"
    r"toISOString\(\)\.(slice|substring)\(0,\s*10\)|strftime\(\"%Y-%m-%d\"")

ROLLING_WINDOW = re.compile(r"86400|24\s*\*\s*60\s*\*\s*60|timedelta\(\s*days\s*=\s*1|24h|last\s*24")

FAIL_OPEN = re.compile(r"return\s+True|return\s+1\b|\breturn\s+true\b|return\s+None")

MISSED_DAY = re.compile(
    r"last_success_day|missed_day|MISSED_DAY|consecutive_missed|reconcile|watchdog",
    re.I)

PRIOR_LOAD = re.compile(
    r"\b(load_snapshot|read_snapshot|load_prior\w*|prior_snapshot|load_previous\w*|"
    r"load_state|read_state|load_last\w*|read_last\w*|load_yesterday\w*|"
    r"read_previous\w*|get_prior\w*|load_baseline|read_baseline)\s*\(")

SNAPSHOT_WRITE = re.compile(
    r"\b(save_snapshot|write_snapshot|persist_snapshot|dump_snapshot|store_snapshot|"
    r"save_state|write_state|save_today|write_json|save_json|write_text|"
    r"writeFileSync|write_jsonl|save_snapshot_file)\s*\(")

DEDUPE = re.compile(r"dedupe|notified[_-]?keys|seen[_-]?keys|alert_key|first_notified_at", re.I)

RELATIVE_THRESHOLD = re.compile(
    r"relative_change|rate_shift|threshold|NOTIFY_ON_|>\s*0\.0[0-9]|>\s*0\.1\b")

NOTIFY_DISPATCH = re.compile(
    r"smtplib|sendmail|toast|NotifyIcon|webhook|notify_manager|dispatch\(|"
    r"alerts\.jsonl|append.*alert|win10toast|plyer|notification_service")

NOTIFY_STUB_ONLY = re.compile(r"^\s*print\(")

EXECUTION_PATH = re.compile(
    r"\b(run_action|execute_action|execute_with_approval|perform_action|do_action|"
    r"_api_simulate|simulate_action|execute_plan|apply_action|carry_out)\s*\(")

AUTO_APPROVE_RNG = re.compile(r"random\.(choice|random|randint|uniform|sample)\s*\(")

HARDCODED_CONSENT = re.compile(
    r"success\s*=\s*True|approved\s*=\s*True|"
    r"['\"]approved['\"]\s*:\s*True|user_consent\s*=\s*\{[^}]*True|"
    r"return\s+True,\s*(success|True)")

APPROVAL_DEF = re.compile(
    r"^\s*def\s+(\w*(approve|approval|consent|decide|authori[sz]e)\w*)\s*\(")

TIMEOUT_EXEC = re.compile(
    r"expires_at|expiry|ttl|timeout", re.I)

ABSOLUTE_PATH = re.compile(r"['\"]([A-Za-z]:[\\/][^'\"]{2,})['\"]")

SKIP_TOKEN = re.compile(r"skip|already|duplicate|exists", re.I)


# ---------------------------------------------------------------------------
# model
# ---------------------------------------------------------------------------

@dataclass
class Finding:
    rule: str
    ok: bool
    check: str
    evidence: str
    line: int | None = None

    def fmt(self) -> str:
        tag = "PASS" if self.ok else "FAIL"
        loc = f"  [line {self.line}]" if self.line else ""
        return f"  {tag}  {self.check}{loc}\n        evidence: {self.evidence}"


@dataclass
class Report:
    target: str
    target_exists: bool
    kind: str
    parse_ok: bool
    parse_detail: str
    findings: list[Finding] = field(default_factory=list)
    runtime: list[str] = field(default_factory=list)
    forbidden_hits: list[str] = field(default_factory=list)

    def add(self, rule, ok, check, evidence, line=None):
        self.findings.append(Finding(rule, ok, check, evidence, line))

    def rule_ok(self, rule) -> bool:
        fs = [f for f in self.findings if f.rule == rule]
        if not fs:
            return False                      # fail-closed: no evidence => not verified
        return all(f.ok for f in fs)


# ---------------------------------------------------------------------------
# parse gate
# ---------------------------------------------------------------------------

def parse_gate(target: Path, src: str) -> tuple[bool, str, str]:
    ext = target.suffix.lower()
    if ext == ".py":
        try:
            ast.parse(src)
            return True, "python ast.parse OK", "python"
        except SyntaxError as e:
            return False, f"SyntaxError: {e.msg} (line {e.lineno})", "python"
    if ext in (".mjs", ".js", ".cjs"):
        try:
            r = subprocess.run(["node", "--check", str(target)],
                               capture_output=True, text=True, timeout=60)
        except FileNotFoundError:
            return False, "node not available to check the module", "js"
        if r.returncode == 0:
            return True, "node --check OK", "js"
        err = (r.stderr or "").strip().splitlines()
        head = next((l for l in err if "Error" in l), err[0] if err else "unknown")
        ln = ""
        for l in err:
            m = re.search(r"line\s+(\d+)", l)
            if m:
                ln = f" at line {m.group(1)}"
                break
        return False, f"node --check FAILED: {head}{ln}", "js"
    return True, f"unknown extension '{ext}' -- no interpreter parse gate applied", "unknown"


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def scan_tokens(lines: list[str]) -> list[tuple[int, str, str, bool]]:
    """-> [(line_no, label, text, exempt)]; a line is exempt only with an explicit
    `readonly-exempt:` marker, per ROUTINE-DESIGN §3.3."""
    out = []
    for i, raw in enumerate(lines, start=1):
        for label, pat in FORBIDDEN_TOKENS:
            if pat.search(raw):
                out.append((i, label, raw.strip()[:160], "readonly-exempt:" in raw))
                break
    return out


def code_view(src: str, lines: list[str], ext: str) -> list[str]:
    """A matching view of the source in which docstrings and trailing comments are
    blanked, so that PROSE can never be the evidence for a PASS.

    The forbidden-token scan deliberately still reads the raw lines: ROUTINE-DESIGN
    §3.3 requires comment/docstring prose to be scanned too ("a fail-closed scanner
    that skips comments will eventually be defeated by generated code").
    """
    view = list(lines)

    if ext == ".py":
        try:
            tree = ast.parse(src)
        except SyntaxError:
            tree = None
        if tree is not None:
            for node in ast.walk(tree):
                if not isinstance(node, ast.Expr):
                    continue
                v = node.value
                if isinstance(v, ast.Constant) and not isinstance(v.value, str):
                    continue
                if not isinstance(v, (ast.Constant, ast.JoinedStr)):
                    continue
                for k in range(node.lineno, getattr(node, "end_lineno", node.lineno) + 1):
                    if 1 <= k <= len(view):
                        view[k - 1] = ""

    out = []
    for raw in view:
        if not raw:
            out.append("")
            continue
        cut = None
        quote = None
        for i, ch in enumerate(raw):
            if quote:
                if ch == quote and raw[i - 1] != "\\":
                    quote = None
            elif ch in "\"'":
                quote = ch
            elif ch == "#":
                cut = i
                break
        out.append(raw[:cut] if cut is not None else raw)

    # JS/TS: blank /* block */ and // line comments (but never the '//' inside '://')
    if ext != ".py":
        stripped = []
        in_block = False
        for line in out:
            res = []
            i = 0
            while i < len(line):
                if in_block:
                    j = line.find("*/", i)
                    if j == -1:
                        i = len(line)
                        break
                    in_block = False
                    i = j + 2
                    continue
                if line.startswith("/*", i):
                    in_block = True
                    i += 2
                    continue
                if line.startswith("//", i) and not (i > 0 and line[i - 1] == ":"):
                    break
                res.append(line[i])
                i += 1
            stripped.append("".join(res))
        out = stripped
    return out


def first_line(lines: list[str], pat: re.Pattern) -> int | None:
    for i, raw in enumerate(lines, start=1):
        if pat.search(raw):
            return i
    return None


def enclosing_functions(src: str) -> list[tuple[str, int, int]]:
    """[(name, start_line, end_line)] for python; naive brace-free fallback for js."""
    spans = []
    try:
        tree = ast.parse(src)
    except SyntaxError:
        return spans
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            end = getattr(node, "end_lineno", node.lineno)
            spans.append((node.name, node.lineno, end))
    return spans


def func_of(spans, line: int) -> str:
    best = None
    for name, a, b in spans:
        if a <= line <= b:
            if best is None or (b - a) < best[1]:
                best = (name, b - a)
    return best[0] if best else "<module>"


def js_function_spans(lines: list[str]) -> list[tuple[str, int, int]]:
    spans = []
    open_at = None
    name = "<module>"
    depth = 0
    pat = re.compile(r"(?:function\s+(\w+)|(?:async\s+)?(\w+)\s*\([^)]*\)\s*(?::\s*[\w<>\[\].|,\s]+)?\s*\{)")
    for i, raw in enumerate(lines, start=1):
        m = pat.search(raw)
        if m and depth == 0:
            name = m.group(1) or m.group(2) or "<fn>"
            open_at = i
        depth += raw.count("{") - raw.count("}")
        if open_at and depth <= 0:
            spans.append((name, open_at, i))
            open_at, name = None, "<module>"
            depth = 0
    return spans


# ---------------------------------------------------------------------------
# R1
# ---------------------------------------------------------------------------

def check_r1(rep: Report, raw: list[str], code: list[str], spans) -> None:
    def q(i):
        return raw[i - 1].strip()[:150] if 1 <= i <= len(raw) else ""

    # --- 1. atomic same-day guard -----------------------------------------
    lock_line = first_line(code, ATOMIC_LOCK)
    guard_line = first_line(code, NON_ATOMIC_GUARD)
    if lock_line:
        rep.add("R1", True, "atomic exclusive-create day guard present",
                f"line {lock_line}: {q(lock_line)}", lock_line)
    else:
        ev = "no O_CREAT|O_EXCL / 'x'-mode create / atomic mkdir anywhere in the file"
        if guard_line:
            ev += (f"; the only same-day barrier is a read-then-write existence "
                   f"check at line {guard_line}: {q(guard_line)} "
                   f"-> TOCTOU race, two concurrent runs can both pass it")
        rep.add("R1", False, "atomic same-day guard (double-run barrier)", ev, guard_line)

    # --- 2. calendar-day key vs rolling 24h window ------------------------
    day_line = first_line(code, CALENDAR_DAY)
    roll_line = first_line(code, ROLLING_WINDOW)
    if day_line:
        rep.add("R1", True, "day key is a calendar day",
                f"line {day_line}: {q(day_line)}", day_line)
    else:
        rep.add("R1", False, "day key is a calendar day",
                "no calendar-day key derivation found (no %Y-%m-%d / toDateString / "
                "date().isoformat)")
    if roll_line:
        rep.add("R1", False, "no rolling 24h window used as the daily gate",
                f"line {roll_line}: {q(roll_line)} -- a rolling window permits two runs "
                f"inside one calendar day (00:30 then 23:30)", roll_line)
    else:
        rep.add("R1", True, "no rolling 24h window used as the daily gate",
                "no 86400/24h/timedelta(days=1) daily-gate arithmetic found")

    # --- 3. duplicate path must be side-effect free -----------------------
    dup_guard = re.compile(r"allowed\s*\(|should_run|can_run|already_?\w*|ran_today",
                           re.I)
    dup_bad = None
    for i, line in enumerate(code, start=1):
        if not dup_guard.search(line):
            continue
        stop = None
        for j in range(i + 1, min(len(code), i + 25) + 1):
            if re.search(r"(^|\s)return\b", code[j - 1]):
                stop = j
                break
        span = range(i + 1, (stop or min(len(code), i + 25)) + 1)
        for j in span:
            w = code[j - 1]
            if SNAPSHOT_WRITE.search(w) or re.search(r"writeFileSync|write_text|"
                                                     r"open\([^)]*['\"]w", w):
                dup_bad = (i, j, q(j))
                break
        if dup_bad:
            break
    if dup_bad:
        rep.add("R1", False, "duplicate-run path is side-effect free",
                f"the skip branch entered at line {dup_bad[0]} still WRITES state at "
                f"line {dup_bad[1]}: {dup_bad[2]}", dup_bad[1])
    else:
        rep.add("R1", True, "duplicate-run path is side-effect free",
                "no state write found inside the already-ran early-exit branch")

    # --- 4. missed-day detection ------------------------------------------
    md = first_line(code, MISSED_DAY)
    if md:
        rep.add("R1", True, "missed day is detectable",
                f"line {md}: {q(md)}", md)
    else:
        rep.add("R1", False, "missed day is detectable",
                "no last_success_day / MISSED_DAY / reconcile / watchdog token in code: a "
                "day with no run is indistinguishable from a day with nothing to report")

    # --- 5. fail-open guard ------------------------------------------------
    fo = None
    for name, a, b in spans:
        if not re.search(r"allow|should_run|can_run|permit|is_run|gate|may_run|"
                         r"already|ran", name, re.I):
            continue
        body = code[a - 1:b]
        in_except = False
        skip_semantics = bool(re.search(r"is_run|already|ran", name, re.I))
        for k, line in enumerate(body, start=a):
            s = line.strip()
            if s.startswith(("except", "} catch", "catch")):
                in_except = True
            if in_except and re.search(r"return\s+(True|1|true)\b|return\s+None", line):
                fo = (k, q(k), name, skip_semantics)
                break
        if fo:
            break
    if fo:
        if fo[3]:
            ev = (f"line {fo[0]} inside {fo[2]}(): {fo[1]} -- an unreadable/unparseable "
                  f"state file makes the routine believe the day is already consumed, so "
                  f"the monitor silently stops and never self-heals")
        else:
            ev = (f"line {fo[0]} inside {fo[2]}(): {fo[1]} -- a read/parse error grants "
                  f"permission instead of denying it (double run)")
        rep.add("R1", False, "guard fails CLOSED on error", ev, fo[0])
    else:
        rep.add("R1", True, "guard fails CLOSED on error",
                "no except/catch branch was found returning a permissive value from a "
                "*ran()*/*allowed()* style guard")


# ---------------------------------------------------------------------------
# R2
# ---------------------------------------------------------------------------

def check_r2(rep: Report, src: str, raw: list[str], code: list[str]) -> None:
    def q(i):
        return raw[i - 1].strip()[:150] if 1 <= i <= len(raw) else ""

    hits = scan_tokens(raw)
    rep.forbidden_hits = [f"{ln}: [{lab}] {txt}" for ln, lab, txt, ex in hits]
    exempt = [(ln, lab, txt) for ln, lab, txt, ex in hits if ex]

    decisive = [(ln, lab, txt) for ln, lab, txt, ex in hits
                if not ex and lab in ("write-call-shape", "write-endpoint-path",
                                      "account-mutation", "earning-action")]
    if decisive:
        ln, lab, txt = decisive[0]
        rep.add("R2", False, "no write/earning call shape or endpoint path",
                f"line {ln} [{lab}]: {txt}"
                + (f" (+{len(decisive)-1} more)" if len(decisive) > 1 else ""), ln)
    else:
        rep.add("R2", True, "no write/earning call shape or endpoint path",
                f"0 unexempted decisive hits in {len(raw)} lines "
                f"({len(exempt)} exempted by 'readonly-exempt:', "
                f"{len([h for h in hits if h[1]=='earning-verb' and not h[3]])} prose-only "
                f"'earning-verb' hits in the known false-positive class)")

    # HTTP method actually used
    wl = first_line(raw, NET_WRITE_CALL)
    if wl:
        rep.add("R2", False, "no non-GET/HEAD HTTP method is used",
                f"line {wl}: {q(wl)}", wl)
    else:
        rep.add("R2", True, "no non-GET/HEAD HTTP method is used",
                "no POST/PUT/PATCH/DELETE call or method literal found")

    # deny-by-default allowlist (the structural barrier)
    al = first_line(code, ALLOWLIST_MARKERS)
    if al:
        rep.add("R2", True, "deny-by-default allowlist exists (structural barrier)",
                f"line {al}: {q(al)}", al)
    else:
        rep.add("R2", False, "deny-by-default allowlist exists (structural barrier)",
                "no ALLOWED_METHODS/ALLOWED_PATHS/ForbiddenWriteError: read-only-ness is "
                "a convention here, not an enforced denial, so one added line can become a "
                "write with no barrier to trip")

    # invented remote endpoint
    inv = None
    for i, line in enumerate(code, start=1):
        m = re.search(r"https?://([A-Za-z0-9._-]+)", line)
        if not m:
            continue
        host = m.group(1).lower()
        if host in ("localhost", "127.0.0.1", "::1"):
            continue
        if "PROVIDER_ENDPOINT_UNKNOWN" in line:
            continue
        inv = (i, q(i), host)
        break
    if inv:
        rep.add("R2", False, "no invented/unresolved provider endpoint",
                f"line {inv[0]}: {inv[1]} -- host '{inv[2]}' is not grounded in a "
                f"verified provider contract (ROUTINE-DESIGN §3.1: W3/W4 are "
                f"PROVIDER_ENDPOINT_UNKNOWN until the research phase resolves them)",
                inv[0])
    else:
        rep.add("R2", True, "no invented/unresolved provider endpoint",
                "every URL literal is localhost/127.0.0.1 or explicitly marked "
                "PROVIDER_ENDPOINT_UNKNOWN")

    # execution path = earning action by construction
    el = first_line(code, EXECUTION_PATH)
    if el:
        rep.add("R2", False, "no earning-action execution path in the monitor",
                f"line {el}: {q(el)} -- the routine contains a callable that performs an "
                f"action", el)
    else:
        rep.add("R2", True, "no earning-action execution path in the monitor",
                "no run_action/execute_*/perform_action/simulate_action call site found")


# ---------------------------------------------------------------------------
# R3
# ---------------------------------------------------------------------------

def check_r3(rep: Report, raw: list[str], code: list[str], spans) -> None:
    def q(i):
        return raw[i - 1].strip()[:120] if 1 <= i <= len(raw) else ""

    writes = [(i, q(i)) for i, l in enumerate(code, 1) if SNAPSHOT_WRITE.search(l)]
    loads = [(i, q(i)) for i, l in enumerate(code, 1) if PRIOR_LOAD.search(l)]

    if not loads:
        rep.add("R3", False, "prior state is loaded BEFORE the new snapshot is written",
                "no prior-state load call found at all "
                f"(snapshot writes present at lines: {[w[0] for w in writes]}) -- "
                "so no change can ever be compared")
    elif not writes:
        rep.add("R3", False, "prior state is loaded BEFORE the new snapshot is written",
                f"prior-state loads at {[l[0] for l in loads]} but no snapshot write found: "
                "the next day has nothing to compare against")
    else:
        # only compare writes/loads that live in the SAME function: a save() in one
        # helper and a load() in another are not an ordering statement about one flow
        pairs = []
        for wl, wt in writes:
            for ll, lt in loads:
                d = abs(wl - ll)
                if d == 0 or d > 60:
                    continue
                if func_of(spans, wl) != func_of(spans, ll):
                    continue
                pairs.append((d, wl, wt, ll, lt))
        bad = sorted([p for p in pairs if p[1] < p[3]], key=lambda p: p[0])
        good = sorted([p for p in pairs if p[1] > p[3]], key=lambda p: p[0])
        if bad:
            _, wl, wt, ll, lt = bad[0]
            rep.add("R3", False, "prior state is loaded BEFORE the new snapshot is written",
                    f"in {func_of(spans, wl)}(): WRITE at line {wl} ({wt}) precedes "
                    f"PRIOR-STATE LOAD at line {ll} ({lt}) [delta={ll-wl} lines]: the new "
                    f"snapshot overwrites the file the comparison then reads, so "
                    f"old[:=]new and the change can never be reported", wl)
        elif good:
            _, wl, wt, ll, lt = good[0]
            rep.add("R3", True, "prior state is loaded BEFORE the new snapshot is written",
                    f"in {func_of(spans, wl)}(): LOAD at line {ll} ({lt}) precedes WRITE at "
                    f"line {wl} ({wt})", ll)
        else:
            rep.add("R3", False, "prior state is loaded BEFORE the new snapshot is written",
                    f"a write exists ({writes[0][0]}) and a load exists ({loads[0][0]}) but "
                    f"they never co-occur in one function within 60 lines -- the ordering "
                    f"that R3 depends on is not verifiable")

    # dedupe
    d = first_line(code, DEDUPE)
    if d:
        rep.add("R3", True, "exactly-one-notification dedupe key exists",
                f"line {d}: {q(d)}", d)
    else:
        rep.add("R3", False, "exactly-one-notification dedupe key exists",
                "no dedupe/notified-keys/seen-keys token in code: the same change "
                "re-notifies, and a same-day re-entry has nothing to suppress it")

    # thresholds that swallow exact changes
    t = first_line(code, RELATIVE_THRESHOLD)
    money_ctx = False
    if t:
        for i in range(max(1, t - 6), min(len(code), t + 6)):
            if re.search(r"balance|earnings|cents|amount", code[i - 1], re.I):
                money_ctx = True
                break
    if t and money_ctx:
        rep.add("R3", False, "change comparison is exact (no threshold can swallow it)",
                f"line {t}: {q(t)} -- a relative threshold on a money field hides small "
                f"real movements, which is precisely the change the operator asked to be "
                f"told about (ROUTINE-DESIGN §4.2)", t)
    else:
        rep.add("R3", True, "change comparison is exact (no threshold can swallow it)",
                "no relative/percentage threshold found next to a balance/earnings field")

    # real dispatch vs print stub
    disp = first_line(code, NOTIFY_DISPATCH)
    prints = [i for i, l in enumerate(code, 1) if NOTIFY_STUB_ONLY.match(l)]
    if disp:
        rep.add("R3", True, "notification is a delivery path, not a print stub",
                f"line {disp}: {q(disp)}", disp)
    else:
        rep.add("R3", False, "notification is a delivery path, not a print stub",
                f"no smtplib/toast/webhook/notify_manager/dispatch/alerts.jsonl write found; "
                f"the only outputs are {len(prints)} print() call(s) "
                f"(first at line {prints[0] if prints else 'n/a'}) -- stdout of a scheduled "
                f"task is not a notification", prints[0] if prints else None)


# ---------------------------------------------------------------------------
# R4
# ---------------------------------------------------------------------------

def check_r4(rep: Report, raw: list[str], code: list[str], spans) -> None:
    def q(i):
        return raw[i - 1].strip()[:150] if 1 <= i <= len(raw) else ""

    # enqueue-only capability
    enq = first_line(code, re.compile(r"pending\.json|approval_queue|enqueue|approvals/|"
                                      r"[\"']PENDING[\"']|status\s*[:=]\s*[\"']PENDING"))
    if enq:
        rep.add("R4", True, "the routine may enqueue a request for a human",
                f"line {enq}: {q(enq)}", enq)
    else:
        rep.add("R4", False, "the routine may enqueue a request for a human",
                "no approval queue / PENDING item is produced in code: a detected change "
                "has no route to a human decision")

    # RNG-fabricated consent
    r = first_line(code, AUTO_APPROVE_RNG)
    if r:
        rep.add("R4", False, "consent is not fabricated by RNG",
                f"line {r}: {q(r)} -- approval is sampled at random with no human in the "
                f"loop", r)
    else:
        rep.add("R4", True, "consent is not fabricated by RNG",
                "no random.choice/random.random in the approval path")

    # hardcoded consent / hardcoded success
    h = first_line(code, HARDCODED_CONSENT)
    if h:
        rep.add("R4", False, "consent is not hardcoded",
                f"line {h}: {q(h)}", h)
    else:
        rep.add("R4", True, "consent is not hardcoded",
                "no success=True / approved=True / {'approved': True} literal found")

    # execution path
    e = first_line(code, EXECUTION_PATH)
    if e:
        rep.add("R4", False, "the routine contains NO execution path",
                f"line {e}: {q(e)} -- a pending/approved item can be executed inside the "
                f"routine itself", e)
    else:
        rep.add("R4", True, "the routine contains NO execution path",
                "no action-executing call site found")

    # auto-execute of an APPROVED item
    ao = None
    for i, line in enumerate(code, start=1):
        if re.search(r"APPROVED|approved", line) and EXECUTION_PATH.search(line):
            ao = (i, q(i))
            break
    if ao is None:
        for i, line in enumerate(code, start=1):
            if not re.search(r"APPROVED", line, re.I):
                continue
            for j in range(i, min(len(code), i + 12) + 1):
                if EXECUTION_PATH.search(code[j - 1]):
                    ao = (j, q(j))
                    break
            if ao:
                break
    if ao:
        rep.add("R4", False, "an APPROVED item is not auto-executed",
                f"line {ao[0]}: {ao[1]} -- reads APPROVED status and then executes", ao[0])
    else:
        rep.add("R4", True, "an APPROVED item is not auto-executed",
                "nothing reads an APPROVED status and executes it")

    # timeout / expiry must not convert pending -> executed
    te = None
    AFFIRMATIVE_EXEC = re.compile(
        r"execute_action|execute_with|_execute\s*\(|\bexecute\s*\(|autoprocess|"
        r"auto_execute|proceed\b|APPROVED")
    for i, line in enumerate(code, start=1):
        if TIMEOUT_EXEC.search(line) and AFFIRMATIVE_EXEC.search(line):
            te = (i, q(i))
            break
    if te:
        rep.add("R4", False, "a timeout cannot convert pending -> executed",
                f"line {te[0]}: {te[1]}", te[0])
    else:
        rep.add("R4", True, "a timeout cannot convert pending -> executed",
                "no timeout/expiry branch that proceeds or executes")

    # approval gate defined but never called  (dead gate)
    dead = None
    for m_i, line in enumerate(code, start=1):
        m = APPROVAL_DEF.match(line)
        if not m:
            continue
        name = m.group(1)
        end = m_i
        for nm, a, b in spans:
            if nm == name and a == m_i:
                end = b
        calls = []
        for k, l2 in enumerate(code, start=1):
            if k == m_i or (m_i < k <= end):
                continue
            if re.search(rf"\b{re.escape(name)}\s*\(", l2):
                calls.append(k)
        if not calls:
            dead = (m_i, name)
            break
    if dead:
        rep.add("R4", False, "the approval gate is actually reachable",
                f"line {dead[0]} defines '{dead[1]}()' but nothing outside its own body "
                f"ever calls it -- the human-approval step is dead code", dead[0])
    elif not any(APPROVAL_DEF.match(l) for l in code):
        rep.add("R4", True, "the approval gate is actually reachable",
                "no approve/decide/consent function is defined in this file (there is no "
                "gate here to be unreachable) -- the queue/enqueue check above is the "
                "binding one")
    else:
        rep.add("R4", True, "the approval gate is actually reachable",
                "every approval/decide function has at least one call site")


# ---------------------------------------------------------------------------
# runtime probe
# ---------------------------------------------------------------------------

def runtime_probe(rep: Report, target: Path, src: str, lines: list[str],
                  enable: bool, indent: bool = True, concurrent: int = 5) -> None:
    def note(msg: str) -> None:
        rep.runtime.append(msg)

    if not enable:
        note("skipped (pass --run to enable; nothing was executed)")
        return

    if target.suffix.lower() != ".py":
        note(f"REFUSED: runtime probe only implemented for .py targets "
             f"(got '{target.suffix}')")
        return

    wl = first_line(lines, NET_WRITE_CALL)
    if wl:
        note(f"REFUSED by the verifier's own R2 guard: line {wl} contains a write-call "
             f"shape ({lines[wl-1].strip()[:110]}). Executing this file could send a write "
             f"request; withheld.")
        return

    bad_paths = []
    for i, raw in enumerate(lines, start=1):
        for m in ABSOLUTE_PATH.finditer(raw):
            p = Path(m.group(1).replace("\\", "/"))
            try:
                p.resolve().relative_to(REPO_ROOT)
            except Exception:
                continue
            bad_paths.append((i, m.group(1)))
    if bad_paths:
        note(f"REFUSED: hardcoded path back into the repo at line {bad_paths[0][0]} "
             f"({bad_paths[0][1]}) -- a temp-dir copy would still write outside the "
             f"sandbox, so it was not executed")
        return

    tmp = Path(tempfile.mkdtemp(prefix="rgv-run-"))
    work = tmp / "run"
    work.mkdir(parents=True, exist_ok=True)
    copy = work / target.name
    shutil.copy2(target, copy)

    def tree() -> dict:
        out = {}
        for p in sorted(work.rglob("*")):
            if p.is_file() and p != copy:
                out[str(p.relative_to(work))] = (p.stat().st_size,
                                                 round(p.stat().st_mtime, 3))
        return out

    def run_once(stdin_text: str = "") -> tuple[int, str, str]:
        try:
            r = subprocess.run([sys.executable, copy.name], cwd=work,
                               input=stdin_text, capture_output=True, text=True,
                               timeout=45)
            return r.returncode, r.stdout or "", r.stderr or ""
        except subprocess.TimeoutExpired:
            return 124, "", "TIMEOUT after 45s"
        except Exception as e:                                   # pragma: no cover
            return 125, "", f"{type(e).__name__}: {e}"

    before = tree()
    rc1, out1, err1 = run_once()
    after1 = tree()
    created = {k: v for k, v in after1.items() if k not in before}
    note(f"run#1 exit={rc1}  created={list(created) or 'NO ARTIFACT CREATED'}")
    tail = (out1.strip().splitlines() or [""])[-1][:160]
    note(f"run#1 last stdout line: {tail!r}")
    if err1.strip():
        note(f"run#1 stderr head: {err1.strip().splitlines()[0][:160]!r}")

    daykey = [k for k in created if re.search(r"\d{4}-\d{2}-\d{2}|\.lock|today|last_run|"
                                              r"state\.json|last-run", k)]
    if not daykey:
        rep.add("R1", False, "runtime: first run creates its day-key/lock artifact",
                f"run#1 exited {rc1} and created {list(created) or 'nothing'}: no day-key or "
                f"lock artifact, so nothing records that today was consumed. "
                f"Exiting 0 without a day-key artifact is NOT a pass.")
    else:
        rep.add("R1", True, "runtime: first run creates its day-key/lock artifact",
                f"run#1 exit={rc1}, created {daykey}")

    if rc1 != 0:
        rep.add("R1", False, "runtime: first run exits 0",
                f"run#1 exited {rc1}; stderr: {err1.strip()[:200] or '(none)'}")
    else:
        rep.add("R1", True, "runtime: first run exits 0", "run#1 exit=0")

    before2 = tree()
    rc2, out2, err2 = run_once()
    after2 = tree()
    added2 = {k: v for k, v in after2.items() if k not in before2}
    mutated2 = {k: (before2[k], after2[k]) for k in before2
                if k in after2 and before2[k] != after2[k]}
    # ROUTINE-DESIGN §2.1: a duplicate invocation MUST NOT read the network, write a
    # snapshot, touch pending.json, send a notification or modify last-run.json.  It
    # MAY append exactly one SKIP_DUPLICATE_DAY line to the append-only audit log.
    APPEND_ONLY = re.compile(r"\.jsonl$|\.log$|alerts", re.I)
    state_mut = {k: v for k, v in mutated2.items() if not APPEND_ONLY.search(k)}
    grew = {k: v for k, v in mutated2.items() if APPEND_ONLY.search(k)}
    skip_ok, skip_ev = True, []
    for k in grew:
        try:
            tl = (work / k).read_text(encoding="utf-8", errors="replace").strip().splitlines()
            tail = tl[-1] if tl else ""
        except Exception:
            tail = ""
        if SKIP_TOKEN.search(tail):
            skip_ev.append(f"appended a skip record to {k}: {tail[:100]!r}")
        else:
            skip_ok = False
            skip_ev.append(f"appended a NON-skip record to {k}: {tail[:140]!r}")
    note(f"run#2 exit={rc2}  created={list(added2) or 'nothing'}  "
         f"state-mutated={list(state_mut) or 'nothing'}  audit-appended={list(grew) or 'nothing'}")
    if added2 or state_mut or not skip_ok:
        rep.add("R1", False, "runtime: second same-day run has NO side effect",
                f"second same-day invocation created {list(added2)}, mutated state "
                f"{list(state_mut)}; audit-log findings: {skip_ev or 'none'} -- a same-day "
                f"re-entry is still doing work")
    else:
        rep.add("R1", True, "runtime: second same-day run has NO side effect",
                f"second same-day invocation (exit {rc2}) created no artifact and mutated "
                f"no state file"
                + (f"; {'; '.join(skip_ev)}" if skip_ev else " and wrote nothing"))

    # concurrency: N simultaneous first-runs must elect exactly one winner
    tmp_c = Path(tempfile.mkdtemp(prefix="rgv-conc-"))
    work_c = tmp_c / "run"
    work_c.mkdir(parents=True, exist_ok=True)
    copy2 = work_c / target.name
    shutil.copy2(target, copy2)
    procs = []
    for _ in range(concurrent):
        try:
            procs.append(subprocess.Popen([sys.executable, copy2.name], cwd=work_c,
                                          stdin=subprocess.DEVNULL,
                                          stdout=subprocess.PIPE,
                                          stderr=subprocess.PIPE, text=True))
        except Exception as e:                                    # pragma: no cover
            note(f"concurrency launch error: {e}")
    outs = []
    t0 = time.time()
    for p in procs:
        try:
            o, e = p.communicate(timeout=60)
            outs.append((p.returncode, o or "", e or ""))
        except subprocess.TimeoutExpired:
            p.kill()
            outs.append((124, "", "TIMEOUT"))
    elapsed = round(time.time() - t0, 2)
    winners = [o for o in outs if not SKIP_TOKEN.search(o[1])]
    note(f"concurrency: {len(procs)} simultaneous copies in {elapsed}s -> "
         f"{len(winners)} did NOT report skip/duplicate")
    for rc, o, e in outs[:concurrent]:
        note(f"    exit={rc} stdout_last={((o.strip().splitlines() or [''])[-1])[:110]!r}")
    if len(winners) > 1:
        rep.add("R1", False, "runtime: concurrent runs elect exactly one winner",
                f"{len(winners)} of {len(procs)} simultaneous same-day invocations ran "
                f"without reporting skip/duplicate -> the same-day barrier is not atomic")
    else:
        rep.add("R1", True, "runtime: concurrent runs elect exactly one winner",
                f"{len(winners)} of {len(procs)} simultaneous invocations took the day; "
                f"{concurrent - len(winners)} reported skip/duplicate")
    shutil.rmtree(tmp, ignore_errors=True)
    shutil.rmtree(tmp_c, ignore_errors=True)


# ---------------------------------------------------------------------------
# driver
# ---------------------------------------------------------------------------

def verify(target: Path, do_run: bool) -> Report:
    ext = target.suffix.lower()
    kind = {"py": "python"}.get(ext.lstrip("."), "js" if ext in (".mjs", ".js", ".cjs")
                               else "unknown")
    if not target.exists():
        return Report(str(target), False, kind, False,
                      f"target does not exist: absence of evidence is not evidence of a "
                      f"compliant routine")

    src = target.read_text(encoding="utf-8", errors="replace")
    lines = src.splitlines()
    ok, detail, kind = parse_gate(target, src)
    rep = Report(str(target.resolve()).replace("\\", "/"), True, kind, ok, detail)

    if not ok:
        for r in ("R1", "R2", "R3", "R4"):
            rep.add(r, False, "implementation parses / is executable",
                    f"FAIL-CLOSED: {detail}. Code that cannot run cannot enforce any rule, "
                    f"so every rule is unverified and reported as FAIL.")

    spans = enclosing_functions(src) if kind == "python" else js_function_spans(lines)

    if kind == "js" and re.search(r"require\s*\(", src):
        rep.add("R2", False, "module loads under the ESM runtime it declares",
                f"{target.suffix} uses require() (CommonJS) while declaring ESM: it cannot "
                f"load as written")
    if re.search(r":\s*(boolean|string|number|any)\b", src) and kind == "js":
        m = re.search(r":\s*(boolean|string|number|any)\b", src)
        ln = src[:m.start()].count("\n") + 1
        rep.add("R2", False, "no TypeScript annotations in a JavaScript file",
                f"line {ln}: TS type annotation in a {target.suffix} file", ln)

    code = code_view(src, lines, target.suffix.lower())

    check_r1(rep, lines, code, spans)
    check_r2(rep, src, lines, code)
    check_r3(rep, lines, code, spans)
    check_r4(rep, lines, code, spans)
    runtime_probe(rep, target, src, lines, do_run)
    return rep


def render(rep: Report) -> None:
    print("=" * 78)
    print("rule-gate-verify :: executable rule gate for the Free Cash daily monitor")
    print("=" * 78)
    print(f"target : {rep.target}")
    print(f"exists : {rep.target_exists}   kind: {rep.kind}")
    print(f"parse  : {'OK' if rep.parse_ok else 'FAILED'} -- {rep.parse_detail}")
    if rep.forbidden_hits:
        print(f"token scan hits (informational, ROUTINE-DESIGN §3.3 false-positive class): "
              f"{len(rep.forbidden_hits)}")
        for h in rep.forbidden_hits[:8]:
            print(f"    {h}")
    print()

    for rule in ("R1", "R2", "R3", "R4"):
        print("-" * 78)
        print(f"{rule}: {RULE_TEXT[rule]}")
        print("-" * 78)
        for f in [x for x in rep.findings if x.rule == rule]:
            print(f.fmt())
        print(f"  >>> {rule} RESULT: "
              f"{'PASS' if rep.rule_ok(rule) else 'FAIL'}")
        print()

    if rep.runtime:
        print("-" * 78)
        print("RUNTIME PROBE (temp-dir copy of the target; cwd = temp)")
        print("-" * 78)
        for r in rep.runtime:
            print(f"  - {r}")
        print()

    print("=" * 78)
    summary = "  ".join(f"{r}={'PASS' if rep.rule_ok(r) else 'FAIL'}"
                        for r in ("R1", "R2", "R3", "R4"))
    failed = [r for r in ("R1", "R2", "R3", "R4") if not rep.rule_ok(r)]
    print(f"SUMMARY: {summary}")
    if failed:
        print(f"VERDICT: NOT COMPLIANT -- {len(failed)}/4 rule(s) violated: "
              f"{', '.join(failed)}")
    else:
        print("VERDICT: COMPLIANT -- 4/4 rules structurally enforced with cited evidence")
    print("=" * 78)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("target", help="monitor implementation to verify (.py or .mjs)")
    ap.add_argument("--run", action="store_true",
                    help="also execute a temp-dir copy (refused for write-call shapes / "
                         "hardcoded repo paths)")
    ap.add_argument("--json", action="store_true", help="emit machine-readable JSON")
    ap.add_argument("--json-out", default=None, help="write the JSON report to this path")
    args = ap.parse_args(argv)

    target = Path(args.target)
    rep = verify(target, args.run)

    if args.json or args.json_out:
        payload = {
            "target": rep.target,
            "exists": rep.target_exists,
            "kind": rep.kind,
            "parse_ok": rep.parse_ok,
            "parse_detail": rep.parse_detail,
            "rules": {r: {"result": "PASS" if rep.rule_ok(r) else "FAIL",
                          "findings": [asdict(f) for f in rep.findings if f.rule == r]}
                      for r in ("R1", "R2", "R3", "R4")},
            "runtime": rep.runtime,
            "forbidden_hits": rep.forbidden_hits,
            "exit_code": 0 if not [r for r in ("R1", "R2", "R3", "R4")
                                   if not rep.rule_ok(r)] else 1,
        }
        text = json.dumps(payload, indent=2)
        if args.json_out:
            Path(args.json_out).write_text(text, encoding="utf-8")
        if args.json:
            print(text)

    if not rep.target_exists:
        print(f"[rule-gate-verify] TARGET MISSING: {rep.target} -- NOT a pass", file=sys.stderr)
        return 2

    if not args.json:
        render(rep)

    for r in ("R1", "R2", "R3", "R4"):
        if not rep.rule_ok(r):
            return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
