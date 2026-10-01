#!/usr/bin/env python
"""run_operator_fallback_proof.py -- the zero-provider-integration fallback, proven.

WHAT THIS IS
------------
Requirement (4) of DATASOURCE-RESEARCH-PLAN-V2: drive the REAL entry point
`monitoring/freecash/run_daily_check.py` with

    FREECASH_READ_SOURCE=operator_state

against a THROWAWAY `FREECASH_DATA_ROOT`, with a `records[]` list populated for
two local days, so that

    day 1  2026-10-01  first real earnings figure  -> INITIAL_BASELINE
    day 2  2026-10-02  earnings moved              -> EARNINGS_CHANGED

WHY A DRIVER AND NOT THREE CLI LINES
------------------------------------
`run_daily_check.py`'s argparse surface (build_parser) has NO flag to set "now",
and `gate.day_key()` takes the day from the real clock. A single process cannot
therefore reach two *different* operator-local days through the CLI alone. The
routine ships exactly one documented seam for this: `run(now=...)`
(run_daily_check.py:265-273, "``now`` is a test seam: it pins the whole run's
clock"). The driver calls that real function twice -- it is the same code path
the CLI calls, not a re-implementation.

SAFETY (hard constraints of this pass)
--------------------------------------
  * writes ONLY inside its own throwaway root under %TEMP%;
  * never writes to D:/AgenticOS/data/freecash-monitor (checked at the end);
  * opens no socket -- the operator_state source has zero read ops;
  * contacts no provider, reads no credential, registers no scheduled task,
    runs no git verb.

Run with the PINNED interpreter (only it resolves Europe/Berlin via tzdata):
    C:/Users/cd-pr/AppData/Local/hermes/hermes-agent/venv/Scripts/python.exe \
        D:/AgenticOS/docs/free-cash-monitor-routine/DELEGATION-2026-10-01/datasource/run_operator_fallback_proof.py
"""

import contextlib
import io
import json
import os
import shutil
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = Path("D:/AgenticOS")
ROUTINE = REPO / "monitoring" / "freecash"
PROD_ROOT = REPO / "data" / "freecash-monitor"
OUT = HERE / "run-output-operator-fallback.txt"

#: 06:35 UTC == 08:35 Europe/Berlin -- the designed run time, clear of midnight
#: and of the DST boundary, so the operator-local day key is unambiguous.
BASE = datetime(2026, 10, 1, 6, 35, tzinfo=timezone.utc)

THROWAWAY = Path(tempfile.gettempdir()) / ("freecash-datasource-v2-%d" % os.getpid())


def moment(offset):
    return BASE + timedelta(days=offset)


def day_at(offset):
    return (BASE.date() + timedelta(days=offset)).isoformat()


def tzdata_available():
    try:
        import tzdata  # noqa: F401
        return "True"
    except Exception as exc:  # noqa: BLE001
        return "False (%s)" % exc


