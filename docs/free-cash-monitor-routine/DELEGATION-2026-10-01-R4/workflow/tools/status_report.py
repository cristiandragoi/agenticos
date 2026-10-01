"""status_report.py -- the operator-facing daily report.  READ-ONLY; writes nothing.

It renders one screen from a data root and, above all, it never dresses a degraded run up
as success:

  * coverage comes from the SNAPSHOT's source.data_available, never from the ledger's
    last_outcome (a degraded run is booked as last_success_day -- gate.py:32-40 lists
    MONITOR_DEGRADED in SUCCESS_OUTCOMES and gate.py:198-200 advances last_success_day for it);
  * "no reading today" is printed as a finding, not as a quiet zero;
  * the day-lock state is reported, so a spent day is visible.

Usage: python status_report.py [--root <data root>] [--day <YYYY-MM-DD>]
"""

import argparse
import json
import os
import sys
from pathlib import Path

CHANGE_EVENTS = ("EARNINGS_CHANGED", "STATUS_CHANGED", "BALANCE_CHANGED")


def read_json(path, default=None):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return default


def read_jsonl(path):
    out = []
    try:
        lines = Path(path).read_text(encoding="utf-8").splitlines()
    except OSError:
        return out
    for line in lines:
        if line.strip():
            try:
                out.append(json.loads(line))
            except ValueError:
                continue
    return out


def money(value):
    if not isinstance(value, int):
        return "unknown"
    sign = "-" if value < 0 else ""
    return "%s$%d.%02d" % (sign, abs(value) // 100, abs(value) % 100)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="status_report.py")
    parser.add_argument("--root", default=None)
    parser.add_argument("--day", default=None)
    args = parser.parse_args(sys.argv[1:] if argv is None else argv)

    root = Path(args.root or os.environ.get("FREECASH_DATA_ROOT") or "")
    day = args.day or os.environ.get("FREECASH_REPORT_DAY")
    if not day:
        # derive from the newest snapshot, so the report never needs zoneinfo itself
        stamps = sorted(p.stem for p in (root / "snapshots").glob("*.json")) if (root / "snapshots").exists() else []
        day = stamps[-1] if stamps else "(unknown)"

    ledger = read_json(root / "state" / "last-run.json", default={}) or {}
    snapshot = read_json(root / "snapshots" / ("%s.json" % day), default=None)
    lock = root / "state" / "day-locks" / ("%s.lock" % day)
    operator = read_json(root / "state" / "operator-state.json", default={}) or {}
    records = operator.get("records") if isinstance(operator.get("records"), list) else []
    alerts = [r for r in read_jsonl(root / "alerts" / "alerts.jsonl") if r.get("day_key") == day]
    keys = (read_json(root / "state" / "notified-keys.json", default={}) or {}).get("keys", {})
    pending = read_json(root / "approvals" / "pending.json", default={}) or {}

    has_reading = bool(snapshot and (snapshot.get("source") or {}).get("data_available"))
    line = "-" * 74
    print(line)
    print("FreeCash status monitor -- %s" % day)
    print(line)
    print("data root    : %s" % root)
    print("day lock     : %s" % ("PRESENT (the day is consumed)" if lock.exists() else "absent"))
    print("ledger       : last_outcome=%s last_success_day=%s consecutive_missed_days=%s"
          % (ledger.get("last_outcome"), ledger.get("last_success_day"), ledger.get("consecutive_missed_days")))
    print("operator file: records=%d%s" % (len(records), "" if records else "  (nobody has entered today's figures)"))

    if not snapshot:
        print()
        print("READING      : NONE -- no snapshot exists for %s" % day)
        print("COVERAGE     : none")
    elif not has_reading:
        print()
        print("READING      : NONE -- a snapshot exists but it carries no figures.")
        print("               data_available=false, every figure null, raw_response_sha256=%s"
              % snapshot.get("raw_response_sha256"))
        print("COVERAGE     : none. Do not read this as success: the ledger may still show")
        print("               last_outcome=%s and last_success_day=%s, which is exactly the lie."
              % (ledger.get("last_outcome"), ledger.get("last_success_day")))
    else:
        print()
        print("READING      : PRESENT (captured %s, source=%s, degraded=%s)"
              % (snapshot.get("captured_at_utc"), (snapshot.get("source") or {}).get("kind"), snapshot.get("degraded")))
        print("STATUS       : %s" % snapshot.get("account_status"))
        print("EARNINGS     : %s" % money(snapshot.get("earnings_total_cents")))
        print("BALANCE      : %s" % money(snapshot.get("balance_cents")))
        print("PENDING      : %s" % money(snapshot.get("pending_cents")))
        print("CURRENCY     : %s" % snapshot.get("currency"))
        print("COVERAGE     : yes (snapshot data_available=true)")

    changes = [a for a in alerts if a.get("event_type") in CHANGE_EVENTS]
    print()
    print("CHANGES today: %d" % len(changes))
    for a in changes:
        print("  - %s  %s -> %s  (dedupe %s)"
              % (a.get("event_type"), (a.get("observed") or {}).get("old_value"),
                 (a.get("observed") or {}).get("new_value"), (a.get("dedupe_key") or "")[:16]))
    delivered = [a for a in alerts if a.get("event_type") == "APPROVAL_PENDING"]
    index_keys = [k for k, v in keys.items() if isinstance(v, dict)]
    print("notifications : %d change-notification line(s) for this day" % len(changes))
    print("dedupe index  : %d key(s) total, delivery labels %s"
          % (len(index_keys), sorted({v.get("delivery") for v in keys.values() if isinstance(v, dict)})))
    print("approval items: %d" % len(pending.get("items") or []))
    for item in pending.get("items") or []:
        print("  - %s  %s  expires_at_utc=%s  execution_state=%s"
              % (item.get("approval_id"), item.get("status"), item.get("expires_at_utc"), item.get("execution_state")))
    if delivered:
        print("what changed  : %s" % delivered[-1].get("message", "").splitlines()[0])

    print()
    if not has_reading:
        print("VERDICT: NO READING TODAY -- %s. No figure was observed; R3 had nothing to compare." % day)
    elif changes:
        print("VERDICT: READING PRESENT, %d change(s) reported for %s." % (len(changes), day))
    else:
        print("VERDICT: READING PRESENT, no change vs the previous snapshot for %s." % day)
    print(line)
    return 0


if __name__ == "__main__":
    sys.exit(main())
