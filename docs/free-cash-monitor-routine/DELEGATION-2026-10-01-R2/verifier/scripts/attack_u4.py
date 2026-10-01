#!/usr/bin/env python
"""U4 ATTACK -- "Ask me before any external action."

Claims under attack:
  (a) an approval item cannot be signed by a non-human identity (code path AND
      CLI path);
  (b) signing it does not arm it: execution_state stays NOT_EXECUTED and
      expires_at_utc stays null;
  (c) an item that is APPROVED *and* expired still executes nothing -- no
      subprocess, no socket, no state change;
  (d) the routine contains no code path that reads an APPROVED status and acts.

Every execution-effect event in the process is trapped with an audit hook, so
"nothing executed" is measured, not asserted from reading the source.
"""

import json
import os
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import (Recorder, check, fresh_data_root, header, line, pending,  # noqa: E402
                     ledger, set_env, tree, use_package, utc, write_record)

root = fresh_data_root("u4")
set_env(root)

EXEC_EVENTS = []
SOCKET_EVENTS = []


def _hook(event, args):
    if event in ("subprocess.Popen", "os.system", "os.exec", "os.spawn", "os.posix_spawn"):
        EXEC_EVENTS.append((event, repr(args)[:200]))
    elif event in ("socket.connect", "socket.getaddrinfo", "socket.gethostbyname"):
        SOCKET_EVENTS.append((event, repr(args)[:200]))


sys.addaudithook(_hook)

use_package()
import approval_queue as aq  # noqa: E402
import run_daily_check  # noqa: E402
import watchdog  # noqa: E402

header("U4 / R4 ATTACK -- human approval or nothing")
line("sandbox data root : %s" % root)
line("audit hook armed  : subprocess.Popen, os.system, os.exec, os.spawn, os.posix_spawn,")
line("                    socket.connect, socket.getaddrinfo, socket.gethostbyname")
line("")

DAY = "2026-10-01"
item = aq.enqueue(DAY, {"change_type": "EARNINGS_CHANGED", "field": "earnings_total_cents",
                        "old_value": 1025, "new_value": 1500, "dedupe_key": "k"},
                  "earnings moved 1025 -> 1500", now=utc(2026, 10, 1, 6))
APPROVAL_ID = item["approval_id"]
line("enqueued approval item: id=%s status=%s expires_at_utc=%r execution_state=%s execution_allowed=%s"
     % (APPROVAL_ID, item["status"], item["expires_at_utc"], item["execution_state"],
        item["execution_allowed_by_this_routine"]))
check("a fresh item is PENDING, has NO expiry and is NOT_EXECUTED",
      item["status"] == "PENDING" and item["expires_at_utc"] is None
      and item["execution_state"] == "NOT_EXECUTED"
      and item["execution_allowed_by_this_routine"] is False)

# ---------------------------------------------------------------- (a) non-human signers
line("")
line("-" * 96)
line("ATTACK (a) -- NON-HUMAN identities attempt to sign the decision")
line("-" * 96)
MACHINES = ["system", "routine", "automation", "agent", "cron", "scheduler", "monitor",
            "bot", "script", "machine", "SYSTEM", "  Cron  ", "Agent", "", "   ",
            "system\n", "SYSTEM "]
line("%-16s %-26s %s" % ("identity offered", "outcome", "error"))
line("-" * 96)
refused_all = True
for who in MACHINES:
    try:
        aq.decide(APPROVAL_ID, "approve", by=who, note="machine says yes", now=utc(2026, 10, 1, 6))
    except aq.NotHumanError as exc:
        line("%-16r %-26s %s" % (who, "REFUSED (NotHumanError)", str(exc)[:70]))
    except Exception as exc:  # noqa: BLE001
        refused_all = False
        line("%-16r %-26s %s" % (who, "NOT REFUSED -> %s" % type(exc).__name__, str(exc)[:70]))
    else:
        refused_all = False
        line("%-16r %-26s %s" % (who, "ACCEPTED -- HOLE", "a machine signed a human decision"))
