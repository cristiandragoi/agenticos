#!/usr/bin/env python
"""test_identity_allowlist.py -- R4 identity: ONE test, BOTH directions.

Proves, in a single run, that the human-approval decider guard is an
operator-owned ALLOWLIST and that it FAILS CLOSED:

  DIRECTION 1 (refusal):  'hermes-agent', 'assistant', 'the monitor' and any
                          not-allowlisted name are REFUSED (exit 4); and an
                          allowlist that is missing / malformed / empty /
                          tampered-with-a-machine-entry refuses EVERY decider.
                          A refused decision leaves the item PENDING and writes
                          nothing to approvals/decided.jsonl.
  DIRECTION 2 (accept):   the one configured human name is ACCEPTED (exit 0),
                          recorded with that name -- and the item stays frozen:
                          execution_state=NOT_EXECUTED, execution_allowed=False,
                          expires_at_utc=None.

Scope: runs the PROPOSED module (proposed/approval_queue.py) against THROWAWAY
state roots only (FREECASH_DATA_ROOT under %LOCALAPPDATA%\\Temp). It never
touches monitoring/freecash or data/freecash-monitor.

'Alice Operator' is an obviously SYNTHETIC name. No real person's name is used.
"""

import json
import os
import shutil
import subprocess
import sys

PY = "C:/Users/cd-pr/AppData/Local/hermes/hermes-agent/venv/Scripts/python.exe"
PKG = "D:/AgenticOS/monitoring/freecash"                       # for `import paths`
HERE = os.path.dirname(os.path.abspath(__file__))
PROPOSED = os.path.join(HERE, "proposed")
MODULE = os.path.join(PROPOSED, "approval_queue.py")

TEMP = os.environ.get("LOCALAPPDATA", os.path.expanduser("~\\AppData\\Local")) + "/Temp"
THROW = "%s/fc-r3-identity-%d" % (TEMP, os.getpid())

SYNTHETIC_OPERATOR = "Alice Operator"                          # synthetic, not a real person
VALID_ALLOWLIST = json.dumps({"schema_version": 1, "operators": [SYNTHETIC_OPERATOR]}, indent=2)

RESULTS = []


def env_for(root):
    e = dict(os.environ)
    e["FREECASH_DATA_ROOT"] = root
    e["PYTHONPATH"] = PROPOSED + os.pathsep + PKG
    e["FREECASH_TOAST_STUB"] = "1"
    e.pop("FREECASH_OPERATOR_IDENTITY", None)
    return e


def seed(root):
    """Enqueue one real PENDING item and return its approval_id."""
    code = (
        "import approval_queue as aq; "
        "print(aq.enqueue('2026-10-01', {'dedupe_key': 'r3-identity-test'}, "
        "'R3 stream I: identity allowlist test')['approval_id'])"
    )
    out = subprocess.run([PY, "-c", code], cwd=root, env=env_for(root),
                         capture_output=True, text=True)
    assert out.returncode == 0, out.stderr
    return out.stdout.strip().splitlines()[-1]


def seed_allowlist(root, content):
    """Write the operator allowlist; content=None means 'absent'."""
    state = os.path.join(root, "state")
    os.makedirs(state, exist_ok=True)
    path = os.path.join(state, "human-deciders.json")
    if content is None:
        if os.path.exists(path):
            os.remove(path)
    else:
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(content)
    return path


def run_decide(root, approval_id, by, env_identity=None):
    env = env_for(root)
    if env_identity is not None:
        env["FREECASH_OPERATOR_IDENTITY"] = env_identity
    return subprocess.run(
        [PY, MODULE, "decide", "--id", approval_id, "--decision", "approve",
         "--by", by, "--note", "reviewed by the test"],
        cwd=root, env=env, capture_output=True, text=True,
    )


