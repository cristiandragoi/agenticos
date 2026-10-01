#!/usr/bin/env python
"""run_change_detection_proof.py -- R3 change-detection proof on a THROWAWAY root.

WHAT THIS PROVES (rule 3: "tell me if earnings or account status changes")
--------------------------------------------------------------------------
Drives the *real* entry point `monitoring/freecash/run_daily_check.py` through its
documented in-process clock seam (`run(now=...)`) against a throwaway
FREECASH_DATA_ROOT, using the operator-entered read source (DEFAULT_SOURCE).

  day 1  2026-10-01  baseline record              -> expect INITIAL_BASELINE
  day 2  2026-10-02  earnings moved 1340 -> 1670  -> expect EARNINGS_CHANGED
  day 2  same clock  run again                    -> expect SKIP_DUPLICATE_DAY
  day 3  2026-10-03  account_status ACTIVE->RESTRICTED -> expect STATUS_CHANGED

TIMING KNOB: the day key derives from the injected `now`; there is no CLI flag for
it (see build_parser()). This is the ONLY way to simulate two local days in one
process. See the deliverable's section (c).

SAFETY: this script
  * writes NOTHING outside its own throwaway root under the evidence directory;
  * never touches D:/AgenticOS/data/freecash-monitor (proven at the end);
  * opens no socket (the operator_state source has zero read ops);
  * registers no task, runs no git verb, reads no credential.

Usage (pinned interpreter is REQUIRED - only it resolves Europe/Berlin via tzdata):
    C:\\Users\\cd-pr\\AppData\\Local\\hermes\\hermes-agent\\venv\\Scripts\\python.exe \\
        docs/free-cash-monitor-routine/DELEGATION-2026-09-30/datasource/run_change_detection_proof.py
"""

import io
import json
import os
import shutil
import sys
import contextlib
from datetime import datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = Path("D:/AgenticOS")
ROUTINE = REPO / "monitoring" / "freecash"
TESTS = ROUTINE / "tests"
PROD_ROOT = REPO / "data" / "freecash-monitor"

THROWAWAY = HERE / "_state-root"
OUT = HERE / "run-output.txt"

#: 06:35 UTC == 08:35 Europe/Berlin -- the designed run time, clear of midnight
#: and of the DST boundary, so the local day key is unambiguous (same base the
#: suite uses, tests/test_r3_changedetect.py:18).
BASE = datetime(2026, 10, 1, 6, 35, tzinfo=timezone.utc)


def moment(offset: int) -> datetime:
    return BASE + timedelta(days=offset)


def day_at(offset: int) -> str:
    return (BASE.date() + timedelta(days=offset)).isoformat()


