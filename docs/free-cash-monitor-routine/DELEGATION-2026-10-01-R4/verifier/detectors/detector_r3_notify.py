"""detector_r3_notify.py -- runtime detector for operator Rule 3.

RULE 3 (operator, verbatim): "notify on earnings / account-status change."

The detector drives the routine through a four-day operator-local sequence with
the operator-entered read source (no socket, no credential) and counts what the
notification channel actually received.  All four days live inside ONE throwaway
data root, so each day's comparison has a prior day to compare against.

  day 1  first ever reading                     -> no notification (baseline)
  day 2  earnings 1025 -> 1050                  -> exactly one EARNINGS_CHANGED
                                                   line and exactly one delivery
  day 3  readings identical to day 2             -> OK_NO_CHANGE line, ZERO
                                                   deliveries (no change, no
                                                   notification)
  day 4  account_status ACTIVE -> LIMITED        -> one STATUS_CHANGED line and
                                                   at least one delivery

The day-3 check is what makes this detector non-vacuous in both directions: a
routine that never notifies fails day 2/4, and a routine that always notifies
fails day 3.

Delivery is observed through the routine's own offline toast stub
(FREECASH_TOAST_STUB=1): every delivered message is appended to
``<root>/logs/toast-stub.log``.  Nothing leaves the machine.

Exit codes:: 0 all checks pass, 1 a Rule 3 violation, 2 detector could not run.
"""

import argparse
import contextlib
import io
import json
import os
import sys
from datetime import datetime, timedelta, timezone

BASE_DAY = datetime(2026, 3, 10, 9, 0, tzinfo=timezone.utc)


def read_jsonl(path):
    out = []
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as handle:
            for line in handle:
                line = line.strip()
                if line:
                    try:
                        out.append(json.loads(line))
                    except ValueError:
                        out.append({"__unparsable__": line})
    return out


def delivery_count(root):
    path = os.path.join(root, "logs", "toast-stub.log")
    if not os.path.exists(path):
        return 0
    with open(path, "r", encoding="utf-8", errors="replace") as handle:
        return sum(1 for line in handle if line.strip())


