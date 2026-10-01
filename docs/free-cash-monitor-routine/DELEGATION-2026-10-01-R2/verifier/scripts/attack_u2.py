#!/usr/bin/env python
"""U2 ATTACK -- "Check the status once a day."

Claims under attack:
  (a) a second same-day run in the same sandbox performs NO read and writes
      NOTHING;
  (b) the barrier is atomic, so N simultaneous first-runs elect exactly one
      winner;
  (c) the day key is the operator-local calendar day and is DST-safe.

Method: instrument the routine's own read entry points and its two file-write
primitives with counters, then diff the whole sandbox tree byte-for-byte.
"""

import os
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import (Recorder, alerts, check, diff, fresh_data_root, header, ledger,  # noqa: E402
                     line, sandbox, set_env, tree, use_package, utc, write_record)

root = fresh_data_root("u2")
set_env(root)
use_package()

import changedetect  # noqa: E402
import gate  # noqa: E402
import operator_state  # noqa: E402
import paths  # noqa: E402
import readonly_client  # noqa: E402
import run_daily_check  # noqa: E402

header("U2 / R1 ATTACK -- one status check per operator-local calendar day")
line("sandbox data root : %s" % root)
line("production root   : D:/AgenticOS/data/freecash-monitor  (never used by this script)")

DAY = "2026-10-01"
write_record(root, DAY, earnings_total_cents=1025, balance_cents=1025)

# ------------------------------------------------------------------ instrumentation
COUNTERS = {k: 0 for k in ("entry_read_source", "operator_read", "http_request",
                           "load_prior", "write_json_atomic", "append_jsonl")}


def spy(obj, attr, key):
    orig = getattr(obj, attr)

    def wrapper(*a, **k):
        COUNTERS[key] += 1
        return orig(*a, **k)

    setattr(obj, attr, wrapper)
    return orig


spy(run_daily_check, "read_source", "entry_read_source")
spy(operator_state, "read_source", "operator_read")
spy(readonly_client, "request", "http_request")
spy(changedetect, "load_prior_snapshot", "load_prior")
spy(paths, "write_json_atomic", "write_json_atomic")
spy(paths, "append_jsonl", "append_jsonl")

line("")
line("instrumented: run_daily_check.read_source, operator_state.read_source,")
line("              readonly_client.request, changedetect.load_prior_snapshot,")
line("              paths.write_json_atomic, paths.append_jsonl")


def reset():
    for k in COUNTERS:
        COUNTERS[k] = 0


def run(day_dt, sender):
    import io
    from contextlib import redirect_stdout
    buf = io.StringIO()
    with redirect_stdout(buf):
        code = run_daily_check.run(now=day_dt, sender=sender)
    return code, buf.getvalue().strip()


# ------------------------------------------------------------------ run #1
line("")
line("-" * 96)
line("RUN #1 -- the day is fresh")
line("-" * 96)
before = tree(root)
reset()
sender = Recorder()
code1, out1 = run(utc(2026, 10, 1, 6), sender)
after1 = tree(root)
line("stdout : %s" % out1)
line("exit   : %s" % code1)
line("counters: %s" % COUNTERS)
a, r, c = diff(before, after1)
line("tree delta: added=%s removed=%s changed=%s" % (a, r, c))
check("run #1 did the read (counters non-zero -- the probe is not vacuous)",
      COUNTERS["entry_read_source"] == 1 and COUNTERS["operator_read"] == 1)
check("run #1 consumed the day lock", (Path(root) / "state" / "day-locks" / ("%s.lock" % DAY)).exists())
check("run #1 wrote a snapshot for %s" % DAY, ("snapshots/%s.json" % DAY) in a)
check("run #1 recorded the attempt in the ledger", ledger(root).get("last_attempt_day") == DAY,
      str(ledger(root).get("last_attempt_day")))

# ------------------------------------------------------------------ run #2 (the attack)
line("")
line("-" * 96)
line("RUN #2 -- SAME calendar day, SAME sandbox  (the attack)")
line("-" * 96)
before2 = tree(root)
n_alerts_before = len(alerts(root))
reset()
sender2 = Recorder()
code2, out2 = run(utc(2026, 10, 1, 6, 15), sender2)
after2 = tree(root)
a2, r2, c2 = diff(before2, after2)
line("stdout : %s" % out2)
line("exit   : %s" % code2)
line("counters: %s" % COUNTERS)
line("tree delta: added=%s removed=%s changed=%s" % (a2, r2, c2))
new_alert_records = alerts(root)[n_alerts_before:]
line("new alert records: %s" % [x.get("event_type") for x in new_alert_records])
line("deliveries attempted by the toast stub: %d" % sender2.attempts)

check("run #2 reports SKIP_DUPLICATE_DAY", "SKIP_DUPLICATE_DAY" in out2)
check("run #2 performed NO read", COUNTERS["entry_read_source"] == 0 and COUNTERS["operator_read"] == 0
      and COUNTERS["http_request"] == 0 and COUNTERS["load_prior"] == 0,
      "counters=%s" % COUNTERS)
check("run #2 wrote NO state file", COUNTERS["write_json_atomic"] == 0,
      "paths.write_json_atomic calls=%d" % COUNTERS["write_json_atomic"])
check("run #2 created no new file (no snapshot, no lock, no ledger)", not a2 and not r2,
      "added=%s removed=%s" % (a2, r2))