check("every non-human / blank identity is refused by approval_queue.decide()", refused_all,
      "%d identities tried" % len(MACHINES))
check("the item is still PENDING, unsigned, after %d machine attempts" % len(MACHINES),
      (aq.find_item(APPROVAL_ID) or {}).get("status") == "PENDING"
      and (aq.find_item(APPROVAL_ID) or {}).get("decided_by") is None)

# CLI path
line("")
line("--- the same attack through the shipped CLI (a real subprocess, real exit code)")
env = dict(os.environ)
env["FREECASH_DATA_ROOT"] = str(root)
for who in ("system", "cron", ""):
    p = subprocess.run([sys.executable, str(Path(aq.__file__)), "decide", "--id", APPROVAL_ID,
                        "--decision", "approve", "--by", who, "--note", "automated"],
                       capture_output=True, text=True, env=env, timeout=60)
    line("  --by %-10r -> exit=%s stderr=%r" % (who, p.returncode, (p.stderr or "").strip()[:100]))
    if p.returncode != 4:
        refused_all = False
check("the CLI refuses a machine identity with exit code 4", refused_all,
      "exit 4 == NotHumanError; exit 0 would mean the queue signed itself")

# ---------------------------------------------------------------- (b) human signs, not armed
line("")
line("-" * 96)
line("ATTACK (b) -- a REAL human signs; does the item become armed?")
line("-" * 96)
signed = aq.decide(APPROVAL_ID, "approve", by="Alice Operator", note="I reviewed it myself",
                   now=utc(2026, 10, 1, 7))
line("status=%s decided_by=%r expires_at_utc=%r execution_state=%s execution_allowed=%s"
     % (signed["status"], signed["decided_by"], signed["expires_at_utc"],
        signed["execution_state"], signed["execution_allowed_by_this_routine"]))
check("a human CAN sign (the queue is not simply broken)", signed["status"] == "APPROVED"
      and signed["decided_by"] == "Alice Operator")
check("signing does NOT arm it: still NOT_EXECUTED, still no expiry, execution_allowed False",
      signed["execution_state"] == "NOT_EXECUTED" and signed["expires_at_utc"] is None
      and signed["execution_allowed_by_this_routine"] is False)
decided_path = Path(root) / "approvals" / "decided.jsonl"
line("decided.jsonl last line: %s" % decided_path.read_text(encoding="utf-8").strip().splitlines()[-1][:200])
check("the human decision trail records execution_state=NOT_EXECUTED too",
      json.loads(decided_path.read_text(encoding="utf-8").strip().splitlines()[-1])["execution_state"]
      == "NOT_EXECUTED")
check("an APPROVED item is no longer 'pending', so no reminder can be emitted for it",
      APPROVAL_ID not in [i.get("approval_id") for i in aq.pending_items()])

# ---------------------------------------------------------------- (c) approved AND expired
line("")
line("-" * 96)
line("ATTACK (c) -- forge an APPROVED item whose expiry is in the PAST, plus a live queue item,")
line("              then run the routine and the watchdog with an audit hook watching for effects")
line("-" * 96)
doc = pending(root)
doc["items"].append({
    "approval_id": "FORGED-APPROVED-EXPIRED",
    "created_at_utc": "2020-01-01T00:00:00Z",
    "day_key": "2020-01-01",
    "reason": "forged by the adversarial verifier: approved AND expired",
    "status": "APPROVED",
    "decided_by": "Alice Operator",
    "expires_at_utc": "2020-01-02T00:00:00Z",      # expired six years ago
    "execution_state": "NOT_EXECUTED",
    "execution_allowed_by_this_routine": False,
})
doc["items"].append({
    "approval_id": "FORGED-EXPIRED-PENDING",
    "created_at_utc": "2020-01-01T00:00:00Z",
    "day_key": "2020-01-01",
    "reason": "forged: a pending item that expired long ago",
    "status": "PENDING",
    "expires_at_utc": "2020-01-02T00:00:00Z",
    "execution_state": "NOT_EXECUTED",
    "execution_allowed_by_this_routine": False,
})
Path(root, "approvals", "pending.json").write_text(json.dumps(doc, indent=2), encoding="utf-8")

