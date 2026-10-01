#!/usr/bin/env python3
"""rule_gate_r3.py -- independent, package-scope, AST-based rule gate for the
Free Cash Finance daily monitoring routine.

Canonical rule numbering used HERE (delegation-brief numbering, see the report's
"two numberings" table -- the shipped code's own docstrings use a DIFFERENT map):

  Rule 1 (once-per-day check)          at most one status read per Europe/Berlin
                                       calendar day; a run that reads nothing
                                       must not spend the day.
  Rule 2 (zero automated earning        no earning/withdrawal/transaction action;
          actions)                     read-only transport only (GET/HEAD to a
                                       loopback allowlist).
  Rule 3 (notify on earnings/status     exactly once per change, deduplicated;
          changes)                     prior state loaded BEFORE the new snapshot
                                       is written.
  Rule 4 (human approval before any     explicit NAMED-HUMAN approval; no
          external action)             execution path exists at all.

Design notes
------------
* Detection is by Python AST over the package modules, cross-module where the
  mechanism is cross-module (e.g. Rule 1's "no day spent without a reading" reads
  gate.SUCCESS_OUTCOMES out of the *same tree under test* and checks it against
  the outcome literal on run_daily_check's data-less branch).
* Not string-grep: a docstring that merely says "read-only" cannot satisfy any
  check, and the two tautological assertions in the shipped .mjs verifier are
  structurally impossible here (each check names the node it inspected).
* Every check emits an evidence line naming file + line + what was seen.
* exit 0 = all four canonical rules enforced; exit 1 = at least one rule fails.

Usage:
    python rule_gate_r3.py --package monitoring/freecash
    python rule_gate_r3.py --package <copy> --json
"""
from __future__ import annotations

import argparse
import ast
import json
import sys
from pathlib import Path

RULE_TITLES = {
    1: "Rule 1 (once-per-day check): at most one status read per Europe/Berlin calendar day.",
    2: "Rule 2 (zero automated earning actions): no earning/withdrawal/transaction action; read-only transport only.",
    3: "Rule 3 (notify on earnings/status changes): exactly once per change, deduplicated.",
    4: "Rule 4 (human approval before any external action): explicit named-human approval; no execution path.",
}

SOCKET_LIBS = {"socket", "http", "urllib", "requests", "httpx", "aiohttp", "ftplib", "smtplib"}
NET_MODULE = "readonly_client.py"
WRITE_VERBS = {"POST", "PUT", "PATCH", "DELETE"}
WRITE_PATH_TOKENS = (
    "withdraw", "cashout", "cash-out", "payout", "redeem", "claim", "transact",
    "earn", "transfer", "send", "order", "approve", "balance/", "/balance",
)
LOOPBACK_HOSTS = {"localhost", "127.0.0.1", "::1", "[::1]"}
DENYLIST_NAMES = ("NON_HUMAN", "NONHUMAN", "DENY", "DENIED", "BANNED", "FORBIDDEN", "BLOCKED", "MACHINE")
ALLOWLIST_NAMES = ("ALLOW", "WHITELIST", "WHITE_LIST", "HUMAN_OPERATOR", "OPERATOR", "APPROVER", "AUTHORISED", "AUTHORIZED", "KNOWN_HUMAN", "HUMAN_NAMES")


class Check:
    def __init__(self, rule, cid, what):
        self.rule = rule
        self.cid = cid
        self.what = what
        self.ok = True
        self.evidence = []

    def fail(self, text):
        self.ok = False
        self.evidence.append("FAIL: " + text)

    def note(self, text):
        self.evidence.append("  seen: " + text)


# --------------------------------------------------------------------------- ast helpers

def parse(path: Path):
    try:
        return ast.parse(path.read_text(encoding="utf-8", errors="replace"), filename=str(path))
    except SyntaxError as exc:
        return exc


def modules(pkg: Path):
    """The routine's enforcement modules (tests/ excluded -- tests hold deliberate
    negative controls that name forbidden tokens on purpose)."""
    return sorted(p for p in pkg.glob("*.py"))


def tops(module, name):
    for node in getattr(module, "body", []):
        if isinstance(node, (ast.Assign, ast.AnnAssign)):
            targets = node.targets if isinstance(node, ast.Assign) else [node.target]
            for t in targets:
                if isinstance(t, ast.Name) and t.id == name:
                    return node.value
    return None