def read_state(root, approval_id):
    with open(os.path.join(root, "approvals", "pending.json"), "r", encoding="utf-8") as fh:
        doc = json.load(fh)
    item = next(i for i in doc["items"] if i["approval_id"] == approval_id)
    trail = os.path.join(root, "approvals", "decided.jsonl")
    lines = 0
    record = None
    if os.path.exists(trail):
        with open(trail, "r", encoding="utf-8") as fh:
            for raw in fh:
                if raw.strip():
                    lines += 1
                    record = json.loads(raw)
    return item, lines, record


def report(case, root, approval_id, proc, item, lines, expect, checks):
    ok = all(checks.values())
    RESULTS.append((case, ok))
    print("")
    print("--------------------------------------------------------------------------------")
    print("CASE %s   (expect: %s)" % (case, expect))
    print("  allowlist : %s" % os.path.join(root, "state", "human-deciders.json"))
    print("  $ python %s decide --id %s --decision approve --by %r --note '...'"
          % (MODULE, approval_id, checks.get("_by", "")))
    print("  exit_code = %d" % proc.returncode)
    if proc.stdout.strip():
        for line in proc.stdout.strip().splitlines():
            print("  stdout    : %s" % line)
    if proc.stderr.strip():
        for line in proc.stderr.strip().splitlines():
            print("  stderr    : %s" % line)
    print("  item      : status=%s decided_by=%r expires_at_utc=%r execution_state=%s execution_allowed=%s"
          % (item["status"], item["decided_by"], item["expires_at_utc"],
             item["execution_state"], item["execution_allowed_by_this_routine"]))
    print("  trail     : approvals/decided.jsonl lines=%d" % lines)
    for key in sorted(k for k in checks if not k.startswith("_")):
        print("  check %-26s %s" % (key, "ok" if checks[key] else "FAIL"))
    print("  VERDICT   : %s" % ("PASS" if ok else "FAIL"))


# ============================================================ DIRECTION 1: REFUSAL
print("################################################################################")
print("# DIRECTION 1 of 2 -- REFUSAL: a machine (or an unconfigured/tampered allowlist)")
print("# may NOT sign. Every case must exit 4 and leave the item PENDING.")
print("################################################################################")

REFUSAL = [
    # case                allowlist content                     decider            env
    ("REF-1 hermes-agent", VALID_ALLOWLIST,                     "hermes-agent",    None),
    ("REF-2 assistant",    VALID_ALLOWLIST,                     "assistant",       None),
    ("REF-3 the monitor",  VALID_ALLOWLIST,                     "the monitor",     None),
    ("REF-4 unconfigured", None,                                SYNTHETIC_OPERATOR, None),
    ("REF-5 corrupt",      "{ this is not valid json ",         SYNTHETIC_OPERATOR, None),
    ("REF-6 empty list",   json.dumps({"schema_version": 1, "operators": []}), SYNTHETIC_OPERATOR, None),
    ("REF-7 tampered",     json.dumps({"schema_version": 1, "operators": ["hermes-agent"]}), "hermes-agent", None),
    ("REF-8 wrong-schema", json.dumps({"schema_version": 99, "operators": [SYNTHETIC_OPERATOR]}), SYNTHETIC_OPERATOR, None),
    ("REF-9 env machine",  None,                                "hermes-agent",    "hermes-agent"),
    # These two are the OLD DEFECT: the denylist accepted 'Claude' and 'operator-1'
    # as humans. They are refused here by ALLOWLIST MEMBERSHIP, not by a word list.
    ("REF-10 unlisted Claude",  VALID_ALLOWLIST,                "Claude",          None),
    ("REF-11 unlisted op-1",    VALID_ALLOWLIST,                "operator-1",      None),
]