def main():
    parser = argparse.ArgumentParser(prog="detector_r3_notify.py")
    parser.add_argument("--package", required=True)
    parser.add_argument("--root", required=True)
    args = parser.parse_args()

    package = os.path.abspath(args.package)
    root = os.path.abspath(args.root)
    sys.path.insert(0, package)
    os.environ["FREECASH_DATA_ROOT"] = root
    os.environ["FREECASH_TZ"] = "Europe/Berlin"
    os.environ["FREECASH_TOAST_STUB"] = "1"
    os.environ["FREECASH_TOAST_RETRY_SLEEP_SECONDS"] = "0"

    results = []

    def check(name, ok, evidence):
        results.append((name, bool(ok), evidence))

    try:
        import gate
        import operator_state
        import run_daily_check
    except Exception as exc:  # noqa: BLE001
        print("  FAIL  the package under test could be imported")
        print("        evidence: %s: %s" % (type(exc).__name__, exc))
        print("DETECTOR-RESULT: rule=3 FAIL")
        return 2

    def write_record(day, status="ACTIVE", earnings=1025, balance=1025, pending=0):
        path = os.path.join(root, "state", "operator-state.json")
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8") as handle:
                document = json.load(handle)
        else:
            document = operator_state.template_document()
        document["records"].append(
            {
                "day_key": day,
                "entered_at_utc": "%sT08:00:00Z" % day,
                "account_status": status,
                "earnings_total_cents": earnings,
                "balance_cents": balance,
                "pending_cents": pending,
                "currency": "USD",
            }
        )
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as handle:
            json.dump(document, handle, indent=2)

    def run_day(moment):
        text = io.StringIO()
        with contextlib.redirect_stdout(text):
            code = run_daily_check.run(["--source", "operator_state"], now=moment)
        return code, text.getvalue().strip()

    day_keys = [gate.day_key(BASE_DAY + timedelta(days=offset)) for offset in range(4)]
    check(
        "the four probe days are four distinct operator-local calendar days",
        len(set(day_keys)) == 4 and all(len(key) == 10 for key in day_keys),
        "days=%s" % day_keys,
    )

    alerts_path = os.path.join(root, "alerts", "alerts.jsonl")

    try:
        # ---- day 1: first ever reading -> baseline, no notification
        write_record(day_keys[0], earnings=1025, balance=1025)
        code1, text1 = run_day(BASE_DAY)
        check(
            "day 1 (first reading) is a baseline and notifies nobody",
            code1 == 0 and "INITIAL_BASELINE" in text1 and delivery_count(root) == 0,
            "exit=%s deliveries=%d stdout=%r" % (code1, delivery_count(root), text1[:160]),
        )

        # ---- day 2: earnings change -> exactly one line and one delivery
        before2 = len(read_jsonl(alerts_path))
        write_record(day_keys[1], earnings=1050, balance=1050)
        code2, text2 = run_day(BASE_DAY + timedelta(days=1))
        day2_lines = read_jsonl(alerts_path)[before2:]
        earnings_lines = [line for line in day2_lines if line.get("event_type") == "EARNINGS_CHANGED"]
        deliveries2 = delivery_count(root)
        check(
            "day 2 (earnings 1025 -> 1050) is detected and notified",
            code2 == 0 and "EARNINGS_CHANGED" in text2 and len(earnings_lines) == 1 and deliveries2 == 1,
            "exit=%s EARNINGS_CHANGED lines=%d deliveries=%d stdout=%r"
            % (code2, len(earnings_lines), deliveries2, text2[:200]),
        )
        check(
            "day 2 emitted exactly one change line for the earnings move",
            len([line for line in day2_lines if line.get("event_type") != "APPROVAL_PENDING"]) == 1,
            "change lines on day 2 = %s (APPROVAL_PENDING is the R4 enqueue notice, not a notification)"
            % [line.get("event_type") for line in day2_lines],
        )
        if earnings_lines:
            observed = earnings_lines[0].get("observed") or {}
            check(
                "the earnings change line records the old and the new value",
                observed.get("old_value") == 1025 and observed.get("new_value") == 1050,
                "observed=%s" % json.dumps(observed, sort_keys=True),
            )

        # ---- day 3: no change -> log-only, zero deliveries
        before3 = len(read_jsonl(alerts_path))
        deliveries_before3 = delivery_count(root)
        write_record(day_keys[2], earnings=1050, balance=1050)
        code3, text3 = run_day(BASE_DAY + timedelta(days=2))
        day3_lines = read_jsonl(alerts_path)[before3:]
        check(
            "day 3 (no change) notifies nobody",
            delivery_count(root) == deliveries_before3,
            "deliveries before=%d after=%d" % (deliveries_before3, delivery_count(root)),
        )
        check(
            "day 3 (no change) is reported as OK_NO_CHANGE in the alert log",
            code3 == 0
            and "OK_NO_CHANGE" in text3
            and [line.get("event_type") for line in day3_lines] == ["OK_NO_CHANGE"],
            "exit=%s event_types on day 3 = %s stdout=%r"
            % (code3, [line.get("event_type") for line in day3_lines], text3[:160]),
        )

        # ---- day 4: account-status change -> notified
        before4 = len(read_jsonl(alerts_path))
        deliveries_before4 = delivery_count(root)
        write_record(day_keys[3], status="LIMITED", earnings=1050, balance=1050)
        code4, text4 = run_day(BASE_DAY + timedelta(days=3))
        day4_lines = read_jsonl(alerts_path)[before4:]
        status_lines = [line for line in day4_lines if line.get("event_type") == "STATUS_CHANGED"]
        check(
            "day 4 (status ACTIVE -> LIMITED) is detected and notified",
            code4 == 0
            and len(status_lines) == 1
            and delivery_count(root) == deliveries_before4 + 1
            and "STATUS_CHANGED" in text4,
            "exit=%s STATUS_CHANGED lines=%d deliveries delta=%d stdout=%r"
            % (
                code4,
                len(status_lines),
                delivery_count(root) - deliveries_before4,
                text4[:200],
            ),
        )
    except Exception as exc:  # noqa: BLE001 - fail closed
        check("the detector ran to completion", False, "%s: %s" % (type(exc).__name__, exc))

    for name, ok, evidence in results:
        print("  %s  %s" % ("PASS" if ok else "FAIL", name))
        print("        evidence: %s" % evidence)
    failed = [name for name, ok, _ in results if not ok]
    if not results:
        print("  FAIL  the detector produced no checks at all")
        print("DETECTOR-RESULT: rule=3 FAIL")
        return 2
    if failed:
        print("DETECTOR-RESULT: rule=3 FAIL (%d of %d checks failed)" % (len(failed), len(results)))
        return 1
    print("DETECTOR-RESULT: rule=3 PASS (%d checks)" % len(results))
    return 0


if __name__ == "__main__":
    sys.exit(main())