def call_name(node):
    f = node.func
    if isinstance(f, ast.Name):
        return f.id
    if isinstance(f, ast.Attribute):
        return f.attr
    return None


def iter_calls(node):
    for n in ast.walk(node):
        if isinstance(n, ast.Call):
            yield n


def func_defs(module):
    return {n.name: n for n in ast.walk(module) if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))}


def const_strs(value):
    out = []
    for n in ast.walk(value):
        if isinstance(n, ast.Constant) and isinstance(n.value, str):
            out.append(n.value)
    return out


def module_constants(module):
    """Map top-level Name -> unparsed literal (or None), for frozen-field resolution."""
    out = {}
    for node in getattr(module, "body", []):
        if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
            out[node.targets[0].id] = ast.unparse(node.value).strip()
    return out


def walk_body_no_else(node):
    """Yield every node in the *taken* body of an If, never descending into orelse.

    Needed because `if A: ... elif B: ...` is an If nested in A's orelse, so a bare
    ast.walk over the outer If picks up the sibling branches' assignments too.
    """
    for st in getattr(node, "body", []):
        yield st
        if isinstance(st, ast.If):
            yield from walk_body_no_else(st)
        else:
            for child in ast.iter_child_nodes(st):
                if isinstance(child, ast.If):
                    yield from walk_body_no_else(child)
                else:
                    yield child
                    for sub in ast.walk(child):
                        if isinstance(sub, ast.If):
                            yield from walk_body_no_else(sub)


# --------------------------------------------------------------------------- Rule 1