for case, content, by, env_identity in REFUSAL:
    root = "%s/%s" % (THROW, case.split()[0])
    shutil.rmtree(root, ignore_errors=True)
    os.makedirs(root, exist_ok=True)
    seed_allowlist(root, content)
    approval_id = seed(root)
    proc = run_decide(root, approval_id, by, env_identity=env_identity)
    item, lines, _ = read_state(root, approval_id)
    checks = {
        "_by": by,
        "exit_is_4": proc.returncode == 4,
        "printed_REFUSED": "REFUSED" in proc.stderr,
        "item_still_PENDING": item["status"] == "PENDING",
        "no_decider_recorded": item["decided_by"] is None,
        "nothing_in_trail": lines == 0,
        "frozen_expiry_null": item["expires_at_utc"] is None,
        "frozen_not_executed": item["execution_state"] == "NOT_EXECUTED",
        "frozen_not_allowed": item["execution_allowed_by_this_routine"] is False,
    }
    report(case, root, approval_id, proc, item, lines, "REFUSED", checks)

# ============================================================ DIRECTION 2: ACCEPT
print("")
print("################################################################################")
print("# DIRECTION 2 of 2 -- ACCEPT: the one configured human name IS recorded --")
print("# and the approved item is still inert (NOT_EXECUTED, no expiry).")
print("################################################################################")

ACCOUNT = [
    # case                          allowlist        decider            env
    ("ACC-1 file allowlist",        VALID_ALLOWLIST, SYNTHETIC_OPERATOR, None),
    ("ACC-2 case-insensitive",      VALID_ALLOWLIST, "alice operator",   None),
    ("ACC-3 env override",          None,            SYNTHETIC_OPERATOR, SYNTHETIC_OPERATOR),
]

for case, content, by, env_identity in ACCOUNT:
    root = "%s/%s" % (THROW, case.split()[0])
    shutil.rmtree(root, ignore_errors=True)
    os.makedirs(root, exist_ok=True)
    seed_allowlist(root, content)
    approval_id = seed(root)
    proc = run_decide(root, approval_id, by, env_identity=env_identity)
    item, lines, record = read_state(root, approval_id)
    # A recorded human decision may never arm the item -- re-check with `list`.
    listed = subprocess.run([PY, MODULE, "list"], cwd=root, env=env_for(root),
                            capture_output=True, text=True)
    listed_line = [l for l in listed.stdout.splitlines() if approval_id in l]
    checks = {
        "_by": by,
        "exit_is_0": proc.returncode == 0,
        "recorded_APPROVED": item["status"] == "APPROVED",
        "decided_by_is_human": item["decided_by"] == by,
        "trail_has_one_line": lines == 1,
        "trail_names_human": (record or {}).get("decided_by") == by,
        "frozen_expiry_null": item["expires_at_utc"] is None,
        "frozen_not_executed": item["execution_state"] == "NOT_EXECUTED",
        "frozen_not_allowed": item["execution_allowed_by_this_routine"] is False,
        "list_still_NOT_EXECUTED": bool(listed_line) and "NOT_EXECUTED" in listed_line[0] and "expires_at_utc=None" in listed_line[0],
    }
    report(case, root, approval_id, proc, item, lines, "ACCEPTED", checks)

# ============================================================ summary
print("")
print("################################################################################")
ref = [c for c, ok in RESULTS if c.startswith("REF")]
acc = [c for c, ok in RESULTS if c.startswith("ACC")]
failed = [c for c, ok in RESULTS if not ok]
print("# BOTH DIRECTIONS IN ONE RUN")
print("#   refusal cases : %d (%d passed)" % (len(ref), len([c for c in ref if dict(RESULTS)[c]])))
print("#   accept  cases : %d (%d passed)" % (len(acc), len([c for c in acc if dict(RESULTS)[c]])))
print("#   throwaway root: %s" % THROW)
print("#   production root %s was never referenced." % "D:/AgenticOS/data/freecash-monitor")
print("# RESUMEN: cases=%d failures=%d -> %s"
      % (len(RESULTS), len(failed), "ALL PASS" if not failed else "FAILURES: " + ",".join(failed)))
print("################################################################################")
sys.exit(0 if not failed else 1)
