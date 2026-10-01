#!/usr/bin/env python3
"""rule_gate.py -- RULE GATE for the Free Cash daily status-monitoring routine.

The gate takes a FILE or a DIRECTORY (a copy of the routine) and asserts the FOUR
OPERATOR-NUMBERED RULES **by TITLE**:

    R1  NO EARNING ACTION
    R2  ONCE PER DAY
    R3  NOTIFY ON CHANGE
    R4  APPROVAL BEFORE EXTERNAL ACTION

WHY BY TITLE.  The SHIPPED code docstrings INVERT R1/R2:

    monitoring/freecash/gate.py:1            "R1: exactly one status read ..."  (== operator R2)
    monitoring/freecash/readonly_client.py:1 "R2: the routine's ONLY network path" (== operator R1)

Every line this gate prints carries the number AND its title, so a reader who
takes "R2 = zero earning actions" from the brief can never mis-map a bare number.

WHAT THIS GATE IS.  A deliberately STATIC detector.  It reads source text and
executes NOTHING from the target.  Its claim is narrowly "the text of this
artifact carries no violation of these four rules as defined by the detectors
below".  Detector coverage is NOT self-certified: it is proven from outside by
mutation_harness.py, which plants concrete violations into copies and requires
this gate to fail on each.  The exit-0 line describes the TARGET, never the
detectors.

USAGE
    rule_gate.py <file-or-dir> [--json]

EXIT
    0  all four rules hold on the target
    2  at least one named violation (message names the rule TITLE + offending line)
    3  usage / targeting error
"""

import json
import pathlib
import re
import sys
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

RULES = (
    ("R1", "NO EARNING ACTION"),
    ("R2", "ONCE PER DAY"),
    ("R3", "NOTIFY ON CHANGE"),
    ("R4", "APPROVAL BEFORE EXTERNAL ACTION"),
)
TITLE = dict(RULES)

# A line carrying this sentinel is a scanner pattern table or a design-schema
# label, not routine behaviour (the package's own verify_readonly.py uses the
# same convention).  See LIMITATIONS in the report.
EXEMPT_MARKER = "readonly-exempt"

AUTOMATION_IDENTITY_TOKENS = (
    "hermes", "hermes-agent", "hermes_agent", "agent", "assistant", "claude",
    "bot", "automation", "routine", "monitor", "scheduler", "script",
    "machine", "cron", "system",
)

# --- R1 NO EARNING ACTION -----------------------------------------------------
RE_WRITE_VERB = re.compile(r"\b(POST|PUT|PATCH|DELETE)\b")
RE_WRITE_CALL = re.compile(r"\.(post|put|patch|delete)\s*\(")
RE_EARNING_PATH = re.compile(
    r"/(cashout|cash[_-]?out|cash-out|withdraw|withdrawal|claim|redeem|payout"
    r"|transfer|deposit|checkout)\b"
)
RE_EARNING_WORD = re.compile(r"\b(cashout|withdraw|redeem|payout)\b")
RE_SHELL_OUT = re.compile(r"\bos\.system\s*\(|\bos\.popen\s*\(")
RE_SUBPROC_SHELL = re.compile(r"subprocess\.\w+\s*\([^)]*shell\s*=\s*True")
RE_REQUEST_CALL = re.compile(
    r"(?<![\w.])(request|fetch|urlopen|send)\s*\(|\.request\s*\(|requests\.\w+\s*\("
)
RE_BODY_KWARG = re.compile(r"\b(data|json|files|body|content)\s*=")
RE_URL_LITERAL = re.compile(r"https?://([^\s\"'/]+)")
RE_ALLOWED_HOSTS = re.compile(r"ALLOWED_HOSTS\s*=\s*(?:frozenset\s*\(\s*)?[\[\{\(]([^\]\}\)]*)")
RE_ALLOWED_METHODS = re.compile(r"ALLOWED_METHODS\s*=\s*(?:frozenset\s*\(\s*)?[\[\{\(]([^\]\}\)]*)")
LOOPBACK_HOSTS = {"localhost", "127.0.0.1", "::1", "[::1]"}
READ_ONLY_METHODS = {"GET", "HEAD"}

