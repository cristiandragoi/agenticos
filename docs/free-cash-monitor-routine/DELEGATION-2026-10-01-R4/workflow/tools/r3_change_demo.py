"""r3_change_demo.py -- operator R3 NOTIFY ON CHANGE, demonstrated end to end, offline.

Operator numbering: R3 = NOTIFY ON CHANGE ("tell me when earnings or account status
changes").  Shipped code labels this R3 too -- no inversion here.

What one run of this script shows, in a THROWAWAY root:
    day 1 record (earnings 1025c)      -> INITIAL_BASELINE, notifications=0 (baseline, silent)
    day 2 record (earnings 1340c)      -> EARNINGS_CHANGED, notifications=1, alert line,
                                          dedupe key persisted, one approval item enqueued
    the SAME change dispatched again   -> DEDUPED, no second delivery
The toast channel is the routine's own stub (FREECASH_TOAST_STUB=1) so nothing leaves the
process and the delivery label is STUB_OK, never TOAST_OK.

Usage: python r3_change_demo.py <root> <routine_dir> <day1> <day2>
"""

import hashlib
import json
import os
import sys
from pathlib import Path

ROOT = Path(sys.argv[1])
ROUTINE = sys.argv[2]
DAY1 = sys.argv[3]
DAY2 = sys.argv[4]

sys.path.insert(0, ROUTINE)
os.environ["FREECASH_DATA_ROOT"] = str(ROOT)
os.environ["FREECASH_TZ"] = "Europe/Berlin"
os.environ["FREECASH_TOAST_STUB"] = "1"
os.environ["FREECASH_TOAST_RETRY_SLEEP_SECONDS"] = "0"

import datetime  # noqa: E402

import approval_queue  # noqa: E402
import changedetect  # noqa: E402
import notify  # noqa: E402
import paths  # noqa: E402
import run_daily_check  # noqa: E402


def moment(day, hour=6):
    return datetime.datetime.fromisoformat("%sT%02d:00:00+00:00" % (day, hour))


def write_record(day, earnings):
    state_file = ROOT / "state" / "operator-state.json"
    if state_file.exists():
        document = json.loads(state_file.read_text(encoding="utf-8"))
    else:
        import operator_state

        document = operator_state.template_document()
    document["records"].append(
        {
            "day_key": day,
            "entered_at_utc": "%sT06:40:00Z" % day,
            "account_status": "ACTIVE",
            "earnings_total_cents": earnings,
            "balance_cents": earnings,
            "pending_cents": 0,
            "currency": "USD",
        }
    )
    state_file.parent.mkdir(parents=True, exist_ok=True)
    state_file.write_text(json.dumps(document, indent=2) + "\n", encoding="utf-8")


def alerts():
    return paths.read_jsonl(paths.alerts_path())


def stub_lines():
    path = paths.logs_dir() / "toast-stub.log"
    if not path.exists():
        return []
    return [line for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def bar(title):
    print("\n" + "=" * 78)
    print(title)
    print("=" * 78)


def main() -> int:
    paths.ensure_layout()
    failures = []

    bar("STEP 1 -- day 1 (%s): first reading for the account" % DAY1)
    write_record(DAY1, 1025)
    rc = run_daily_check.run(argv=[], now=moment(DAY1))
    print("run_daily_check.run(now=%s) -> exit=%s" % (moment(DAY1).isoformat(), rc))
    print("alerts.jsonl day1 types: %s" % [r["event_type"] for r in alerts()])
    print("toast-stub lines: %d" % len(stub_lines()))

    bar("STEP 2 -- day 2 (%s): earnings moved 1025 -> 1340 cents" % DAY2)
    write_record(DAY2, 1340)
    before = len(stub_lines())
    rc = run_daily_check.run(argv=[], now=moment(DAY2))
    print("run_daily_check.run(now=%s) -> exit=%s" % (moment(DAY2).isoformat(), rc))
    day2_alerts = [r for r in alerts() if r["day_key"] == DAY2]
    for record in day2_alerts:
        print("ALERT event_type=%s severity=%s dedupe_key=%s"
              % (record["event_type"], record["severity"], record["dedupe_key"]))
    for record in day2_alerts:
        if record["event_type"] == "EARNINGS_CHANGED":
            print("\n--- the change notification, verbatim (alert record 'message' field) ---")
            print(record["message"])
            print("--- end message ---")
    print("\ntoast-stub lines: %d -> %d (delta %d)" % (before, len(stub_lines()), len(stub_lines()) - before))
    print("\n--- notifications/approvals reported by the run ---")
    print("approval items pending: %d" % len(approval_queue.pending_items()))
    if approval_queue.pending_items():
        item = approval_queue.pending_items()[-1]
        print("approval item: id=%s status=%s execution_state=%s expires_at_utc=%r "
              "execution_allowed_by_this_routine=%r"
              % (item["approval_id"], item["status"], item["execution_state"],
                 item["expires_at_utc"], item["execution_allowed_by_this_routine"]))
        print("proposed_action: %s" % json.dumps(item["proposed_action"], sort_keys=True))

    bar("STEP 3 -- the dedupe key")
    prior = changedetect.load_snapshot(DAY1)
    current = changedetect.load_snapshot(DAY2)
    verdict = changedetect.compare(prior, current)
    print("changedetect.compare(day1_snapshot, day2_snapshot) = %s" % json.dumps(verdict, sort_keys=True))
    change = verdict["changes"][0]
    key = changedetect.dedupe_key(DAY2, change["change_type"], change["field"],
                                  change["old_value"], change["new_value"])
    subject = "%s|%s|%s|%s|%s" % (DAY2, change["change_type"], change["field"],
                                  change["old_value"], change["new_value"])
    print("subject                : %s" % subject)
    print("sha256(subject)        : %s" % hashlib.sha256(subject.encode()).hexdigest())
    print("changedetect.dedupe_key: %s" % key)
    print("match                  : %s" % (key == hashlib.sha256(subject.encode()).hexdigest()))
    keys_doc = json.loads(paths.notified_keys_path().read_text(encoding="utf-8"))
    entry = keys_doc["keys"].get(key)
    print("notified-keys.json entry for that key: %s" % json.dumps(entry, sort_keys=True))
    if entry is None:
        failures.append("the change notification's dedupe key was not persisted")

    bar("STEP 4 -- the SAME change dispatched a second time: dedupe must suppress it")
    before = len(stub_lines())
    result = notify.notify_change(DAY2, change,
                                  notify.message_for_change(DAY2, change, current, prior,
                                                            source_note="operator-entered"),
                                  key, sleep_seconds=0)
    print("notify.notify_change(same key) -> %r" % result)
    print("toast-stub lines: %d -> %d (delta %d)" % (before, len(stub_lines()), len(stub_lines()) - before))
    if result != "DEDUPED":
        failures.append("a repeated change was not deduped")
    if len(stub_lines()) != before:
        failures.append("a deduped change produced a second delivery")

    bar("VERDICT")
    print("PASS conditions: change detected, exactly one delivery, key persisted, repeat deduped")
    for item in failures:
        print("OPEN DEFECT: %s" % item)
    print("RESULT: %s" % ("PASS" if not failures else "FAIL (%d)" % len(failures)))
    return 0 if not failures else 1


if __name__ == "__main__":
    sys.exit(main())
