#!/usr/bin/env python
"""U3 ATTACK -- "Tell me if earnings or account status changes."

Claims under attack:
  (a) a real earnings change fires EXACTLY ONE notification;
  (b) a no-change day fires NONE (silence is allowed, but must be a deliberate
      logged silence, not an accident);
  (c) the same change can never be notified twice;
  (d) the >5-changes coalescing safety valve is reachable (or is dead code).

Then the adversary flips the board: what happens to a REAL change when the day
before it was a degraded (read-failed) day?
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import (Recorder, alerts, check, fresh_data_root, header, line, sandbox,  # noqa: E402
                     set_env, use_package, utc, write_record)

use_package()

import changedetect  # noqa: E402
import notify  # noqa: E402
import paths  # noqa: E402
import run_daily_check  # noqa: E402

header("U3 / R3 ATTACK -- notify on a real change, exactly once, and stay silent otherwise")
root = fresh_data_root("u3")
set_env(root)
line("sandbox data root : %s" % root)


def run(day_dt, sender):
    import io
    from contextlib import redirect_stdout
    buf = io.StringIO()
    with redirect_stdout(buf):
        code = run_daily_check.run(now=day_dt, sender=sender)
    return code, buf.getvalue().strip()


def ev(root_, kind):
    return [x for x in alerts(root_) if x.get("event_type") == kind]


line("")
line("-" * 96)
line("SEQUENCE -- four consecutive operator-local days, one run each")
line("-" * 96)
line("%-12s %-28s %-22s %-6s %-9s %s" % ("day", "figures", "outcome", "exit", "delivered", "alert log lines added"))
line("-" * 96)

PLAN = [
    ("2026-09-28", dict(earnings_total_cents=1025, balance_cents=1025, pending_cents=0, account_status="ACTIVE"), utc(2026, 9, 28, 6)),
    ("2026-09-29", dict(earnings_total_cents=1025, balance_cents=1025, pending_cents=0, account_status="ACTIVE"), utc(2026, 9, 29, 6)),
    ("2026-09-30", dict(earnings_total_cents=1500, balance_cents=1500, pending_cents=0, account_status="ACTIVE"), utc(2026, 9, 30, 6)),
    ("2026-10-01", dict(earnings_total_cents=1500, balance_cents=1500, pending_cents=0, account_status="SUSPENDED"), utc(2026, 10, 1, 6)),
]

results = []
for day, figures, moment in PLAN:
    write_record(root, day, **figures)
    before = len(alerts(root))
    sender = Recorder()
    code, out = run(moment, sender)
    added = [x.get("event_type") for x in alerts(root)[before:]]
    outcome = out.split("outcome=")[1].split(" ")[0] if "outcome=" in out else "<none>"
    results.append((day, outcome, code, sender.attempts, added))
    line("%-12s %-28s %-22s %-6s %-9d %s"
         % (day, "e=%s b=%s p=%s s=%s" % (figures["earnings_total_cents"], figures["balance_cents"],
                                          figures["pending_cents"], figures["account_status"]),
            outcome, code, sender.attempts, added))

line("-" * 96)
d1, d2, d3, d4 = results
check("day 1 (first ever run) is INITIAL_BASELINE and notifies nobody",
      d1[1] == "INITIAL_BASELINE" and d1[3] == 0, "outcome=%s deliveries=%d" % (d1[1], d1[3]))
check("day 2 (identical figures) is OK_NO_CHANGE and notifies nobody",
      d2[1] == "OK_NO_CHANGE" and d2[3] == 0, "outcome=%s deliveries=%d" % (d2[1], d2[3]))
check("day 2's silence is a DELIBERATE logged line, not an absence",
      d2[4] == ["OK_NO_CHANGE"], "alert log lines added: %s" % d2[4])
check("day 3 (earnings 1025 -> 1500, balance dragged along) fires EXACTLY ONE notification",
      d3[3] == 1, "deliveries=%d" % d3[3])
check("day 3 emits exactly one EARNINGS_CHANGED line (balance movement folded in, not double-counted)",
      d3[4].count("EARNINGS_CHANGED") == 1 and "BALANCE_CHANGED" not in d3[4],
      "alert log lines added: %s" % d3[4])
check("day 3 enqueues exactly one PENDING approval item (handle, not permission)",
      len([x for x in alerts(root) if x.get("event_type") == "APPROVAL_PENDING"
           and x.get("day_key") == "2026-09-30"]) == 1)
check("day 4 (account status ACTIVE -> SUSPENDED, money unchanged) fires EXACTLY ONE notification",
      d4[3] == 1 and d4[4].count("STATUS_CHANGED") == 1, "deliveries=%d lines=%s" % (d4[3], d4[4]))

# ------------------------------------------------------------------ dedupe attack
line("")
line("-" * 96)
line("DEDUPE ATTACK -- the same change presented twice")
line("-" * 96)
sender = Recorder()
key = changedetect.dedupe_key("2026-10-01", "EARNINGS_CHANGED", "earnings_total_cents", 1500, 9999)
change = {"change_type": "EARNINGS_CHANGED", "field": "earnings_total_cents",
          "old_value": 1500, "new_value": 9999, "prior_day_key": "2026-09-30"}
r1 = notify.notify_change("2026-10-01", change, "first presentation", key, sender=sender, sleep_seconds=0)
r2 = notify.notify_change("2026-10-01", change, "second presentation", key, sender=sender, sleep_seconds=0)
line("first  presentation -> %s" % r1)
line("second presentation -> %s" % r2)
line("deliveries attempted by the toast stub: %d" % sender.attempts)
check("the same change notified once, the second presentation deduped",
      r1 == "NOTIFIED" and r2 == "DEDUPED" and sender.attempts == 1,
      "NOTIFIED=%s DEDUPED=%s deliveries=%d" % (r1, r2, sender.attempts))

# ------------------------------------------------------------------ coalescing reachability
line("")
line("-" * 96)
line("COALESCING SAFETY VALVE -- is the '>5 changes -> one summary' branch reachable?")
line("-" * 96)
base = {"account_status": "ACTIVE", "earnings_total_cents": 1000, "balance_cents": 1000,
        "pending_cents": 0, "currency": "USD", "day_key": "2026-01-01",
        "source": {"data_available": True}}
max_changes = 0
worst = None
for mask in range(16):
    cur = dict(base)
    cur["day_key"] = "2026-01-02"
    fields = ["account_status", "earnings_total_cents", "balance_cents", "pending_cents"]
    for i, f in enumerate(fields):
        if mask & (1 << i):
            cur[f] = ("SUSPENDED" if f == "account_status" else base[f] + 7)
    n = len(changedetect.compare(base, cur)["changes"])
    if n > max_changes:
        max_changes, worst = n, mask
line("all 16 change combinations of the four compared fields were enumerated")
line("MAXIMUM distinct changes producible in one day: %d  (mask=%d)" % (max_changes, worst))
line("MAX_NOTIFICATIONS = %d, so the coalescing branch requires len(changes) > %d"
     % (run_daily_check.MAX_NOTIFICATIONS, run_daily_check.MAX_NOTIFICATIONS))
check("HOLE H7 confirmed: the >5-change coalescing branch is UNREACHABLE dead code",
      max_changes <= run_daily_check.MAX_NOTIFICATIONS,
      "max=%d <= %d -- the 'individual notifications suppressed' safety valve can never fire,"
      " so it has never been exercised by any run" % (max_changes, run_daily_check.MAX_NOTIFICATIONS))

# ------------------------------------------------------------------ H3: degraded span
line("")
line("-" * 96)
line("HOLE H3 -- a REAL change is silently absorbed when the previous day was degraded")
line("-" * 96)

# control: previous day had real data
ctl = fresh_data_root("u3-control")
set_env(ctl)
write_record(ctl, "2026-09-28", earnings_total_cents=1025, balance_cents=1025)
s = Recorder()
run(utc(2026, 9, 28, 6), s)
write_record(ctl, "2026-09-29", earnings_total_cents=5000, balance_cents=5000)
s_ctl = Recorder()
_, out_ctl = run(utc(2026, 9, 29, 6), s_ctl)
line("CONTROL (prior day readable):  %s" % out_ctl)
line("             deliveries=%d  alerts=%s" % (s_ctl.attempts, [x.get("event_type") for x in alerts(ctl)][-2:]))
ctl_ok = s_ctl.attempts == 1 and "EARNINGS_CHANGED" in out_ctl

# attack: previous day had NO operator record -> MONITOR_DEGRADED, snapshot holds nulls
atk = fresh_data_root("u3-degraded-span")
set_env(atk)
s = Recorder()
_, out_a1 = run(utc(2026, 9, 28, 6), s)          # no record for 2026-09-28
write_record(atk, "2026-09-29", earnings_total_cents=5000, balance_cents=5000)
s = Recorder()
_, out_a2 = run(utc(2026, 9, 29, 6), s)
line("ATTACK  (prior day degraded): %s" % out_a1)
line("             then a real reading the next day: %s" % out_a2)
line("             deliveries on the change day=%d  alerts=%s"
     % (s.attempts, [x.get("event_type") for x in alerts(atk)][-2:]))
line("             prior snapshot source.data_available=%s"
     % (changedetect.load_snapshot("2026-09-28") or {}).get("source", {}).get("data_available"))
check("control: a change after a GOOD day fires exactly one notification", ctl_ok,
      "deliveries=%d outcome=%s" % (s_ctl.attempts, out_ctl.split("outcome=")[1].split(" ")[0]))
check("HOLE H3 confirmed: earnings 0 -> 5000 produced ZERO notifications because the previous "
      "snapshot was degraded", s.attempts == 0 and "INITIAL_BASELINE" in out_a2,
      "outcome=%s deliveries=%d -- the change is real and unreported; the operator sees a "
      "log-only INITIAL_BASELINE line" % (out_a2.split("outcome=")[1].split(" ")[0], s.attempts))

line("")
line("U3 attack finished.")