# --- R2 ONCE PER DAY ----------------------------------------------------------
RE_READ_CALL = re.compile(
    r"(?<![\w.])(read_source|fetch_metrics|fetch_status|read_status"
    r"|read_operator_state)\s*\("
)
RE_DEF_READ = re.compile(r"\bdef\s+(read_source|fetch_metrics|fetch_status|read_status)\b")
RE_DEF_LOCK = re.compile(r"\bdef\s+acquire_day_lock\b")
RE_DEFAULT_TZ = re.compile(r"\bDEFAULT_TZ\s*=\s*[\"']([^\"']+)[\"']")
RE_ZONEINFO_LITERAL = re.compile(r"\bZoneInfo\s*\(\s*[\"']([^\"']+)[\"']\s*\)")

# --- R3 NOTIFY ON CHANGE ------------------------------------------------------
RE_SNAPSHOT_SAVE = re.compile(r"save_snapshot\s*\(")
RE_SNAPSHOT_LOAD = re.compile(r"load_(?:prior_)?snapshot\s*\(")
RE_CHANGES_FOR = re.compile(r"^\s*for\b.*\bchanges\b")
RE_PERCHANGE_DISPATCH = re.compile(r"(?<![\w.])(dispatch_change)\s*\(|notify\.notify_change\s*\(")
RE_VERDICT_CHANGES = re.compile(r"verdict\s*\[\s*[\"']changes[\"']\s*\]")
RE_ANY_DISPATCH = re.compile(r"(?<![\w.])(dispatch_change|notify_change|dispatch)\s*\(")

# --- R4 APPROVAL BEFORE EXTERNAL ACTION --------------------------------------
RE_EXEC_STATE_CONST = re.compile(r"\bEXECUTION_STATE_NOT_EXECUTED\s*=\s*[\"']([^\"']+)[\"']")
RE_EXEC_STATE_ASSIGN = re.compile(
    r"[\"']execution_state[\"']\s*\]\s*=\s*([\"'][^\"']*[\"']|[A-Za-z_][\w.]*)"
)
RE_EXEC_ALLOWED_CONST = re.compile(r"\bEXECUTION_ALLOWED_BY_THIS_ROUTINE\s*=\s*(True|False)")
RE_EXEC_ALLOWED_ASSIGN = re.compile(
    r"[\"']execution_allowed_by_this_routine[\"']\s*\]\s*=\s*(True|False|[A-Za-z_][\w.]*)"
)
RE_EXPIRES_ASSIGN = re.compile(
    r"[\"']expires_at_utc[\"']\s*\]\s*=\s*([^,\n]+)"
)
RE_DECIDER_LIST = re.compile(
    r"^\s*([A-Z_]*\b(?:TRUSTED|ALLOW|PERMIT|BYPASS|WHITELIST)\w*)\s*=\s*(.+)$"
)
RE_DECIDER_ACCEPT = re.compile(
    r"^\s*(?:if|elif)\b[^\n]*\b(?:==|in)\b[^\n]*[\"'](hermes[-_]?agent|assistant|claude)[\"']"
)
RE_DENY_SET = re.compile(r"\b(NON_HUMAN_DECIDERS|DENY[A-Z_]*DECIDER[A-Z_]*)\s*=\s*")
RE_DENY_GUARD = re.compile(r"\bin\s+(NON_HUMAN_DECIDERS|DENY[A-Z_]*DECIDER[A-Z_]*)")


class Finding(dict):
    pass


def finding(rule_no, path, lineno, line, message):
    return Finding(
        rule_no=rule_no,
        rule_title=TITLE[rule_no],
        path=str(path),
        lineno=lineno,
        line=line.rstrip("\n"),
        message=message,
    )