def main():
    lines = []

    def emit(text=""):
        lines.append(text)
        print(text)

    # ---- throwaway root -------------------------------------------------------
    if THROWAWAY.exists():
        shutil.rmtree(THROWAWAY)
    THROWAWAY.mkdir(parents=True, exist_ok=True)

    os.environ["FREECASH_DATA_ROOT"] = str(THROWAWAY)
    os.environ["FREECASH_TZ"] = "Europe/Berlin"
    os.environ["FREECASH_READ_SOURCE"] = "operator_state"  # explicit, not the default
    os.environ["FREECASH_TOAST_STUB"] = "1"
    os.environ["FREECASH_TOAST_RETRY_SLEEP_SECONDS"] = "0"
    os.environ.pop("FREECASH_READ_BASE_URL", None)

    sys.path.insert(0, str(ROUTINE))
    import changedetect  # noqa: E402
    import gate  # noqa: E402
    import operator_state  # noqa: E402
    import paths  # noqa: E402
    import run_daily_check  # noqa: E402

    emit("=" * 78)
    emit("ENVIRONMENT")
    emit("=" * 78)
    emit("interpreter              : %s" % sys.executable)
    emit("tzdata importable        : %s" % tzdata_available())
    emit("FREECASH_DATA_ROOT       : %s" % os.environ["FREECASH_DATA_ROOT"])
    emit("paths.data_root()        : %s" % paths.data_root())
    emit("PRODUCTION root          : %s" % PROD_ROOT)
    emit("FREECASH_READ_SOURCE     : %s" % os.environ["FREECASH_READ_SOURCE"])
    emit("resolve_source(None)     : %s" % run_daily_check.resolve_source(None))
    emit("FREECASH_TZ / tz report  : %s / %s" % (gate.tz_name(), json.dumps(gate.timezone_report())))
    emit("")

    # ---- seed the populated records[] ----------------------------------------
    emit("=" * 78)
    emit("STEP 0 - populate records[] for TWO local days (operator-entered)")
    emit("=" * 78)
    doc = operator_state.template_document()
    doc["records"] = [
        {
            "day_key": day_at(0),
            "entered_at_utc": moment(0).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "account_status": "ACTIVE",
            "earnings_total_cents": 1340,
            "balance_cents": 1340,
            "pending_cents": 0,
            "currency": "USD",
        },
        {
            "day_key": day_at(1),
            "entered_at_utc": moment(1).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "account_status": "ACTIVE",
            "earnings_total_cents": 1670,
            "balance_cents": 1670,
            "pending_cents": 0,
            "currency": "USD",
        },
    ]
    paths.ensure_layout()
    paths.write_json_atomic(paths.operator_state_path(), doc)
    emit("wrote %s" % paths.operator_state_path())
    emit(json.dumps(doc, indent=2))
    emit("")

    # ---- run helper -----------------------------------------------------------
    def run(offset, label):
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            code = run_daily_check.run([], now=moment(offset))
        emit("--- run %s (%s) exit=%d ---" % (label, moment(offset).strftime("%Y-%m-%dT%H:%M:%SZ"), code))
        for line in buf.getvalue().splitlines():
            emit("  " + line)
        emit("")
        return code

    emit("=" * 78)
    emit("STEP 1 - day 1 (%s): first real earnings figure -> expect INITIAL_BASELINE" % day_at(0))
    emit("=" * 78)
    run(0, "day1 first-reading")
    emit("STEP 2 - day 2 (%s): earnings 1340 -> 1670 -> expect EARNINGS_CHANGED" % day_at(1))
    emit("=" * 78)
    run(1, "day2 earnings-moved")
    emit("STEP 3 - day 2 again (same clock): -> expect SKIP_DUPLICATE_DAY")
    emit("=" * 78)
    run(1, "day2 duplicate")
    emit("")

    # ---- artifacts ------------------------------------------------------------
    emit("=" * 78)
    emit("ARTIFACTS under %s" % THROWAWAY)
    emit("=" * 78)
    for rel in (
        "state/operator-state.json",
        "state/last-run.json",
        "state/notified-keys.json",
        "snapshots/%s.json" % day_at(0),
        "snapshots/%s.json" % day_at(1),
        "approvals/pending.json",
    ):
        p = THROWAWAY / rel
        emit("### %s  (exists=%s size=%s)" % (rel, p.exists(), p.stat().st_size if p.exists() else "-"))
        if p.exists():
            emit(p.read_text(encoding="utf-8").rstrip("\n"))
        emit("")

    emit("### alerts/alerts.jsonl  (raw lines)")
    alerts = THROWAWAY / "alerts" / "alerts.jsonl"
    raw_lines = [l for l in alerts.read_text(encoding="utf-8").splitlines() if l.strip()] if alerts.exists() else []
    emit("line count: %d" % len(raw_lines))
    for i, line in enumerate(raw_lines, 1):
        emit("  [%02d] %s" % (i, line))
    emit("")

    # ---- summary --------------------------------------------------------------
    emit("=" * 78)
    emit("SUMMARY")
    emit("=" * 78)
    keys = json.loads((THROWAWAY / "state" / "notified-keys.json").read_text(encoding="utf-8"))
    earn_key = changedetect.dedupe_key(
        day_at(1), "EARNINGS_CHANGED", "earnings_total_cents", 1340, 1670
    )
    emit("EARNINGS_CHANGED dedupe key (day2) = %s" % earn_key)
    emit("  present in notified-keys.json  : %s" % (earn_key in keys["keys"]))
    emit("  entry                          : %s" % json.dumps(keys["keys"].get(earn_key), sort_keys=True))
    emit("")

    # ---- production-root untouched --------------------------------------------
    emit("PRODUCTION ROOT UNTOUCHED CHECK")
    prod = PROD_ROOT / "state" / "operator-state.json"
    emit("  production operator-state.json size: %s (records=%s)" % (
        prod.stat().st_size if prod.exists() else "-",
        len(json.loads(prod.read_text(encoding="utf-8")).get("records", [])) if prod.exists() else "-",
    ))
    emit("  throwaway root written by this script: %s" % THROWAWAY)

    OUT.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\nwrote %s" % OUT)
    return 0


if __name__ == "__main__":
    sys.exit(main())