def rule1(pkg, mods):
    checks = []
    gate_src = pkg / "gate.py"
    run_src = pkg / "run_daily_check.py"

    # --- R1.1 atomic exclusive-create day lock, keyed on a calendar day
    c = Check(1, "R1.1", "day lock is an atomic O_CREAT|O_EXCL exclusive-create keyed on the local calendar day")
    g = parse(gate_src)
    if isinstance(g, SyntaxError):
        c.fail("gate.py does not parse: %s" % g)
    else:
        fn = func_defs(g).get("acquire_day_lock")
        if fn is None:
            c.fail("gate.py has no acquire_day_lock()")
        else:
            flags_ok, excl = False, False
            for n in ast.walk(fn):
                if isinstance(n, ast.Call) and call_name(n) == "open":
                    names = [a.attr for a in ast.walk(n) if isinstance(a, ast.Attribute) and isinstance(a.value, ast.Name) and a.value.id == "os"]
                    excl = "O_EXCL" in names and "O_CREAT" in names
                    flags_ok = bool(names)
            if not excl:
                c.fail("acquire_day_lock() does not use os.open(..., O_CREAT|O_EXCL); race window open" )
            else:
                c.note("gate.py:%d os.open(O_CREAT|O_EXCL|O_WRONLY) in acquire_day_lock" % fn.lineno)
            dk = func_defs(g).get("day_key")
            lk = func_defs(g).get("lock_path")
            dk_ok = dk is not None and ".date().isoformat()" in ast.unparse(dk)
            lk_ok = lk is not None and "%s.lock" in ast.unparse(lk)
            if not dk_ok:
                c.fail("gate.day_key() does not build an ISO calendar date (expected .date().isoformat())")
            if not lk_ok:
                c.fail("gate.lock_path() does not name the lock file from the day key")
            if dk_ok and lk_ok:
                c.note("gate.py:%d day_key -> .date().isoformat(); lock file = '%%s.lock' %% day" % dk.lineno)
    checks.append(c)

    # --- R1.2 the status read happens BEHIND the day lock, not before it
    c = Check(1, "R1.2", "acquire_day_lock() is called before any status-read call in the same function")
    r = parse(run_src)
    if isinstance(r, SyntaxError):
        c.fail("run_daily_check.py does not parse: %s" % r)
    else:
        found = False
        for fn in [n for n in ast.walk(r) if isinstance(n, ast.FunctionDef)]:
            lock_at = [n.lineno for n in iter_calls(fn) if call_name(n) == "acquire_day_lock"]
            read_at = [n.lineno for n in iter_calls(fn)
                       if call_name(n) in ("read_source", "read_status_source", "read_metrics", "probe_status")]
            if lock_at and read_at:
                found = True
                if min(lock_at) > min(read_at):
                    c.fail("%s(): status read at :%d precedes lock at :%d (lock-before-read violated)"
                           % (fn.name, min(read_at), min(lock_at)))
                else:
                    c.note("run_daily_check.py %s(): lock :%d < first read :%d"
                           % (fn.name, min(lock_at), min(read_at)))
        if not found:
            c.fail("run_daily_check.py has no function containing BOTH a day lock and a status read")
    checks.append(c)

    # --- R1.3 the day is NOT marked successful when nothing was read
    c = Check(1, "R1.3", "the data-less outcome is NOT a member of gate.SUCCESS_OUTCOMES")
    gg = parse(gate_src)
    rr = parse(run_src)
    if isinstance(gg, SyntaxError) or isinstance(rr, SyntaxError):
        c.fail("cannot read SUCCESS_OUTCOMES / degraded outcome: parse error")
    else:
        succ_node = tops(gg, "SUCCESS_OUTCOMES")
        succ = set(const_strs(succ_node)) if succ_node is not None else set()
        if not succ:
            c.fail("gate.SUCCESS_OUTCOMES not found or empty -- cannot judge the ledger")
        degraded = None
        for fn in [n for n in ast.walk(rr) if isinstance(n, ast.FunctionDef)]:
            for n in ast.walk(fn):
                if isinstance(n, ast.If) and "data_available" in ast.unparse(n.test):
                    for st in walk_body_no_else(n):
                        if isinstance(st, ast.Assign) and isinstance(st.targets[0], ast.Name) \
                                and st.targets[0].id == "outcome" \
                                and isinstance(st.value, ast.Constant) and isinstance(st.value.value, str):
                            degraded = st.value.value
        if degraded is None:
            c.fail("no outcome literal found on the data_available=False branch; cannot prove the day budget")
        elif degraded in succ:
            c.fail("gate.SUCCESS_OUTCOMES contains %r (gate.py:%d) AND run_daily_check.py assigns outcome=%r on the "
                   "data_available=False branch -> a day with ZERO data advances last_success_day"
                   % (degraded, succ_node.lineno if succ_node is not None else -1, degraded))
        else:
            c.note("degraded outcome %r is not in SUCCESS_OUTCOMES %s" % (degraded, sorted(succ)))
    checks.append(c)

    # --- R1.4 the data-less branch does not write the ledger's success fields itself
    c = Check(1, "R1.4", "the data_available=False branch does not assign last_success_day / zero the miss counter")
    if isinstance(rr, SyntaxError):
        c.fail("run_daily_check.py does not parse")
    else:
        hits, seen_branch = [], False
        for fn in [n for n in ast.walk(rr) if isinstance(n, ast.FunctionDef)]:
            for n in ast.walk(fn):
                if isinstance(n, ast.If) and "data_available" in ast.unparse(n.test):
                    seen_branch = True
                    for st in walk_body_no_else(n):
                        if isinstance(st, ast.Assign):
                            tgt = ast.unparse(st.targets[0])
                            if "last_success_day" in tgt or "consecutive_missed_days" in tgt:
                                hits.append("run_daily_check.py:%d %s = %s" % (st.lineno, tgt, ast.unparse(st.value)))
        if not seen_branch:
            c.fail("no data_available=False branch found")
        elif hits:
            c.fail("data-less branch writes the ledger's success fields directly: %s -> a run that read nothing "
                   "books itself as covered" % hits)
        else:
            c.note("data-less branch only sets the outcome; last_success_day is untouched there")
    checks.append(c)
    return checks


# --------------------------------------------------------------------------- Rule 2

