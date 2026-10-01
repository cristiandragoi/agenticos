#!/usr/bin/env python
"""test_identity_both_directions.py -- R4 identity: BOTH DIRECTIONS in ONE RUN,
plus the SAFETY property proven separately from the ATTRIBUTION property.

Rule under work (operator numbering): **R4 -- human approval before ANY external
action; nothing auto-executes.**  Always carry the title with the number: the
shipped gate.py/readonly_client.py docstrings invert R1/R2, not R4.

Two DIFFERENT properties are proven here, in two independent phases:

  (1) ATTRIBUTION -- "only a human can sign a decision"
      PHASE A (DIRECTION 1, REFUSAL): 'hermes-agent', 'assistant', 'claude',
        'Claude', 'the monitor', an unlisted human name, and every
        absent/corrupt/empty/out-of-schema/tampered allowlist -> exit 4, item
        stays PENDING, no decider recorded, approvals/decided.jsonl untouched.
      PHASE B (DIRECTION 2, ACCEPTANCE): the operator name carried by the
        delivered example allowlist file (proposed/human-deciders.example.json)
        -> exit 0, recorded as decided_by.
      A PASS in Phase A proves nothing about Phase B and vice versa; both must
      pass in the SAME run.

  (2) SAFETY -- "an approval can never arm an action"
      PHASE C proves the frozen triple (execution_state=NOT_EXECUTED,
      execution_allowed_by_this_routine=False, expires_at_utc=None) survives
      even when a decider name is WRONGLY ACCEPTED, and that no code path
      converts a PENDING or APPROVED item into execution:
        SAFE-1 an allowlist that wrongly lists a second, non-operator human name
               -> ACCEPTED (attribution failure) yet the item stays inert;
        SAFE-2 the identity guard monkeypatched away entirely, decide() called
               with by='hermes-agent' -> ACCEPTED, item still inert;
        SAFE-3 a crafted APPROVED item AND a crafted PENDING item, both bearing
               a past expires_at_utc: a full routine run + watchdog + nag + list
               must leave approvals/pending.json BYTE-IDENTICAL and must not put
               the token EXECUTED anywhere in the state tree;
        SAFE-4 static: every write site in the package is enumerated from the
               AST and every module is scanned for an executable state token.

Scope: runs a COPY of the routine (work/repo-proposed/monitoring/freecash, whose
approval_queue.py is byte-identical to proposed/approval_queue.py) against
THROWAWAY state roots only (FREECASH_DATA_ROOT under %LOCALAPPDATA%\\Temp).  It
never touches monitoring/freecash or data/freecash-monitor.

'hermes-agent', 'assistant', 'claude' are machine identity strings, not people.
'Erika Mustermann' is the standard German fictitious name (the equivalent of
'Jane Doe'); 'Nom De Plume' is equally fictitious.  No real person's name
appears in this file.
"""

import ast
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys

PY = "C:/Users/cd-pr/AppData/Local/hermes/hermes-agent/venv/Scripts/python.exe"
HERE = os.path.dirname(os.path.abspath(__file__))
PROPOSED_DIR = os.path.join(HERE, "proposed")
PROPOSED_MODULE = os.path.join(PROPOSED_DIR, "approval_queue.py")
EXAMPLE_ALLOWLIST = os.path.join(PROPOSED_DIR, "human-deciders.example.json")

PKG = os.path.join(HERE, "work", "repo-proposed", "monitoring", "freecash")
MODULE = os.path.join(PKG, "approval_queue.py")          # the module under test
RUN_DAILY = os.path.join(PKG, "run_daily_check.py")
WATCHDOG = os.path.join(PKG, "watchdog.py")

TEMP = os.environ.get("LOCALAPPDATA", os.path.expanduser("~\\AppData\\Local")) + "/Temp"
THROW = "%s/fc-r4-identity-%d" % (TEMP, os.getpid())

OPERATOR = "Erika Mustermann"          # synthetic; must match the example file
SECOND_HUMAN = "Nom De Plume"          # synthetic; deliberately WRONG allowlist entry
UNLISTED = "Bob Smith"                 # synthetic; never allowlisted

RESULTS = []
CLI_LOG = []


# --------------------------------------------------------------------------- env