check("run #2 mutated no existing file except the append-only alert log",
      c2 in ([], ["alerts/alerts.jsonl"]), "changed=%s" % c2)
check("run #2 sent NO notification", sender2.attempts == 0, "attempts=%d" % sender2.attempts)
check("run #2 left the ledger, the queue and the snapshot byte-identical",
      before2.get("state/last-run.json") == after2.get("state/last-run.json")
      and before2.get("snapshots/%s.json" % DAY) == after2.get("snapshots/%s.json" % DAY)
      and before2.get("state/operator-state.json") == after2.get("state/operator-state.json")
      and before2.get("approvals/pending.json") == after2.get("approvals/pending.json"),
      "ledger=%s snapshot=%s" % (before2.get("state/last-run.json") == after2.get("state/last-run.json"),
                                 before2.get("snapshots/%s.json" % DAY) == after2.get("snapshots/%s.json" % DAY)))
line("")
line("NOTE (honest accounting): run #2 is NOT literally zero-write.  It appends exactly one")
line("append-only audit record (event_type=%s) to alerts/alerts.jsonl."
     % [x.get("event_type") for x in new_alert_records])
line("All durable STATE (ledger, notified-keys, pending queue, snapshot, day lock) is byte-identical.")

# ------------------------------------------------------------------ run #3 (log growth)
line("")
line("-" * 96)
line("RUN #3 -- a third same-day run (log-growth probe)")
line("-" * 96)
n3 = len(alerts(root))
sender3 = Recorder()
code3, out3 = run(utc(2026, 10, 1, 6, 30), sender3)
new3 = alerts(root)[n3:]
skip_total = len([x for x in alerts(root) if x.get("event_type") == "SKIP_DUPLICATE_DAY"])
line("stdout : %s" % out3)
line("new alert records: %s" % [x.get("event_type") for x in new3])
line("total SKIP_DUPLICATE_DAY lines now in the sandbox alert log: %d" % skip_total)
check("HOLE H5 confirmed: every duplicate invocation appends another unbounded audit line",
      len(new3) == 1 and skip_total == 2,
      "there is no dedupe on the SKIP_DUPLICATE_DAY line; a scheduler firing every 5 min"
      " grows this file without limit")

# ------------------------------------------------------------------ concurrency
line("")
line("-" * 96)
line("CONCURRENCY -- 5 simultaneous first-runs on a fresh sandbox")
line("-" * 96)
conc_root = fresh_data_root("u2-concurrency")
write_record(conc_root, "2026-10-01")
env = dict(os.environ)
env["FREECASH_DATA_ROOT"] = str(conc_root)
env["FREECASH_TZ"] = "Europe/Berlin"
env["FREECASH_TOAST_STUB"] = "1"
env["FREECASH_TOAST_RETRY_SLEEP_SECONDS"] = "0"
procs = [subprocess.Popen([sys.executable, str(Path(run_daily_check.__file__))],
                          stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=env)
         for _ in range(5)]
outs = [p.communicate(timeout=120) for p in procs]
winners = []
for p, (o, e) in zip(procs, outs):
    last = (o.strip().splitlines() or [""])[-1]
    kind = "RUN_OK" if "RUN_OK" in o else ("SKIP" if "SKIP_DUPLICATE_DAY" in o else "OTHER")
    line("  exit=%s  %-6s  %s" % (p.returncode, kind, last[:110]))
    if kind == "RUN_OK":
        winners.append(1)
check("exactly ONE of 5 simultaneous same-day runs did the work", len(winners) == 1,
      "winners=%d of 5 (the O_CREAT|O_EXCL lock, not a check-then-write)" % len(winners))
check("the losing runs created no snapshot of their own",
      len(list((conc_root / "snapshots").glob("*.json"))) == 1)

# ------------------------------------------------------------------ DST / day key
line("")
line("-" * 96)
line("DAY KEY -- operator-local calendar day, DST-safe")
line("-" * 96)
cases = [
    ("2026-03-28 22:30Z  (CET  23:30, still the 28th)", utc(2026, 3, 28, 22, 30)),
    ("2026-03-29 00:30Z  (CET  01:30 on the 29th)", utc(2026, 3, 29, 0, 30)),
    ("2026-03-29 01:30Z  (CEST 03:30 -- the spring-forward gap)", utc(2026, 3, 29, 1, 30)),
    ("2026-10-24 22:30Z  (CEST 00:30 on the 25th)", utc(2026, 10, 24, 22, 30)),
    ("2026-10-25 00:30Z  (CEST 02:30, before fall-back)", utc(2026, 10, 25, 0, 30)),
    ("2026-10-25 01:30Z  (CET  02:30, after fall-back)", utc(2026, 10, 25, 1, 30)),
]
expect = ["2026-03-28", "2026-03-29", "2026-03-29", "2026-10-25", "2026-10-25", "2026-10-25"]
got = []
for label, moment in cases:
    key = gate.day_key(moment)
    got.append(key)
    line("  %-58s -> day_key=%s  (utc date=%s)" % (label, key, moment.date().isoformat()))
check("every DST boundary instant maps to the correct operator-local calendar day", got == expect,
      "got=%s expected=%s" % (got, expect))
line("  timezone report: %s" % gate.timezone_report())
check("Europe/Berlin is resolved from a real IANA database on this interpreter (kind != system-local)",
      gate.timezone_report()["kind"] == "zoneinfo", str(gate.timezone_report()))

line("")
line("U2 attack finished.")