def rule2(pkg, mods):
    checks = []

    # --- R2.1 exactly one module may touch a socket library
    c = Check(2, "R2.1", "only %s imports a socket/HTTP library" % NET_MODULE)
    offenders = []
    for m in mods:
        tree = parse(m)
        if isinstance(tree, SyntaxError):
            c.fail("%s does not parse: %s" % (m.name, tree))
            continue
        libs = set()
        for n in ast.walk(tree):
            if isinstance(n, ast.Import):
                for a in n.names:
                    libs.add(a.name.split(".")[0])
            elif isinstance(n, ast.ImportFrom) and n.module:
                libs.add(n.module.split(".")[0])
        hit = sorted(libs & SOCKET_LIBS)
        if hit and m.name != NET_MODULE:
            offenders.append("%s imports %s" % (m.name, hit))
    if offenders:
        c.fail("socket/HTTP libraries imported outside %s: %s" % (NET_MODULE, offenders))
    else:
        c.note("imports of %s confined to %s" % (sorted(SOCKET_LIBS), NET_MODULE))
    checks.append(c)

    rc = parse(pkg / NET_MODULE)
    if isinstance(rc, SyntaxError):
        bad = Check(2, "R2.2", "transport method allowlist is read-only")
        bad.fail("%s does not parse: %s" % (NET_MODULE, rc))
        checks.append(bad)
        bad = Check(2, "R2.3", "path/host allowlist admits no earning or write endpoint")
        bad.fail("%s does not parse" % NET_MODULE)
        checks.append(bad)
        bad = Check(2, "R2.4", "no write-call shape in any enforcement module")
        bad.fail("%s does not parse" % NET_MODULE)
        checks.append(bad)
        return checks

    # --- R2.2 methods subset of {GET, HEAD}
    c = Check(2, "R2.2", "readonly_client.ALLOWED_METHODS is a subset of {GET, HEAD}")
    node = tops(rc, "ALLOWED_METHODS")
    methods = set(const_strs(node)) if node is not None else set()
    if not methods:
        c.fail("ALLOWED_METHODS not found")
    elif not methods <= {"GET", "HEAD"}:
        c.fail("ALLOWED_METHODS contains non-read verbs: %s" % sorted(methods - {"GET", "HEAD"}))
    else:
        c.note("ALLOWED_METHODS=%s" % sorted(methods))
    checks.append(c)

    # --- R2.3 path allowlist + loopback-only hosts
    c = Check(2, "R2.3", "ALLOWED_PATHS admits no earning/write endpoint and ALLOWED_HOSTS is loopback-only")
    pnode = tops(rc, "ALLOWED_PATHS")
    patterns = const_strs(pnode) if pnode is not None else []
    bad = [p for p in patterns if any(t in p.lower() for t in WRITE_PATH_TOKENS)]
    if not patterns:
        c.fail("ALLOWED_PATHS is empty or absent -> nothing proves the read surface")
    elif bad:
        c.fail("ALLOWED_PATHS names a write/earning endpoint: %s" % bad)
    else:
        c.note("ALLOWED_PATHS=%s" % patterns)
    hnode = tops(rc, "ALLOWED_HOSTS")
    hosts = set(const_strs(hnode)) if hnode is not None else set()
    if not hosts:
        c.fail("ALLOWED_HOSTS absent")
    elif not hosts <= LOOPBACK_HOSTS:
        c.fail("ALLOWED_HOSTS is not loopback-only: %s" % sorted(hosts))
    else:
        c.note("ALLOWED_HOSTS=%s" % sorted(hosts))
    checks.append(c)

    # --- R2.4 no write-call shape anywhere in the enforcement modules
    c = Check(2, "R2.4", "no write/earning call shape in any enforcement module (AST, not grep)")
    hits = []
    for m in mods:
        tree = parse(m)
        if isinstance(tree, SyntaxError):
            continue
        for n in ast.walk(tree):
            if isinstance(n, ast.Call):
                nm = call_name(n)
                if isinstance(n.func, ast.Attribute) and n.func.attr in ("post", "put", "patch", "delete"):
                    hits.append("%s:%d .%s(...)" % (m.name, n.lineno, n.func.attr))
                if nm in ("urlopen", "urlretrieve") or nm == "request":
                    for kw in n.keywords:
                        if kw.arg in ("data", "body", "json", "files"):
                            hits.append("%s:%d %s(..., %s=...)" % (m.name, n.lineno, nm, kw.arg))
            if isinstance(n, ast.Constant) and isinstance(n.value, str) and n.value in WRITE_VERBS:
                if m.name != NET_MODULE or n.value not in ("GET", "HEAD"):
                    hits.append("%s:%d literal method %r" % (m.name, n.lineno, n.value))
    if hits:
        c.fail("write/earning call shapes: %s" % hits)
    else:
        c.note("no .post/.put/.patch/.delete, no body-bearing urlopen, no POST/PUT/PATCH/DELETE literal in %d modules"
               % len(mods))
    checks.append(c)
    return checks


