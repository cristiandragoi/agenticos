#!/usr/bin/env python
"""repro_live_denylist_defect.py -- the "before": the SHIPPED guard is a denylist.

Runs the shipped approval_queue.py (as a COPY under work/repo-live/) against
throwaway state roots and asks each of the machine identities the brief names to
sign a decision.  The shipped control is a frozenset of ten literal words, so
every identity below that is not one of those ten exact words is ACCEPTED:

    hermes-agent, assistant, claude, Claude, operator-1, the monitor

'agent' and 'monitor' (the bare words) are refused -- which is exactly why the
control is "some words are refused" and not "only a human may sign".

Nothing under monitoring/ or data/ is written; every root is throwaway.
"""

import json
import os
import shutil
import subprocess
import sys

PY = "C:/Users/cd-pr/AppData/Local/hermes/hermes-agent/venv/Scripts/python.exe"
HERE = os.path.dirname(os.path.abspath(__file__))
if len(sys.argv) > 1:
    PKG = sys.argv[1]
    LABEL = sys.argv[2] if len(sys.argv) > 2 else os.path.basename(PKG)
else:                                                       # default: the shipped copy
    PKG = os.path.join(HERE, "work", "repo-live", "monitoring", "freecash")
    LABEL = "shipped copy (work/repo-live)"
ALLOWLIST_SRC = sys.argv[3] if len(sys.argv) > 3 else None  # optional: seed each root
MODULE = os.path.join(PKG, "approval_queue.py")
TEMP = os.environ.get("LOCALAPPDATA", os.path.expanduser("~\\AppData\\Local")) + "/Temp"
THROW = "%s/fc-r4-identity-denylist-%d" % (TEMP, os.getpid())

IDENTITIES = ["hermes-agent", "assistant", "claude", "Claude", "operator-1", "the monitor",
              "agent", "monitor", "system", "bot", "   ", "Erika Mustermann"]


def env_for(root):
    env = dict(os.environ)
    env["FREECASH_DATA_ROOT"] = root
    env["PYTHONPATH"] = PKG
    env["FREECASH_TOAST_STUB"] = "1"
    env.pop("FREECASH_OPERATOR_IDENTITY", None)
    return env


print("module under test : %s" % MODULE)
print("package           : %s" % PKG)
print("guard in force    : %s" % LABEL)
print("throwaway root    : %s" % THROW)
print("")
print("%-14s %-6s %-8s %s" % ("--by", "exit", "outcome", "detail"))

for identity in IDENTITIES:
    root = "%s/%s" % (THROW, identity.strip().replace(" ", "_") or "blank")
    shutil.rmtree(root, ignore_errors=True)
    os.makedirs(root, exist_ok=True)
    code = ("import approval_queue as aq; "
            "print(aq.enqueue('2026-10-01', {'dedupe_key': 'denylist-repro'}, 'x')['approval_id'])")
    seed = subprocess.run([PY, "-c", code], cwd=root, env=env_for(root),
                          capture_output=True, text=True)
    approval_id = seed.stdout.strip().splitlines()[-1]
    proc = subprocess.run([PY, MODULE, "decide", "--id", approval_id, "--decision", "approve",
                           "--by", identity, "--note", "denylist repro"], cwd=root,
                          env=env_for(root), capture_output=True, text=True)
    with open(os.path.join(root, "approvals", "pending.json"), encoding="utf-8") as fh:
        item = json.load(fh)["items"][0]
    outcome = "ACCEPTED" if proc.returncode == 0 else "REFUSED"
    detail = (item["status"], item["decided_by"], item["expires_at_utc"], item["execution_state"])
    print("%-14r %-6d %-8s status=%s decided_by=%r expires_at_utc=%r execution_state=%s"
          % (identity, proc.returncode, outcome, *detail))
    if proc.stderr.strip():
        print("%-14s        stderr: %s" % ("", proc.stderr.strip()))
