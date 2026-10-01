"""stage_hardening.py -- build the PROPOSED (never applied) hardening copies in a temp dir,
then emit a real unified diff against the untouched originals in monitoring/.

Item 5: (a) a writer tag (pid + entry point + start time) on every new alerts.jsonl line;
        (b) a missed-day catch-up coalesced into ONE payload naming N and the day keys.

Nothing under D:/AgenticOS/monitoring is written.  The originals are only read.
"""

import os
import shutil
import subprocess
import sys

SRC = "D:/AgenticOS/monitoring/freecash"
OUT = os.path.join(os.environ["LOCALAPPDATA"], "Temp", "fc-r2-proposed")
shutil.rmtree(OUT, ignore_errors=True)
os.makedirs(OUT)

for name in ("notify.py", "run_daily_check.py"):
    shutil.copy(os.path.join(SRC, name), os.path.join(OUT, name))

# ------------------------------------------------------------------ notify.py
p = os.path.join(OUT, "notify.py")
s = open(p, encoding="utf-8").read()

s = s.replace("import os\nimport subprocess\n", "import os\nimport subprocess\nimport sys\n", 1)

anchor = "_sender_override = None\n"
assert anchor in s
s = s.replace(anchor, anchor + '''
#: Provenance stamped onto every line this PROCESS appends.  One field answers
#: "which process wrote this line?" -- a burst of identical alerts from an
#: unknown writer is exactly the failure this field makes visible.
_WRITER = {
    "pid": os.getpid(),
    "entry_point": os.path.basename(sys.argv[0] or "") or "unknown",
    "started_utc": paths.iso_utc(),
}
''', 1)

anchor2 = '''    record = {
        "event_id": str(uuid.uuid4()),
'''
assert anchor2 in s
s = s.replace(anchor2, '''    record = {
        "writer": dict(_WRITER),
        "event_id": str(uuid.uuid4()),
''', 1)

anchor3 = '''def message_missed_day(day, last_success, consecutive) -> str:
'''
assert anchor3 in s
s = s.replace(anchor3, '''def message_missed_days(day, missed, last_success) -> str:
    """ONE payload for a whole missed-day catch-up: names N and every day key."""
    return "\\n".join(
        [
            "[FreeCash] %d MISSED DAYS %s" % (len(missed), day),
            "No successful status check recorded for: %s" % ", ".join(missed),
            "First missed: %s.  Last missed: %s." % (missed[0], missed[-1]),
            "Last success: %s." % last_success,
            "Per-day detail: alerts.jsonl (one MISSED_DAY line per day, no notification).",
            "ACTION:    No action taken. Investigate why no check ran (machine uptime, "
            "scheduler history, or a failed run).",
        ]
    )


def message_missed_day(day, last_success, consecutive) -> str:
''', 1)
open(p, "w", encoding="utf-8", newline="\n").write(s)

# --------------------------------------------------------- run_daily_check.py
p2 = os.path.join(OUT, "run_daily_check.py")
t = open(p2, encoding="utf-8").read()

old = '''    for missed_day in missed:
        change = {
            "change_type": "MISSED_DAY",
            "field": "last_success_day",
            "old_value": missed_day,
            "new_value": ledger.get("last_success_day"),
            "prior_day_key": ledger.get("last_success_day"),
        }
        key = changedetect.dedupe_key(day, "MISSED_DAY", "last_success_day", missed_day, ledger.get("last_success_day"))
        notify.notify_change(
            day,
            change,
            notify.message_missed_day(missed_day, ledger.get("last_success_day"), len(missed)),
            key,
            sender=sender,
            sleep_seconds=0,
        )
'''
assert old in t, "missed-day loop not found verbatim"

new = '''    if len(missed) > 1:
        # A catch-up is ONE event, not N.  Every day still gets its own
        # log-only MISSED_DAY line (the per-day audit record is not lost), but
        # exactly one notification is dispatched, naming N and the day keys.
        for missed_day in missed:
            notify.alert(
                "MISSED_DAY",
                day,
                notify.message_missed_day(missed_day, ledger.get("last_success_day"), len(missed)),
                severity=notify.SEVERITY_ALERT,
                dedupe_key=changedetect.dedupe_key(
                    day, "MISSED_DAY", "last_success_day", missed_day, ledger.get("last_success_day")
                ),
                observed={"missed_day": missed_day, "coalesced": True},
            )
        key = changedetect.dedupe_key(
            day, "MISSED_DAY", "missed_days", missed[0], "%d:%s" % (len(missed), missed[-1])
        )
        if not notify.key_seen(key):
            notify.dispatch(
                notify.message_missed_days(day, missed, ledger.get("last_success_day")),
                key,
                day,
                "MISSED_DAY",
                sender=sender,
                sleep_seconds=0,
            )
    else:
        for missed_day in missed:
            change = {
                "change_type": "MISSED_DAY",
                "field": "last_success_day",
                "old_value": missed_day,
                "new_value": ledger.get("last_success_day"),
                "prior_day_key": ledger.get("last_success_day"),
            }
            key = changedetect.dedupe_key(day, "MISSED_DAY", "last_success_day", missed_day, ledger.get("last_success_day"))
            notify.notify_change(
                day,
                change,
                notify.message_missed_day(missed_day, ledger.get("last_success_day"), len(missed)),
                key,
                sender=sender,
                sleep_seconds=0,
            )
'''
t = t.replace(old, new, 1)
open(p2, "w", encoding="utf-8", newline="\n").write(t)

# ------------------------------------------------------------------- diff it
diff_out = []
for name in ("notify.py", "run_daily_check.py"):
    r = subprocess.run(
        ["diff", "-u",
         "--label", "a/monitoring/freecash/%s" % name,
         "--label", "b/monitoring/freecash/%s" % name,
         os.path.join(SRC, name), os.path.join(OUT, name)],
        capture_output=True, text=True)
    diff_out.append(r.stdout)
    print("diff %s -> exit=%d, %d diff lines" % (name, r.returncode, len(r.stdout.splitlines())))
    assert r.returncode == 1, "expected diff exit 1 (differences found), got %s" % r.returncode

header = """# STAGED HARDENING -- NOT APPLIED.
#
# Target: monitoring/freecash/notify.py and monitoring/freecash/run_daily_check.py
# Status: PROPOSED ONLY.  Nothing in D:/AgenticOS/monitoring was modified; the
#         originals were opened read-only and copied to %LOCALAPPDATA%/Temp to
#         produce this diff.  Apply only by a human, deliberately, with the
#         routine stopped.
#
# What it changes:
#   (a) notify.alert() stamps a `writer` object {pid, entry_point, started_utc}
#       onto every new alerts.jsonl line, so an unattributed burst is visible.
#   (b) a multi-day missed-day catch-up becomes ONE dispatch naming N and the
#       day keys, instead of N dispatches ~6.5 s apart.  Per-day audit lines are
#       preserved (log-only), so nothing is hidden.
#
# Not changed: the comparison, the dedupe-key construction, R1, R2, R4.
#
""" + "\n".join(diff_out)

path = sys.argv[1]
open(path, "w", encoding="utf-8", newline="\n").write(header)
print("wrote %s (%d bytes)" % (path, len(header)))