# --------------------------------------------------------------------------- Rule 3

def rule3(pkg, mods):
    checks = []

    # --- R3.1 prior snapshot loaded BEFORE the new snapshot is written
    c = Check(3, "R3.1", "prior snapshot is loaded before the current snapshot is written")
    r = parse(pkg / "run_daily_check.py")
    if isinstance(r, SyntaxError):
        c.fail("run_daily_check.py does not parse")
    else:
        found = False
        for fn in [n for n in ast.walk(r) if isinstance(n, ast.FunctionDef)]:
            load_at = [n.lineno for n in iter_calls(fn) if call_name(n) in ("load_prior_snapshot", "load_snapshot")]
            save_at = [n.lineno for n in iter_calls(fn) if call_name(n) == "save_snapshot"]
            if load_at and save_at:
                found = True
                if min(load_at) > min(save_at):
                    c.fail("%s(): save_snapshot :%d precedes load_prior_snapshot :%d -> the comparison is against the "
                           "snapshot just written; change detection can never fire"
                           % (fn.name, min(save_at), min(load_at)))
                else:
                    c.note("run_daily_check.py %s(): load_prior_snapshot :%d < save_snapshot :%d"
                           % (fn.name, min(load_at), min(save_at)))
        if not found:
            c.fail("no function contains both a prior-snapshot load and a snapshot save")
    checks.append(c)

    # --- R3.2 exact integer comparison (no tolerance / threshold)
    c = Check(3, "R3.2", "changedetect.compare() compares the four fields exactly (no tolerance/threshold)")
    cd = parse(pkg / "changedetect.py")
    if isinstance(cd, SyntaxError):
        c.fail("changedetect.py does not parse")
    else:
        cmp_fn = func_defs(cd).get("compare")
        if cmp_fn is None:
            c.fail("changedetect.compare() not found")
        else:
            rel = [n for n in ast.walk(cmp_fn)
                   if isinstance(n, ast.Compare) and any(isinstance(o, (ast.Lt, ast.LtE, ast.Gt, ast.GtE)) for o in n.ops)]
            if rel:
                c.fail("changedetect.compare() uses an order comparison at :%d (%s) -> a tolerance/threshold slipped in"
                       % (rel[0].lineno, ast.unparse(rel[0])))
            else:
                c.note("changedetect.py:%d compare() has no order comparison; equality only" % cmp_fn.lineno)
    checks.append(c)

    # --- R3.3 the dedupe key is recorded BEFORE the dispatch
    c = Check(3, "R3.3", "the dedupe key is written to the index before the sender is invoked")
    nt = parse(pkg / "notify.py")
    if isinstance(nt, SyntaxError):
        c.fail("notify.py does not parse")
    else:
        d = func_defs(nt).get("dispatch")
        if d is None:
            c.fail("notify.dispatch() not found")
        else:
            record = [n.lineno for n in iter_calls(d) if call_name(n) == "record_notified_key"]
            send = [n.lineno for n in iter_calls(d) if isinstance(n.func, ast.Name) and n.func.id == "sender"]
            if not record:
                c.fail("notify.dispatch() never writes the dedupe index")
            elif not send:
                c.note("notify.dispatch() records the key but invokes no sender symbol directly")
            elif min(record) > min(send):
                c.fail("notify.dispatch(): sender :%d precedes record_notified_key :%d -> a crash between the two "
                       "double-notifies" % (min(send), min(record)))
            else:
                c.note("notify.py:%d record_notified_key before sender :%d" % (min(record), min(send)))
    checks.append(c)
    return checks


# --------------------------------------------------------------------------- Rule 4