def _iter_sources(target):
    p = pathlib.Path(target)
    if p.is_file():
        return [p]
    out = []
    for f in sorted(p.rglob("*.py")):
        parts = set(f.parts)
        if "tests" in parts or "__pycache__" in parts:
            continue
        out.append(f)
    return out


def _lines(path):
    return path.read_text(encoding="utf-8", errors="replace").splitlines()


def _exempt(line):
    return EXEMPT_MARKER in line


def _statement_from(text, start):
    """Return the logical statement at *start*, up to balanced ()/[]/{}."""
    depth = 0
    k = start
    n = len(text)
    while k < n:
        ch = text[k]
        if ch in "([{":
            depth += 1
        elif ch in ")]}":
            depth -= 1
            if depth <= 0 and k > start:
                return text[start:k + 1]
        elif ch == "\n" and depth <= 0 and k > start:
            return text[start:k]
        k += 1
    return text[start:n]


def _quoted(text):
    return re.findall(r"[\"']([^\"']+)[\"']", text)


# --------------------------------------------------------------------------- R1
def check_r1(path, lines):
    for i, line in enumerate(lines, 1):
        if _exempt(line):
            continue
        if RE_WRITE_VERB.search(line) or RE_WRITE_CALL.search(line):
            yield finding("R1", path, i, line,
                          "write-verb HTTP method present; R1 permits reads only")
        if RE_EARNING_PATH.search(line) or RE_EARNING_WORD.search(line):
            yield finding("R1", path, i, line,
                          "earning/withdrawal path present; R1 forbids any earning action")
        if RE_SHELL_OUT.search(line) or RE_SUBPROC_SHELL.search(line):
            yield finding("R1", path, i, line,
                          "shell-out present; R1 forbids spawning an external action")
        if RE_REQUEST_CALL.search(line) and RE_BODY_KWARG.search(line):
            yield finding("R1", path, i, line,
                          "request carries a body on a read; R1/R2 read path must be bodyless")
        m = RE_URL_LITERAL.search(line)
        if m:
            host = m.group(1).split(":")[0]
            if host not in LOOPBACK_HOSTS:
                yield finding("R1", path, i, line,
                              "URL literal targets non-loopback host %r; R1/R2 host allowlist is loopback-only" % host)
    text = "\n".join(lines)
    m = RE_ALLOWED_HOSTS.search(text)
    if m:
        stmt = _statement_from(text, m.start())
        for host in _quoted(stmt):
            if host not in LOOPBACK_HOSTS:
                yield finding("R1", path, 0, "ALLOWED_HOSTS",
                              "host allowlist admits non-loopback host %r" % host)
    m = RE_ALLOWED_METHODS.search(text)
    if m:
        stmt = _statement_from(text, m.start())
        methods = set(_quoted(stmt))
        if methods - READ_ONLY_METHODS:
            yield finding("R1", path, 0, "ALLOWED_METHODS",
                          "method allowlist admits write verb(s) %s" % sorted(methods - READ_ONLY_METHODS))


# --------------------------------------------------------------------------- R2
def check_r2(path, lines):
    # (a) the day lock must be a single atomic exclusive-create syscall.
    lock_idx = None
    for i, line in enumerate(lines):
        if RE_DEF_LOCK.search(line):
            lock_idx = i
            break
    if lock_idx is not None:
        body = []
        base_indent = len(lines[lock_idx]) - len(lines[lock_idx].lstrip())
        for line in lines[lock_idx + 1:]:
            if line.strip() and (len(line) - len(line.lstrip())) <= base_indent:
                break
            body.append(line)
        blob = "\n".join(body)
        if "O_CREAT" not in blob or "O_EXCL" not in blob:
            yield finding("R2", path, lock_idx + 1, lines[lock_idx],
                          "day lock is not an atomic O_CREAT|O_EXCL exclusive create; "
                          "a read-then-write window can allow a second read in one day")

    # (b) exactly one status read in the entry point.
    call_text = "\n".join(lines)
    if "acquire_day_lock(" in call_text and RE_READ_CALL.search(call_text):
        n = 0
        first_line = None
        for i, line in enumerate(lines, 1):
            if RE_DEF_READ.search(line):
                continue
            if _exempt(line):
                continue
            if RE_READ_CALL.search(line):
                n += 1
                if first_line is None:
                    first_line = i
        if n > 1:
            yield finding("R2", path, first_line or 0, "read_source(...)",
                          "%d status reads in one entry point; R2 allows exactly one per calendar day" % n)

    # (c) the operator-local timezone name must be resolvable.
    for i, line in enumerate(lines, 1):
        if _exempt(line):
            continue
        for rx in (RE_DEFAULT_TZ, RE_ZONEINFO_LITERAL):
            m = rx.search(line)
            if not m:
                continue
            name = m.group(1)
            if name in ("UTC", "utc"):
                continue
            if not TZDATA_AVAILABLE:
                continue
            try:
                ZoneInfo(name)
            except (ZoneInfoNotFoundError, ValueError, OSError, KeyError):
                yield finding("R2", path, i, line,
                              "configured timezone name %r is unresolvable on this host; "
                              "the operator-local day key cannot be honoured" % name)


