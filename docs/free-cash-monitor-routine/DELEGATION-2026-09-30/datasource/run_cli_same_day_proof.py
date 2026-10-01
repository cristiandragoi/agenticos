#!/usr/bin/env python
"""run_cli_same_day_proof.py -- the SAME day twice through the real CLI, real clock.

This is the production-path companion to run_change_detection_proof.py. It runs
`monitoring/freecash/run_daily_check.py` as a child process (no clock seam, no
in-process API) against a fresh throwaway root, twice on the same real
operator-local day, and shows:

    first  run -> RUN_OK ... outcome=INITIAL_BASELINE
    second run -> SKIP_DUPLICATE_DAY  (exit 0, no read, no snapshot, no ledger write)

It cannot show a *change*: the CLI has no way to move the day key (see the
deliverable's section (c)). It is here to prove the duplicate-day path is real on
the production entry point, not only inside the in-process seam.

Safety: throwaway root only; no scheduler entry; no git verb; no network.
"""

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = Path("D:/AgenticOS")
ROUTINE = REPO / "monitoring" / "freecash"
PROD_ROOT = REPO / "data" / "freecash-monitor"

THROWAWAY = HERE / "_state-root-cli"
OUT = HERE / "run-output-cli.txt"


def main() -> int:
    lines = []

    def emit(text=""):
        lines.append(text)
        print(text)

    if THROWAWAY.exists():
        shutil.rmtree(THROWAWAY)
    THROWAWAY.mkdir(parents=True, exist_ok=True)

    sys.path.insert(0, str(ROUTINE))
    import gate
    import operator_state

    env = dict(os.environ)
    env["FREECASH_DATA_ROOT"] = str(THROWAWAY)
    env["FREECASH_TZ"] = "Europe/Berlin"
    env["FREECASH_TOAST_STUB"] = "1"
    env["FREECASH_TOAST_RETRY_SLEEP_SECONDS"] = "0"
    env.pop("FREECASH_READ_SOURCE", None)
    env.pop("FREECASH_READ_BASE_URL", None)

    today = gate.day_key()                        # REAL clock, REAL tz
    emit("=" * 78)
    emit("REAL-CLOCK CLI PROOF")
    emit("=" * 78)
    emit("interpreter      : %s" % sys.executable)
    emit("throwaway root   : %s" % THROWAWAY)
    emit("real local day   : %s" % today)
    emit("")

    # seed today's operator record using the routine's own document format
    state_path = THROWAWAY / "state" / "operator-state.json"
    state_path.parent.mkdir(parents=True, exist_ok=True)
    doc = operator_state.template_document()
    doc["records"].append({
        "day_key": today,
        "entered_at_utc": "%sT06:40:00Z" % today,
        "account_status": "ACTIVE",
        "earnings_total_cents": 1025,
        "balance_cents": 1025,
        "pending_cents": 0,
        "currency": "USD",
    })
    state_path.write_text(json.dumps(doc, indent=2), encoding="utf-8")
    emit("seeded %s with one record (earnings_total_cents=1025)" % state_path)
    emit("")

    cmd = [sys.executable, str(ROUTINE / "run_daily_check.py")]
    for label in ("first run (consumes the day)", "second run (same day, duplicate)"):
        proc = subprocess.run(cmd, capture_output=True, text=True, env=env,
                              cwd=str(REPO), timeout=120)
        emit("--- CLI %s ---" % label)
        emit("  command : %s" % " ".join(cmd))
        emit("  exit    : %d" % proc.returncode)
        for line in (proc.stdout or "").splitlines():
            emit("  stdout  : %s" % line)
        for line in (proc.stderr or "").splitlines():
            emit("  stderr  : %s" % line)
        emit("")

    emit("day-locks present: %s" % sorted(p.name for p in (THROWAWAY / "state" / "day-locks").glob("*.lock")))
    emit("snapshots present: %s" % sorted(p.name for p in (THROWAWAY / "snapshots").glob("*.json")))
    alerts = THROWAWAY / "alerts" / "alerts.jsonl"
    raw = [l for l in alerts.read_text(encoding="utf-8").splitlines() if l.strip()] if alerts.exists() else []
    emit("alerts.jsonl rows: %d" % len(raw))
    for i, line in enumerate(raw, 1):
        emit("  [%02d] %s" % (i, line))
    nk = THROWAWAY / "state" / "notified-keys.json"
    emit("notified-keys.json: %s" % (nk.read_text(encoding="utf-8").strip() if nk.exists() else "(absent - baseline dispatches nothing)"))
    emit("prod root operator-state.json size: %s" % (PROD_ROOT / "state" / "operator-state.json").stat().st_size)

    OUT.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\nwrote %s" % OUT)
    return 0


if __name__ == "__main__":
    sys.exit(main())