def rule4(pkg, mods):
    checks = []

    # --- R4.1 no dynamic-code / shell execution primitive
    c = Check(4, "R4.1", "no dynamic-code or shell execution primitive (eval/exec/bare compile/__import__/runpy/os.system/os.popen)")
    hits = []
    subprocess_calls = []
    for m in mods:
        tree = parse(m)
        if isinstance(tree, SyntaxError):
            c.fail("%s does not parse" % m.name)
            continue
        for n in ast.walk(tree):
            if isinstance(n, ast.Call):
                if isinstance(n.func, ast.Name) and n.func.id in ("eval", "exec", "compile", "__import__"):
                    hits.append("%s:%d bare %s()" % (m.name, n.lineno, n.func.id))
                if isinstance(n.func, ast.Attribute):
                    root = ast.unparse(n.func.value)
                    nm = n.func.attr
                    if root == "os" and nm in ("system", "popen", "execv", "execvp", "execl", "spawnv", "spawnl"):
                        hits.append("%s:%d os.%s" % (m.name, n.lineno, nm))
                    if root == "subprocess" and nm in ("run", "call", "Popen", "check_output", "check_call"):
                        subprocess_calls.append((m.name, n.lineno, ast.unparse(n)[:160]))
                    if root == "runpy" or nm in ("run_path", "run_module"):
                        hits.append("%s:%d %s.%s" % (m.name, n.lineno, root, nm))
    if hits:
        c.fail("dynamic-code / shell primitives present: %s" % hits)
    else:
        c.note("no eval/exec/bare-compile/__import__/runpy/os.system/os.popen in %d modules" % len(mods))
    checks.append(c)

    # --- R4.1b subprocess, if present at all, stays a local-notification concern
    c = Check(4, "R4.1b", "any subprocess call is confined to notify.py AND its argv names no network/earning tool")
    bad = []
    for fname, lineno, text in subprocess_calls:
        low = text.lower()
        net = [t for t in ("curl", "wget", "urllib", "http", "withdraw", "cashout", "payout", "redeem",
                           "claim", "freecash", "requests") if t in low]
        if fname != "notify.py":
            bad.append("%s:%d not in notify.py: %s" % (fname, lineno, text))
        elif net:
            bad.append("%s:%d argv names %s: %s" % (fname, lineno, net, text))
    if bad:
        c.fail("subprocess site(s) outside the local notifier / naming a remote tool: %s" % bad)
    elif subprocess_calls:
        c.note("subprocess sites (local notifier only): %s" % ["%s:%d" % (f, l) for f, l, _ in subprocess_calls])
    else:
        c.note("no subprocess call at all")
    checks.append(c)

    # --- R4.2 the approval item's execution fields are frozen constants
    c = Check(4, "R4.2", "approval item's expires_at_utc/execution_state/execution_allowed resolve to the frozen literals")
    aq = parse(pkg / "approval_queue.py")
    if isinstance(aq, SyntaxError):
        c.fail("approval_queue.py does not parse")
    else:
        consts = module_constants(aq)
        bi = func_defs(aq).get("build_item")
        if bi is None:
            c.fail("approval_queue.build_item() not found")
        else:
            frozen = {}
            for n in ast.walk(bi):
                if isinstance(n, ast.Dict):
                    for k, v in zip(n.keys, n.values):
                        if isinstance(k, ast.Constant) and k.value in (
                                "expires_at_utc", "execution_state", "execution_allowed_by_this_routine"):
                            txt = ast.unparse(v).strip()
                            if isinstance(v, ast.Name) and v.id in consts:
                                txt = consts[v.id]
                            frozen[k.value] = txt
            want = {"expires_at_utc": "None", "execution_state": "'NOT_EXECUTED'",
                    "execution_allowed_by_this_routine": "False"}
            for key, expect in want.items():
                got = frozen.get(key)
                if got is None:
                    c.fail("build_item() does not set %s" % key)
                elif got.strip() != expect:
                    c.fail("build_item() sets %s to %s (expected the frozen value %s)" % (key, got, expect))
                else:
                    c.note("approval_queue.py:%d %s = %s" % (bi.lineno, key, got))
    checks.append(c)

    # --- R4.3a a decider-identity guard EXISTS at all
    c = Check(4, "R4.3a", "a decider-identity guard exists (absence of any guard accepts any label)")
    nd = None
    if isinstance(aq, SyntaxError):
        c.fail("approval_queue.py does not parse")
    else:
        nd = func_defs(aq).get("_normalise_decider") or func_defs(aq).get("normalise_decider")
        if nd is None:
            c.fail("no decider-normalisation function at all -> any label, including a machine's, is accepted")
        else:
            guards = [n for n in ast.walk(nd)
                      if isinstance(n, ast.Compare) and any(isinstance(o, (ast.In, ast.NotIn)) for o in n.ops)]
            if not guards:
                c.fail("_normalise_decider() has no membership guard at :%d (only an empty-string check) -> "
                       "'hermes-agent', 'assistant', 'claude' are ACCEPTED" % nd.lineno)
            else:
                c.note("approval_queue.py:%d membership guard present (%d comparison(s))" % (nd.lineno, len(guards)))
    checks.append(c)

    # --- R4.3b the guard is an ALLOWLIST of human identities, not a denylist
    c = Check(4, "R4.3b", "the guard is an allowlist of human identities (a denylist admits 'hermes-agent'/'assistant'/'claude')")
    if isinstance(aq, SyntaxError) or nd is None:
        c.fail("no guard to classify")
    else:
        kinds, containers = [], []
        for n in ast.walk(nd):
            if isinstance(n, ast.Compare) and any(isinstance(o, (ast.In, ast.NotIn)) for o in n.ops):
                names = [x.id for x in ast.walk(n) if isinstance(x, ast.Name)]
                containers.extend(names)
                up = [x.upper() for x in names]
                if any(any(pat in name for pat in DENYLIST_NAMES) for name in up):
                    kinds.append("denylist")
                if any(any(pat in name for pat in ALLOWLIST_NAMES) for name in up):
                    kinds.append("allowlist")
        if not kinds:
            c.fail("guard present but not classifiable as allow/deny (%s)" % containers)
        elif all(k == "denylist" for k in kinds):
            c.fail("guard is a DENYLIST only (%s) -> any label not in that literal set is accepted: "
                   "'hermes-agent', 'assistant', 'claude' currently pass as a human" % sorted(set(containers)))
        else:
            c.note("guard classifies as %s (%s)" % (sorted(set(kinds)), sorted(set(containers))))
    checks.append(c)
    return checks