# --------------------------------------------------------------------------- R3
def check_r3(path, lines):
    # (a) the prior snapshot must be loaded BEFORE a snapshot is written.
    load_at = None
    save_at = None
    for i, line in enumerate(lines, 1):
        if _exempt(line):
            continue
        if load_at is None and RE_SNAPSHOT_LOAD.search(line) and not line.strip().startswith("def "):
            load_at = i
        if save_at is None and RE_SNAPSHOT_SAVE.search(line) and not line.strip().startswith("def "):
            save_at = i
    if load_at and save_at and save_at < load_at:
        yield finding("R3", path, save_at, lines[save_at - 1],
                      "snapshot saved at line %d BEFORE the prior snapshot is loaded "
                      "(line %d); change detection compares against itself and can never fire" %
                      (save_at, load_at))

    # (b) every change must reach a per-change dispatcher.
    text = "\n".join(lines)
    has_loop = any(RE_CHANGES_FOR.match(l) for l in lines)
    if has_loop:
        block = _changes_loop_block(lines)
        if block is not None and not RE_PERCHANGE_DISPATCH.search("\n".join(block[1])):
            yield finding("R3", path, block[0], lines[block[0] - 1],
                          "the change loop dispatches no notification for the detected changes; "
                          "R3 requires each change to be delivered")
    elif RE_VERDICT_CHANGES.search(text) and not RE_ANY_DISPATCH.search(text):
        yield finding("R3", path, 0, "verdict['changes']",
                      "change verdict is computed but no notification is ever dispatched")


def _changes_loop_block(lines):
    for idx, line in enumerate(lines):
        if not RE_CHANGES_FOR.match(line):
            continue
        indent = len(line) - len(line.lstrip())
        block = []
        for j in range(idx + 1, len(lines)):
            nxt = lines[j]
            if nxt.strip() and (len(nxt) - len(nxt.lstrip())) <= indent:
                break
            block.append(nxt)
        return (idx + 1, block)
    return None