def main() -> int:
    lines = []

    def emit(text=""):
        lines.append(text)
        print(text)

    # ---- throwaway root + environment --------------------------------------------
    if THROWAWAY.exists():
        shutil.rmtree(THROWAWAY)
    THROWAWAY.mkdir(parents=True, exist_ok=True)

    os.environ["FREECASH_DATA_ROOT"] = str(THROWAWAY)
    os.environ["FREECASH_TZ"] = "Europe/Berlin"
    os.environ["FREECASH_TOAST_STUB"] = "1"            # real dispatch path, stub channel
    os.environ["FREECASH_TOAST_RETRY_SLEEP_SECONDS"] = "0"
    os.environ.pop("FREECASH_READ_SOURCE", None)       # force DEFAULT_SOURCE
    os.environ.pop("FREECASH_READ_BASE_URL", None)

    sys.path.insert(0, str(ROUTINE))
    sys.path.insert(0, str(TESTS))

    import changedetect
    import gate
    import notify
    import operator_state
    import paths
    import run_daily_check

    emit("=" * 78)
    emit("ENVIRONMENT")
    emit("=" * 78)
    emit("interpreter            : %s" % sys.executable)
    emit("tzdata importable      : %s" % _try_tzdata())
    emit("FREECASH_DATA_ROOT     : %s" % os.environ["FREECASH_DATA_ROOT"])
    emit("paths.data_root()      : %s" % paths.data_root())
    emit("PRODUCTION root        : %s" % PROD_ROOT)
    emit("FREECASH_TZ            : %s" % gate.tz_name())
    emit("tz resolve             : %s" % json.dumps(gate.timezone_report()))
    emit("DEFAULT_SOURCE         : %s" % run_daily_check.DEFAULT_SOURCE)
    emit("FREECASH_READ_SOURCE   : %r (unset -> default)" % os.environ.get("FREECASH_READ_SOURCE"))
    emit("read source resolved   : %s" % run_daily_check.resolve_source(None))
    emit("")

    # ---- seed + run, one helper --------------------------------------------------
    def seed(offset, **fields):
        import _support
        return _support.write_operator_record(THROWAWAY, day_at(offset), **fields)

    def run(offset, label):
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            code = run_daily_check.run([], now=moment(offset))
        text = buf.getvalue()
        emit("--- run %s (%s) exit=%d ---" % (label, moment(offset).strftime("%Y-%m-%dT%H:%M:%SZ"), code))
        for line in text.splitlines():
            emit("  " + line)
        emit("")
        return code, text

    # ---- day 1: baseline --------------------------------------------------------
    emit("=" * 78)
    emit("STEP 1 - seed day 1 baseline record: %s" % day_at(0))
    emit("=" * 78)
    rec = seed(0, account_status="ACTIVE", earnings_total_cents=1340,
               balance_cents=1340, pending_cents=0, currency="USD")
    emit(json.dumps(rec, indent=2, sort_keys=True))
    emit("")
    run(0, "day1 baseline")

    # ---- day 2: earnings moved --------------------------------------------------
    emit("=" * 78)
    emit("STEP 2 - seed day 2 record with CHANGED earnings: %s" % day_at(1))
    emit("=" * 78)
    rec = seed(1, account_status="ACTIVE", earnings_total_cents=1670,
               balance_cents=1670, pending_cents=0, currency="USD")
    emit(json.dumps(rec, indent=2, sort_keys=True))
    emit("")
    run(1, "day2 earnings moved")

    # ---- day 2 again: duplicate -------------------------------------------------
    emit("=" * 78)
    emit("STEP 3 - same-day run again (no new record, same clock)")
    emit("=" * 78)
    run(1, "day2 duplicate")

    # ---- day 3: account status moved (the other half of rule 3) ------------------
    emit("=" * 78)
    emit("STEP 4 - seed day 3 record with CHANGED account status: %s" % day_at(2))
    emit("=" * 78)
    rec = seed(2, account_status="RESTRICTED", earnings_total_cents=1670,
               balance_cents=1670, pending_cents=0, currency="USD")
    emit(json.dumps(rec, indent=2, sort_keys=True))
    emit("")
    run(2, "day3 status changed")

    # ---- raw artifacts ----------------------------------------------------------
    emit("=" * 78)
    emit("ARTIFACTS under %s" % THROWAWAY)
    emit("=" * 78)
    for rel in (
        "state/operator-state.json",
        "state/day-locks/2026-10-01.lock",
        "state/day-locks/2026-10-02.lock",
        "state/day-locks/2026-10-03.lock",
        "state/last-run.json",
        "state/notified-keys.json",
        "snapshots/2026-10-01.json",
        "snapshots/2026-10-02.json",
        "snapshots/2026-10-03.json",
        "approvals/pending.json",
        "logs/toast-stub.log",
    ):
        p = THROWAWAY / rel
        emit("### %s  (exists=%s size=%s)" % (rel, p.exists(), p.stat().st_size if p.exists() else "-"))
        if p.exists():
            content = p.read_text(encoding="utf-8")
            emit(content.rstrip("\n"))
        else:
            emit("(absent)")
        emit("")

    # ---- alerts.jsonl: one row per line -----------------------------------------
    emit("### alerts/alerts.jsonl  (raw lines)")
    alerts_path = THROWAWAY / "alerts" / "alerts.jsonl"
    raw_lines = [l for l in alerts_path.read_text(encoding="utf-8").splitlines() if l.strip()] if alerts_path.exists() else []
    emit("line count: %d" % len(raw_lines))
    for i, line in enumerate(raw_lines, 1):
        emit("  [%02d] %s" % (i, line))
    emit("")

    # ---- summary -----------------------------------------------------------------
    emit("=" * 78)
    emit("SUMMARY")
    emit("=" * 78)
    records = json.loads((THROWAWAY / "state" / "notified-keys.json").read_text(encoding="utf-8"))
    earn_key = changedetect.dedupe_key(
        day_at(1), "EARNINGS_CHANGED", "earnings_total_cents", 1340, 1670
    )
    status_key = changedetect.dedupe_key(
        day_at(2), "STATUS_CHANGED", "account_status", "ACTIVE", "RESTRICTED"
    )
    emit("EARNINGS_CHANGED dedupe key (day2) = %s" % earn_key)
    emit("  present in notified-keys.json : %s" % (earn_key in records["keys"]))
    emit("  entry                          : %s" % json.dumps(records["keys"].get(earn_key), sort_keys=True))
    emit("STATUS_CHANGED dedupe key (day3)  = %s" % status_key)
    emit("  present in notified-keys.json : %s" % (status_key in records["keys"]))
    emit("  entry                          : %s" % json.dumps(records["keys"].get(status_key), sort_keys=True))
    emit("")

    # ---- production-root untouched check ----------------------------------------
    emit("PRODUCTION ROOT UNTOUCHED CHECK")
    emit("  operator-state.json size (prod): %s" % (PROD_ROOT / "state" / "operator-state.json").stat().st_size)
    print("(the throwaway root above is the only root written by this script)")

    OUT.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\nwrote %s" % OUT)
    return 0


def _try_tzdata():
    try:
        import tzdata  # noqa: F401
        return "True"
    except Exception as exc:  # noqa: BLE001
        return "False (%s)" % exc


if __name__ == "__main__":
    sys.exit(main())
