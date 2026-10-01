"""driver-catchup-sim.py -- simulate a machine that was asleep at the fire time.

Runs the canonical entry point with an INJECTED clock (run_daily_check.run(now=...))
against a sandbox FREECASH_DATA_ROOT, to answer: if the scheduler could not fire on
day D, what happens when it finally fires on day D+n?  Proves/refutes back-filling.

NOT a scheduler. It registers nothing. Usage:
    FREECASH_DATA_ROOT=<sandbox> FREECASH_TOAST_STUB=1 \
        <VENV>/python driver-catchup-sim.py 2026-10-02
"""
import os
import sys
from datetime import datetime
from zoneinfo import ZoneInfo

sys.path.insert(0, "D:/AgenticOS/monitoring/freecash")

import run_daily_check  # noqa: E402

wake_day = sys.argv[1] if len(sys.argv) > 1 else "2026-10-02"
moment = datetime.fromisoformat(wake_day + "T08:30:00").replace(tzinfo=ZoneInfo("Europe/Berlin"))
rc = run_daily_check.run(argv=[], now=moment)
print("driver: wake=%s rc=%s" % (wake_day, rc))