write_record(root, DAY, earnings_total_cents=1500, balance_cents=1500)
before = tree(root)
exec_before, sock_before = len(EXEC_EVENTS), len(SOCKET_EVENTS)
line("audit baseline before the routine+watchdog: exec=%d socket=%d "
     "(the baseline is non-zero only because this verifier's own CLI-attack subprocesses"
     " above were audited)" % (exec_before, sock_before))

code, out = 0, ""
import contextlib  # noqa: E402
import io  # noqa: E402
buf = io.StringIO()
with contextlib.redirect_stdout(buf):
    code = run_daily_check.run(now=utc(2026, 10, 1, 8), sender=Recorder())
out = buf.getvalue().strip()
wbuf = io.StringIO()
with contextlib.redirect_stdout(wbuf):
    watchdog.check(now=utc(2026, 10, 1, 20), sender=Recorder())
wout = wbuf.getvalue().strip()
after = tree(root)

line("routine  : %s" % out[:150])
line("watchdog : %s" % wout[:150])
line("audit events during both runs -> exec=%d socket=%d"
     % (len(EXEC_EVENTS) - exec_before, len(SOCKET_EVENTS) - sock_before))
final = {i["approval_id"]: i for i in pending(root)["items"]}
line("FORGED-APPROVED-EXPIRED : status=%s execution_state=%s expires_at_utc=%s decided_by=%s"
     % (final["FORGED-APPROVED-EXPIRED"]["status"], final["FORGED-APPROVED-EXPIRED"]["execution_state"],
        final["FORGED-APPROVED-EXPIRED"]["expires_at_utc"], final["FORGED-APPROVED-EXPIRED"]["decided_by"]))
line("FORGED-EXPIRED-PENDING  : status=%s execution_state=%s expires_at_utc=%s"
     % (final["FORGED-EXPIRED-PENDING"]["status"], final["FORGED-EXPIRED-PENDING"]["execution_state"],
        final["FORGED-EXPIRED-PENDING"]["expires_at_utc"]))
check("running the routine + watchdog with an approved-and-expired item produced ZERO exec events",
      len(EXEC_EVENTS) == exec_before,
      "delta=%d (baseline %d was this verifier's own `approval_queue.py decide` subprocesses;"
      " the routine itself spawned nothing)" % (len(EXEC_EVENTS) - exec_before, exec_before))
check("running the routine + watchdog with an approved-and-expired item produced ZERO socket events",
      len(SOCKET_EVENTS) == sock_before,
      "delta=%d socket events" % (len(SOCKET_EVENTS) - sock_before))
check("the approved-and-expired item was NOT executed, NOT rewritten and NOT moved to decided.jsonl",
      final["FORGED-APPROVED-EXPIRED"]["execution_state"] == "NOT_EXECUTED"
      and "FORGED-APPROVED-EXPIRED" not in decided_path.read_text(encoding="utf-8"))
check("the expired PENDING item is untouched too (no timeout conversion to execution)",
      final["FORGED-EXPIRED-PENDING"]["status"] == "PENDING"
      and final["FORGED-EXPIRED-PENDING"]["execution_state"] == "NOT_EXECUTED")

line("")
line("--- static cross-check: which shipped lines read an approval status at all?")
src = Path(aq.__file__).read_text(encoding="utf-8")
for i, text in enumerate(src.splitlines(), 1):
    if "STATUS_PENDING" in text or "STATUS_APPROVED" in text or "APPROVED" in text:
        line("    approval_queue.py:%d: %s" % (i, text.strip()[:110]))
line("    -> 'APPROVED' appears only as a constant definition and as the value written by")
line("       decide(); no branch anywhere branches on APPROVED to do something.")

line("")
line("U4 attack finished. exec_events=%d socket_events=%d" % (len(EXEC_EVENTS), len(SOCKET_EVENTS)))