# --------------------------------------------------------------------------- main

def run(pkg: Path):
    mods = modules(pkg)
    checks = []
    for fn in (rule1, rule2, rule3, rule4):
        checks.extend(fn(pkg, mods))
    per_rule = {}
    for c in checks:
        per_rule.setdefault(c.rule, []).append(c)
    for rule in sorted(per_rule):
        per_rule[rule] = all(x.ok for x in per_rule[rule])
    return checks, per_rule


def main(argv=None):
    ap = argparse.ArgumentParser(prog="rule_gate_r3.py", description=__doc__.split("\n")[0])
    ap.add_argument("--package", required=True, help="routine package directory")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args(argv)

    pkg = Path(args.package)
    checks, per_rule = run(pkg)

    if args.json:
        print(json.dumps({
            "package": str(pkg),
            "rules": {str(k): ("PASS" if v else "FAIL") for k, v in per_rule.items()},
            "checks": [{"id": c.cid, "rule": c.rule, "ok": c.ok, "what": c.what, "evidence": c.evidence} for c in checks],
        }, indent=2))
    else:
        print("=" * 88)
        print("rule_gate_r3.py -- independent AST gate, canonical rule numbering")
        print("package: %s" % pkg)
        print("=" * 88)
        for rule in sorted(RULE_TITLES):
            print("")
            print("Rule %d  %s" % (rule, RULE_TITLES[rule].split(": ", 1)[1] if ": " in RULE_TITLES[rule] else ""))
            for c in [x for x in checks if x.rule == rule]:
                print("  [%s] %s  %s" % ("PASS" if c.ok else "FAIL", c.cid, c.what))
                for ev in c.evidence:
                    print("        " + ev)
            print("  >>> RULE %d RESULT: %s" % (rule, "PASS" if per_rule[rule] else "FAIL"))
        print("")
        print("-" * 88)
        print("SUMMARY: " + "  ".join("R%d=%s" % (k, "PASS" if v else "FAIL") for k, v in sorted(per_rule.items())))
        bad = [k for k, v in sorted(per_rule.items()) if not v]
        if bad:
            print("VERDICT: NOT COMPLIANT -- rule(s) violated: %s" % ", ".join("R%d" % k for k in bad))
        else:
            print("VERDICT: COMPLIANT -- all four canonical operator rules enforced")
        print("-" * 88)
    return 0 if all(per_rule.values()) else 1


if __name__ == "__main__":
    sys.exit(main())