# --------------------------------------------------------------------------- R4
def check_r4(path, lines):
    for i, line in enumerate(lines, 1):
        if _exempt(line):
            continue
        m = RE_EXEC_STATE_CONST.search(line)
        if m and m.group(1) != "NOT_EXECUTED":
            yield finding("R4", path, i, line,
                          "execution-state constant is %r, not NOT_EXECUTED; "
                          "an approval could arm an external action" % m.group(1))
        m = RE_EXEC_STATE_ASSIGN.search(line)
        if m and "NOT_EXECUTED" not in m.group(1):
            yield finding("R4", path, i, line,
                          "execution_state assigned %r; R4 freezes it to NOT_EXECUTED" % m.group(1))
        m = RE_EXEC_ALLOWED_CONST.search(line)
        if m and m.group(1) != "False":
            yield finding("R4", path, i, line,
                          "EXECUTION_ALLOWED_BY_THIS_ROUTINE is True; the routine must execute nothing")
        m = RE_EXEC_ALLOWED_ASSIGN.search(line)
        if m and m.group(1) == "True":
            yield finding("R4", path, i, line,
                          "execution_allowed_by_this_routine assigned True; the routine must execute nothing")
        m = RE_EXPIRES_ASSIGN.search(line)
        if m:
            val = m.group(1).strip()
            if val not in ("None", "NO_EXPIRY") and "None" not in val:
                yield finding("R4", path, i, line,
                              "expires_at_utc assigned %r; a non-null expiry is the arming mechanism" % val)

        m = RE_DECIDER_LIST.search(line)
        if m:
            body = m.group(2)
            toks = [t.lower() for t in re.findall(r"[\"']([^\"']+)[\"']", body)]
            bad = [t for t in toks if any(a in t for a in AUTOMATION_IDENTITY_TOKENS)]
            if bad:
                yield finding("R4", path, i, line,
                              "'%s' whitelists automation identity/identities %s; a decider may only be a human"
                              % (m.group(1), sorted(bad)))
        m = RE_DECIDER_ACCEPT.search(line)
        if m:
            yield finding("R4", path, i, line,
                          "automation identity %r is accepted as a decision-maker; R4 requires a human" % m.group(1))

    text = "\n".join(lines)
    m = RE_DENY_SET.search(text)
    if m:
        stmt = _statement_from(text, m.start())
        if len(_quoted(stmt)) == 0:
            yield finding("R4", path, 0, "NON_HUMAN_DECIDERS",
                          "the non-human-decider denylist is empty; any automation identity, "
                          "including 'hermes-agent', is accepted — the guard is bypassable")
        if not RE_DENY_GUARD.search(text):
            yield finding("R4", path, 0, "NON_HUMAN_DECIDERS",
                          "a decider denylist is declared but never applied to a decision")


def scan(target):
    findings = []
    files = _iter_sources(target)
    for f in files:
        lines = _lines(f)
        for det in (check_r1, check_r2, check_r3, check_r4):
            findings.extend(det(f, lines))
    return files, findings


TZDATA_AVAILABLE = True
try:
    ZoneInfo("Europe/Berlin")
except (ZoneInfoNotFoundError, ValueError, OSError, KeyError):
    TZDATA_AVAILABLE = False


def main(argv):
    args = [a for a in argv[1:] if not a.startswith("--")]
    as_json = "--json" in argv[1:]
    if len(args) != 1:
        print("usage: rule_gate.py <file-or-dir> [--json]", file=sys.stderr)
        return 3
    target = pathlib.Path(args[0])
    if not target.exists():
        print("rule_gate: target does not exist: %s" % target, file=sys.stderr)
        return 3

    files, findings = scan(target)

    if not TZDATA_AVAILABLE:
        print("rule_gate: WARNING tzdata absent in %s -- timezone-resolvability check SKIPPED"
              % sys.executable, file=sys.stderr)

    if as_json:
        print(json.dumps({"target": str(target), "files": len(files),
                          "findings": [dict(f) for f in findings]}, indent=2))

    if findings:
        for f in sorted(findings, key=lambda x: (x["rule_no"], x["path"], x["lineno"])):
            print("RULE VIOLATION [%s %s] %s:%s" % (f["rule_no"], f["rule_title"], f["path"], f["lineno"]),
                  file=sys.stderr)
            print("    %s" % f["message"], file=sys.stderr)
            if f["line"]:
                print("    offending line: %s" % f["line"].strip(), file=sys.stderr)
        print("RULE GATE: FAIL -- %d violation(s) on %s" % (len(findings), target), file=sys.stderr)
        return 2

    for number, title in RULES:
        print("%s %s .......... OK (no detector fired)" % (number, title))
    print("RULE GATE: PASS -- %s satisfies R1 NO EARNING ACTION, R2 ONCE PER DAY, "
          "R3 NOTIFY ON CHANGE, R4 APPROVAL BEFORE EXTERNAL ACTION (%d source files scanned)"
          % (target, len(files)))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