def env_for(root, identity=None):
    env = dict(os.environ)
    env["FREECASH_DATA_ROOT"] = root
    env["PYTHONPATH"] = PKG
    env["FREECASH_TZ"] = "Europe/Berlin"
    env["FREECASH_TOAST_STUB"] = "1"
    env["FREECASH_TOAST_RETRY_SLEEP_SECONDS"] = "0"
    env.pop("FREECASH_OPERATOR_IDENTITY", None)
    if identity is not None:
        env["FREECASH_OPERATOR_IDENTITY"] = identity
    return env


def fresh_root(case):
    root = "%s/%s" % (THROW, case)
    shutil.rmtree(root, ignore_errors=True)
    os.makedirs(root, exist_ok=True)
    return root


def write_allowlist(root, content):
    """content=None means 'the file is absent'."""
    state = os.path.join(root, "state")
    os.makedirs(state, exist_ok=True)
    path = os.path.join(state, "human-deciders.json")
    if content is None:
        if os.path.exists(path):
            os.remove(path)
    else:
        with open(path, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(content)
    return path


def seed_item(root, day="2026-10-01"):
    """Enqueue one real PENDING item through the module under test."""
    code = (
        "import approval_queue as aq; "
        "print(aq.enqueue(%r, {'dedupe_key': 'r4-identity-test'}, 'R4 stream I: identity test')['approval_id'])"
        % day
    )
    proc = subprocess.run([PY, "-c", code], cwd=root, env=env_for(root),
                          capture_output=True, text=True)
    if proc.returncode != 0:
        raise AssertionError("seed failed: %s" % proc.stderr)
    return proc.stdout.strip().splitlines()[-1]


def run_cli(root, argv, identity=None):
    cmd = [PY, MODULE] + list(argv)
    proc = subprocess.run(cmd, cwd=root, env=env_for(root, identity),
                          capture_output=True, text=True)
    CLI_LOG.append((" ".join(cmd), proc.returncode,
                    proc.stdout.strip(), proc.stderr.strip()))
    return proc


def run_script(root, script, argv=(), identity=None):
    cmd = [PY, script] + list(argv)
    proc = subprocess.run(cmd, cwd=root, env=env_for(root, identity),
                          capture_output=True, text=True)
    CLI_LOG.append((" ".join(cmd), proc.returncode,
                    proc.stdout.strip(), proc.stderr.strip()))
    return proc


def read_item(root, approval_id):
    path = os.path.join(root, "approvals", "pending.json")
    with open(path, "r", encoding="utf-8") as fh:
        doc = json.load(fh)
    return next(i for i in doc["items"] if i["approval_id"] == approval_id), doc


def trail_lines(root):
    path = os.path.join(root, "approvals", "decided.jsonl")
    if not os.path.exists(path):
        return []
    with open(path, "r", encoding="utf-8") as fh:
        return [json.loads(line) for line in fh if line.strip()]


def frozen(item):
    return (item.get("expires_at_utc") is None
            and item.get("execution_state") == "NOT_EXECUTED"
            and item.get("execution_allowed_by_this_routine") is False)


def report(label, expect, proc, checks, extra=""):
    ok = all(checks.values())
    RESULTS.append((label, ok))
    print("")
    print("-" * 88)
    print("CASE %s   (expect: %s)" % (label, expect))
    print("  $ %s" % " ".join([PY, MODULE] + list(proc.args[2:]) if isinstance(proc.args, (list, tuple)) else proc.args))
    print("  exit_code = %d" % proc.returncode)
    for line in (proc.stdout or "").strip().splitlines():
        print("  stdout    : %s" % line)
    for line in (proc.stderr or "").strip().splitlines():
        print("  stderr    : %s" % line)
    if extra:
        for line in extra.splitlines():
            print("  %s" % line)
    for key in sorted(k for k in checks if not k.startswith("_")):
        print("  check %-30s %s" % (key, "ok" if checks[key] else "FAIL"))
    print("  VERDICT   : %s" % ("PASS" if ok else "FAIL"))


# --------------------------------------------------------------------------- setup

with open(EXAMPLE_ALLOWLIST, "r", encoding="utf-8") as fh:
    EXAMPLE_TEXT = fh.read()
EXAMPLE_DOC = json.loads(EXAMPLE_TEXT)
assert EXAMPLE_DOC["operators"] == [OPERATOR], EXAMPLE_DOC

prop_sha = hashlib.sha256(open(PROPOSED_MODULE, "rb").read()).hexdigest()
mod_sha = hashlib.sha256(open(MODULE, "rb").read()).hexdigest()
assert prop_sha == mod_sha, ("the module under test is not the proposed module",
                             prop_sha, mod_sha)

print("################################################################################")
print("# R4 identity -- BOTH DIRECTIONS IN ONE RUN")
print("#   proposed module   : %s" % PROPOSED_MODULE)
print("#   module under test : %s" % MODULE)
print("#   sha256 (both)     : %s" % mod_sha)
print("#   example allowlist : %s" % EXAMPLE_ALLOWLIST)
print("#   operator identity : %r  (synthetic, from the example allowlist)" % OPERATOR)
print("#   throwaway root    : %s" % THROW)
print("#   production root D:/AgenticOS/data/freecash-monitor is never referenced.")
print("################################################################################")

# ============================================================ PHASE A: REFUSAL
print("")
print("################################################################################")
print("# PROPERTY 1 -- ATTRIBUTION  /  DIRECTION 1 of 2 -- REFUSAL")
print("# A machine, an unlisted name, or an unusable allowlist may NOT sign.")
print("# Every case must exit 4, leave the item PENDING and write no decision trail.")
print("################################################################################")

REFUSAL = [
    # label                         allowlist content                          decider     env
    ("REF-01 hermes-agent",         EXAMPLE_TEXT,                              "hermes-agent", None),
    ("REF-02 assistant",            EXAMPLE_TEXT,                              "assistant", None),
    ("REF-03 claude",               EXAMPLE_TEXT,                              "claude", None),
    ("REF-04 Claude casing",        EXAMPLE_TEXT,                              "Claude", None),
    ("REF-05 the monitor",          EXAMPLE_TEXT,                              "the monitor", None),
    ("REF-06 unconfigured",         None,                                      OPERATOR,  None),
    ("REF-07 corrupt JSON",         "{ this is not valid json ",               OPERATOR,  None),
    ("REF-08 empty operators",      json.dumps({"schema_version": 1, "operators": []}), OPERATOR, None),
    ("REF-09 wrong schema",         json.dumps({"schema_version": 99, "operators": [OPERATOR]}), OPERATOR, None),
    ("REF-10 tampered hermes",      json.dumps({"schema_version": 1, "operators": ["hermes-agent"]}), "hermes-agent", None),
    ("REF-11 tampered Claude",      json.dumps({"schema_version": 1, "operators": ["Claude"]}), "Claude", None),
    ("REF-12 unlisted human",       EXAMPLE_TEXT,                              UNLISTED,  None),
    ("REF-13 env machine",          None,                                      "hermes-agent", "hermes-agent"),
]

for label, content, by, identity in REFUSAL:
    root = fresh_root(label.split()[0])
    write_allowlist(root, content)
    approval_id = seed_item(root)
    proc = run_cli(root, ["decide", "--id", approval_id, "--decision", "approve",
                          "--by", by, "--note", "attempted by the test"], identity=identity)
    item, _doc = read_item(root, approval_id)
    trail = trail_lines(root)
    extra = ("  allowlist : %s\n  item      : status=%s decided_by=%r expires_at_utc=%r "
             "execution_state=%s execution_allowed=%s\n  trail     : approvals/decided.jsonl lines=%d%s"
             % (write_allowlist(root, content), item["status"], item["decided_by"],
                item["expires_at_utc"], item["execution_state"],
                item["execution_allowed_by_this_routine"], len(trail),
                ("\n  trail[0]  : decided_by=%r expires_at_utc=%r execution_state=%s"
                 % (trail[0].get("decided_by"), trail[0].get("expires_at_utc"),
                    trail[0].get("execution_state"))) if trail else ""))
    checks = {
        "_by": by,
        "exit_is_4": proc.returncode == 4,
        "printed_REFUSED": "REFUSED" in proc.stderr,
        "item_still_PENDING": item["status"] == "PENDING",
        "no_decider_recorded": item["decided_by"] is None,
        "nothing_in_trail": len(trail) == 0,
        "frozen_expiry_null": item["expires_at_utc"] is None,
        "frozen_not_executed": item["execution_state"] == "NOT_EXECUTED",
        "frozen_not_allowed": item["execution_allowed_by_this_routine"] is False,
    }
    report(label, "REFUSED (exit 4)", proc, checks, extra)

# ============================================================ PHASE B: ACCEPT
print("")
print("################################################################################")
print("# PROPERTY 1 -- ATTRIBUTION  /  DIRECTION 2 of 2 -- ACCEPTANCE")
print("# The operator name carried by the DELIVERED example allowlist IS recorded --")
print("# and the approved item is still inert (NOT_EXECUTED, no expiry, not allowed).")
print("################################################################################")

ACCEPT = [
    ("ACC-01 operator name",     EXAMPLE_TEXT, OPERATOR,           None),
    ("ACC-02 case-insensitive",  EXAMPLE_TEXT, "erika mustermann", None),
    ("ACC-03 env override",      None,         OPERATOR,           OPERATOR),
]

for label, content, by, identity in ACCEPT:
    root = fresh_root(label.split()[0])
    write_allowlist(root, content)
    approval_id = seed_item(root)
    proc = run_cli(root, ["decide", "--id", approval_id, "--decision", "approve",
                          "--by", by, "--note", "checked the figures myself"], identity=identity)
    item, _doc = read_item(root, approval_id)
    trail = trail_lines(root)
    listed = run_cli(root, ["list"], identity=identity)
    listed_line = [l for l in listed.stdout.splitlines() if approval_id in l]
    extra = ("  allowlist : %s\n  item      : status=%s decided_by=%r expires_at_utc=%r "
             "execution_state=%s execution_allowed=%s\n  trail     : approvals/decided.jsonl lines=%d\n"
             "  trail[0]  : decided_by=%r expires_at_utc=%r execution_state=%s\n"
             "  list      : %s"
             % (write_allowlist(root, content), item["status"], item["decided_by"],
                item["expires_at_utc"], item["execution_state"],
                item["execution_allowed_by_this_routine"], len(trail),
                (trail[0].get("decided_by") if trail else None),
                (trail[0].get("expires_at_utc") if trail else None),
                (trail[0].get("execution_state") if trail else None),
                listed_line[0] if listed_line else "<absent>"))
    checks = {
        "_by": by,
        "exit_is_0": proc.returncode == 0,
        "recorded_APPROVED": item["status"] == "APPROVED",
        "decided_by_is_the_name": item["decided_by"] == by,
        "trail_has_one_line": len(trail) == 1,
        "trail_names_signer": (trail[0].get("decided_by") if trail else None) == by,
        "frozen_expiry_null": item["expires_at_utc"] is None,
        "frozen_not_executed": item["execution_state"] == "NOT_EXECUTED",
        "frozen_not_allowed": item["execution_allowed_by_this_routine"] is False,
        "trail_frozen": bool(trail) and trail[0].get("expires_at_utc") is None
                        and trail[0].get("execution_state") == "NOT_EXECUTED"
                        and trail[0].get("execution_allowed_by_this_routine") is False,
        "list_still_NOT_EXECUTED": bool(listed_line) and "NOT_EXECUTED" in listed_line[0]
                                   and "expires_at_utc=None" in listed_line[0],
    }
    report(label, "ACCEPTED (exit 0)", proc, checks, extra)

# read-only allowlist verb
root = fresh_root("ACC-04")
write_allowlist(root, EXAMPLE_TEXT)
proc = run_cli(root, ["allowlist"])
checks = {
    "exit_is_0": proc.returncode == 0,
    "names_the_path": "human-deciders.json" in proc.stdout,
    "shows_the_operator": OPERATOR in proc.stdout,
    "reports_CONFIGURED": "CONFIGURED (1 identity/ies)" in proc.stdout,
    "creates_no_queue": not os.path.exists(os.path.join(root, "approvals")),
}
report("ACC-04 allowlist verb (read-only)", "CONFIGURED, no side effect", proc, checks,
       "  allowlist : %s" % os.path.join(root, "state", "human-deciders.json"))

# ============================================================ PHASE C: SAFETY
print("")
print("################################################################################")
print("# PROPERTY 2 -- SAFETY  (independent of PROPERTY 1)")
print("# An approval can never arm an action.  Proven even when the decider guard is")
print("# WRONGLY satisfied, and by enumerating every write site in the package.")
print("################################################################################")

# ---- SAFE-1: a wrongly-accepted, non-operator human name
label = "SAFE-01 wrongly-accepted decider"
root = fresh_root("SAFE-01")
wrong = json.dumps({"schema_version": 1, "operators": [OPERATOR, SECOND_HUMAN]}, indent=2)
write_allowlist(root, wrong)
approval_id = seed_item(root)
proc = run_cli(root, ["decide", "--id", approval_id, "--decision", "approve",
                      "--by", SECOND_HUMAN, "--note", "a second allowlisted name signs"])
item, _doc = read_item(root, approval_id)
trail = trail_lines(root)
listed = run_cli(root, ["list"])
listed_line = [l for l in listed.stdout.splitlines() if approval_id in l]
extra = ("  allowlist : %s  (deliberately WRONG: it also lists %r)\n"
         "  item      : status=%s decided_by=%r expires_at_utc=%r execution_state=%s execution_allowed=%s\n"
         "  trail[0]  : expires_at_utc=%r execution_state=%s execution_allowed=%s\n"
         "  list      : %s"
         % (write_allowlist(root, wrong), SECOND_HUMAN, item["status"], item["decided_by"],
            item["expires_at_utc"], item["execution_state"],
            item["execution_allowed_by_this_routine"],
            (trail[0].get("expires_at_utc") if trail else None),
            (trail[0].get("execution_state") if trail else None),
            (trail[0].get("execution_allowed_by_this_routine") if trail else None),
            listed_line[0] if listed_line else "<absent>"))
checks = {
    "attribution_accepted_wrongly": proc.returncode == 0 and item["status"] == "APPROVED",
    "signer_is_not_the_operator": item["decided_by"] == SECOND_HUMAN,
    "SAFETY_frozen_expiry_null": item["expires_at_utc"] is None,
    "SAFETY_frozen_not_executed": item["execution_state"] == "NOT_EXECUTED",
    "SAFETY_frozen_not_allowed": item["execution_allowed_by_this_routine"] is False,
    "SAFETY_trail_frozen": bool(trail) and trail[0].get("expires_at_utc") is None
                           and trail[0].get("execution_state") == "NOT_EXECUTED",
    "SAFETY_list_still_inert": bool(listed_line) and "NOT_EXECUTED" in listed_line[0],
}
report(label, "accepted yet inert", proc, checks, extra)

# ---- SAFE-2: the identity guard removed entirely (in-process)
print("")
print("-" * 88)
print("CASE SAFE-02 guard removed entirely (in-process)   (expect: accepted yet inert)")
root = fresh_root("SAFE-02")
write_allowlist(root, None)
os.environ["FREECASH_DATA_ROOT"] = root
os.environ.pop("FREECASH_OPERATOR_IDENTITY", None)
if PKG not in sys.path:
    sys.path.insert(0, PKG)
import approval_queue as aq                                        # noqa: E402
print("  module under test : %s" % aq.__file__)
assert os.path.normcase(os.path.abspath(aq.__file__)) == os.path.normcase(os.path.abspath(MODULE)), aq.__file__
_item = aq.enqueue("2026-10-01", {"dedupe_key": "safe-02"}, "guard-removed proof")
_aid = _item["approval_id"]
_orig = aq._normalise_decider
aq._normalise_decider = lambda name: (name or "").strip()          # guard switched OFF
try:
    _decided = aq.decide(_aid, "approve", "hermes-agent", "guard switched off on purpose")
finally:
    aq._normalise_decider = _orig
with open(os.path.join(root, "approvals", "pending.json"), encoding="utf-8") as fh:
    _doc = json.load(fh)
_item2 = next(i for i in _doc["items"] if i["approval_id"] == _aid)
with open(os.path.join(root, "approvals", "decided.jsonl"), encoding="utf-8") as fh:
    _rec = json.loads([l for l in fh if l.strip()][-1])
print("  guard off: _normalise_decider returned %r" % (_decided["decided_by"],))
print("  item      : status=%s decided_by=%r expires_at_utc=%r execution_state=%s execution_allowed=%s"
      % (_item2["status"], _item2["decided_by"], _item2["expires_at_utc"],
         _item2["execution_state"], _item2["execution_allowed_by_this_routine"]))
print("  trail[0]  : decided_by=%r expires_at_utc=%r execution_state=%s execution_allowed=%s"
      % (_rec.get("decided_by"), _rec.get("expires_at_utc"),
         _rec.get("execution_state"), _rec.get("execution_allowed_by_this_routine")))
_safe2 = {
    "guard_off_accepted": _item2["status"] == "APPROVED" and _item2["decided_by"] == "hermes-agent",
    "SAFETY_frozen_expiry_null": _item2["expires_at_utc"] is None,
    "SAFETY_frozen_not_executed": _item2["execution_state"] == "NOT_EXECUTED",
    "SAFETY_frozen_not_allowed": _item2["execution_allowed_by_this_routine"] is False,
    "SAFETY_trail_frozen": _rec.get("expires_at_utc") is None
                           and _rec.get("execution_state") == "NOT_EXECUTED"
                           and _rec.get("execution_allowed_by_this_routine") is False,
}
for _k in sorted(_safe2):
    print("  check %-30s %s" % (_k, "ok" if _safe2[_k] else "FAIL"))
print("  VERDICT   : %s" % ("PASS" if all(_safe2.values()) else "FAIL"))
RESULTS.append(("SAFE-02 guard removed entirely", all(_safe2.values())))
os.environ.pop("FREECASH_DATA_ROOT", None)

# ---- SAFE-3: a crafted APPROVED item and a crafted PENDING item, both long expired
print("")
print("-" * 88)
print("CASE SAFE-03 past-expiry APPROVED + PENDING items survive a full run   (expect: byte-identical)")
root = fresh_root("SAFE-03")
os.makedirs(os.path.join(root, "approvals"), exist_ok=True)
crafted = {
    "schema_version": 1,
    "updated_at_utc": "2026-01-01T00:00:00Z",
    "items": [
        {
            "approval_id": "aaaaaaaa-0000-0000-0000-000000000001",
            "created_at_utc": "2025-12-01T08:00:00Z", "day_key": "2025-12-01",
            "change_dedupe_key": "deadbeef01", "reason": "crafted: APPROVED long ago",
            "proposed_action": {"action_type": "OPERATOR_REVIEW", "amount_cents": 315},
            "status": "APPROVED", "status_reason": "approved long ago",
            "decided_at_utc": "2025-12-01T09:00:00Z", "decided_by": "Erika Mustermann",
            "decision_note": "approved at the time",
            "expires_at_utc": "2025-12-08T09:00:00Z",
            "execution_state": "NOT_EXECUTED", "execution_allowed_by_this_routine": False,
        },
        {
            "approval_id": "bbbbbbbb-0000-0000-0000-000000000002",
            "created_at_utc": "2025-12-01T08:00:00Z", "day_key": "2025-12-02",
            "change_dedupe_key": "deadbeef02", "reason": "crafted: PENDING long ago",
            "proposed_action": {"action_type": "OPERATOR_REVIEW", "amount_cents": 999},
            "status": "PENDING", "status_reason": None,
            "decided_at_utc": None, "decided_by": None, "decision_note": None,
            "expires_at_utc": "2025-12-09T09:00:00Z",
            "execution_state": "NOT_EXECUTED", "execution_allowed_by_this_routine": False,
        },
    ],
}
ppath = os.path.join(root, "approvals", "pending.json")
with open(ppath, "w", encoding="utf-8", newline="\n") as fh:
    json.dump(crafted, fh, indent=2)
before = hashlib.sha256(open(ppath, "rb").read()).hexdigest()

run1 = run_script(root, RUN_DAILY)
run2 = run_script(root, WATCHDOG)
run3 = run_script(root, MODULE, ["list"])
after = hashlib.sha256(open(ppath, "rb").read()).hexdigest()
with open(ppath, encoding="utf-8") as fh:
    doc = json.load(fh)

# the token EXECUTED (not part of NOT_EXECUTED) must not exist anywhere in the root
leaks = []
for dirpath, _dirnames, filenames in os.walk(root):
    for name in filenames:
        full = os.path.join(dirpath, name)
        try:
            text = open(full, "r", encoding="utf-8", errors="replace").read()
        except OSError:
            continue
        for hit in re.findall(r"(?<!NOT_)EXECUTED", text):
            leaks.append("%s: %s" % (full, hit))

print("  $ %s %s" % (PY, RUN_DAILY))
print("  exit_code = %d ; stdout: %s" % (run1.returncode, run1.stdout.strip().splitlines()))
print("  $ %s %s" % (PY, WATCHDOG))
print("  exit_code = %d ; stdout: %s" % (run2.returncode, run2.stdout.strip().splitlines()))
print("  $ %s %s list" % (PY, MODULE))
print("  exit_code = %d ; stdout:" % run3.returncode)
for line in run3.stdout.strip().splitlines():
    print("    %s" % line)
print("  approvals/pending.json sha256 before = %s" % before)
print("  approvals/pending.json sha256 after  = %s" % after)
print("  items after run: %s" % [(i["status"], i["expires_at_utc"], i["execution_state"]) for i in doc["items"]])
print("  EXECUTED-token leaks in the state root: %d %s" % (len(leaks), leaks))
_safe3 = {
    "routine_exit_0": run1.returncode == 0,
    "watchdog_exit_0": run2.returncode == 0,
    "list_exit_0": run3.returncode == 0,
    "pending_json_byte_identical": before == after,
    "approved_item_unchanged": doc["items"][0]["status"] == "APPROVED"
                               and doc["items"][0]["expires_at_utc"] == "2025-12-08T09:00:00Z"
                               and doc["items"][0]["execution_state"] == "NOT_EXECUTED",
    "pending_item_unchanged": doc["items"][1]["status"] == "PENDING"
                              and doc["items"][1]["expires_at_utc"] == "2025-12-09T09:00:00Z"
                              and doc["items"][1]["execution_state"] == "NOT_EXECUTED",
    "no_EXECUTED_token_anywhere": leaks == [],
}
for _k in sorted(_safe3):
    print("  check %-30s %s" % (_k, "ok" if _safe3[_k] else "FAIL"))
print("  VERDICT   : %s" % ("PASS" if all(_safe3.values()) else "FAIL"))
RESULTS.append(("SAFE-03 past-expiry items inert", all(_safe3.values())))

# ---- SAFE-4: static enumeration of every write site + executable token
print("")
print("-" * 88)
print("CASE SAFE-04 static: every write site in the package   (expect: none can arm)")
MODULE_FILES = ("paths.py", "gate.py", "readonly_client.py", "changedetect.py", "notify.py",
                "approval_queue.py", "watchdog.py", "verify_readonly.py", "run_daily_check.py",
                "operator_state.py")
EXECUTED_LITERAL = re.compile(r"(?<!NOT_)EXECUTED")
APPROVED_READ = re.compile(r"==\s*[\"']APPROVED[\"']")
FROZEN_FIELDS = ("execution_state", "expires_at_utc", "execution_allowed_by_this_routine")

all_writes = []          # every persistence call in the package (display form)
write_records = []       # (module, lineno, owner, target, full source segment)
queue_writes = []        # the subset that can touch approval-queue state
frozen_rhs = {}          # field -> the set of right-hand sides assigned anywhere
executor_defs = []       # functions whose name suggests acting on an approval
token_leaks = []
status_reads = []

for name in MODULE_FILES:
    src = open(os.path.join(PKG, name), encoding="utf-8").read()
    tree = ast.parse(src, filename=name)
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            if re.match(r".*(execute|arm_item|perform_action|run_action|payout|withdraw|claim)",
                        node.name, re.I):
                executor_defs.append("%s:%d def %s" % (name, node.lineno, node.name))
        # persistence calls
        if isinstance(node, ast.Call):
            fn = node.func
            target = fn.attr if isinstance(fn, ast.Attribute) else getattr(fn, "id", None)
            if target in ("save_document", "write_json_atomic", "append_jsonl"):
                seg = ast.get_source_segment(src, node) or ""
                owner = "<module>"
                for outer in ast.walk(tree):
                    if isinstance(outer, (ast.FunctionDef, ast.AsyncFunctionDef)):
                        if outer.lineno <= node.lineno and any(
                                isinstance(ch, ast.Call) and ch is node for ch in ast.walk(outer)):
                            owner = outer.name
                row = "%s:%d  in %s()  -> %s" % (name, node.lineno, owner, seg.splitlines()[0].strip())
                all_writes.append(row)
                write_records.append((name, node.lineno, owner, target, seg))
                if "pending_path" in seg or "decided_path" in seg or target == "save_document":
                    queue_writes.append(row)
        # assignments to the three frozen fields
        if isinstance(node, ast.Assign):
            for tgt in node.targets:
                if (isinstance(tgt, ast.Subscript) and isinstance(tgt.slice, ast.Constant)
                        and tgt.slice.value in FROZEN_FIELDS):
                    try:
                        rhs = ast.unparse(node.value)
                    except Exception:
                        rhs = "<unparsed>"
                    frozen_rhs.setdefault(tgt.slice.value, set()).add(rhs)
    for lineno, line in enumerate(src.splitlines(), start=1):
        if EXECUTED_LITERAL.search(line):
            token_leaks.append("%s:%d %s" % (name, lineno, line.strip()))
        if APPROVED_READ.search(line):
            status_reads.append("%s:%d %s" % (name, lineno, line.strip()))
        if 'execution_state"] =' in line:
            assert "EXECUTION_STATE_NOT_EXECUTED" in line, (name, lineno, line)
        if 'expires_at_utc"] =' in line:
            assert "NO_EXPIRY" in line, (name, lineno, line)
        if 'execution_allowed_by_this_routine"] =' in line:
            assert "EXECUTION_ALLOWED_BY_THIS_ROUTINE" in line, (name, lineno, line)

print("  EVERY persistence call in the package (AST), %d total:" % len(all_writes))
for line in all_writes:
    print("    %s" % line)
print("  QUEUE-state writes (the subset that can touch approvals/): %d" % len(queue_writes))
for line in queue_writes:
    print("    %s" % line)
save_document_callers = sorted({owner for _n, _l, owner, target, _s in write_records
                                if target == "save_document"})
pending_writers = sorted({owner for _n, _l, owner, target, seg in write_records
                          if "write_json_atomic(paths.pending_path()" in seg})
decided_appenders = sorted({owner for _n, _l, owner, target, seg in write_records
                            if "decided_path" in seg})
print("    save_document() is called from     : %s" % save_document_callers)
print("    functions that write pending.json  : %s" % pending_writers)
print("    functions that append decided.jsonl: %s" % decided_appenders)
print("  Frozen-field assignments, by field -> every right-hand side used:")
for field in FROZEN_FIELDS:
    print("    %-34s -> %s" % (field, sorted(frozen_rhs.get(field, set()))))
print("  Function names suggesting an execution of an approval: %d %s" % (len(executor_defs), executor_defs))
print("  modules scanned: %d" % len(MODULE_FILES))
print("  executable token 'EXECUTED' (excluding NOT_EXECUTED) found: %d %s" % (len(token_leaks), token_leaks))
print("  reads of an APPROVED status (== 'APPROVED'): %d %s" % (len(status_reads), status_reads))
_safe4 = {
    "no_executable_token": token_leaks == [],
    "no_module_reads_APPROVED_as_a_trigger": status_reads == [],
    "only_approval_queue_writes_queue_state": all(w.startswith("approval_queue.py:") for w in queue_writes),
    "one_primitive_writes_pending_json": pending_writers == ["save_document"],
    "save_document_called_only_by_enqueue_decide": save_document_callers == ["decide", "enqueue"],
    "only_decide_appends_the_trail": decided_appenders == ["decide"],
    "execution_state_is_only_ever_NOT_EXECUTED":
        frozen_rhs.get("execution_state", set()) == {"EXECUTION_STATE_NOT_EXECUTED"},
    "expires_at_utc_is_only_ever_NO_EXPIRY":
        frozen_rhs.get("expires_at_utc", set()) == {"NO_EXPIRY"},
    "execution_allowed_is_only_ever_False":
        frozen_rhs.get("execution_allowed_by_this_routine", set()) == {"EXECUTION_ALLOWED_BY_THIS_ROUTINE"},
    "no_function_can_execute_an_approval": executor_defs == [],
}
for _k in sorted(_safe4):
    print("  check %-30s %s" % (_k, "ok" if _safe4[_k] else "FAIL"))
print("  VERDICT   : %s" % ("PASS" if all(_safe4.values()) else "FAIL"))
RESULTS.append(("SAFE-04 static: no arming path", all(_safe4.values())))

# ============================================================ summary
print("")
print("################################################################################")
ref = [c for c, ok in RESULTS if c.startswith("REF")]
acc = [c for c, ok in RESULTS if c.startswith("ACC")]
safe = [c for c, ok in RESULTS if c.startswith("SAFE")]
failed = [c for c, ok in RESULTS if not ok]
print("# BOTH DIRECTIONS IN ONE RUN -- R4 'human approval before ANY external action'")
print("#   PROPERTY 1 ATTRIBUTION  refusal cases  : %d (%d passed)"
      % (len(ref), len([c for c in ref if dict(RESULTS)[c]])))
print("#   PROPERTY 1 ATTRIBUTION  accept  cases  : %d (%d passed)"
      % (len(acc), len([c for c in acc if dict(RESULTS)[c]])))
print("#   PROPERTY 2 SAFETY       cases          : %d (%d passed)"
      % (len(safe), len([c for c in safe if dict(RESULTS)[c]])))
print("#   cli invocations        : %d (every exit code printed above)" % len(CLI_LOG))
print("#   throwaway root         : %s" % THROW)
print("#   production root D:/AgenticOS/data/freecash-monitor was never referenced.")
print("# RESUMEN: cases=%d failures=%d -> %s"
      % (len(RESULTS), len(failed), "ALL PASS" if not failed else "FAILURES: " + ",".join(failed)))
print("################################################################################")
sys.exit(0 if not failed else 1)
