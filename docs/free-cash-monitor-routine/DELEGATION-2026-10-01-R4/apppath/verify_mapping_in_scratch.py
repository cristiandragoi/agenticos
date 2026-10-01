#!/usr/bin/env python
"""verify_mapping_in_scratch.py -- Stream A, DELEGATION-2026-10-01-R4.

Demonstrates the app-path (Path B) four-field record mapped into the ROUTINE's own
source shape, end-to-end, WITHOUT touching the production root:

  * copies ``monitoring/freecash`` into this stream's own directory (routine_copy/);
  * exports a throwaway ``FREECASH_DATA_ROOT`` under %LOCALAPPDATA%\\Temp;
  * exercises ``run_daily_check`` with an injected clock (no real day consumed);
  * routes notification delivery through notify._stub_send (no real toast).

Two scenarios, each on its own throwaway root (day1 FULL, day2 PATH-B partial):

  Scenario A -- the PATH-B record OMITS ``currency``:
      compare() sees currency USD -> None, prints "currency changed ... money
      comparison skipped", and emits NO money change.  The session-state change
      survives as exactly one STATUS_CHANGED.
  Scenario B -- the PATH-B record CARRIES ``currency="USD"`` (same as the baseline):
      currency matches, so the null earnings/pending are compared against the prior
      integers and the routine emits SPURIOUS EARNINGS_CHANGED lines (old int ->
      new None).  This is the concrete reason the routine needs a change before it
      can consume a status-only Path-B reading safely.

Exit 0 if both scenarios reproduce the documented behaviour, else 1.
"""

from __future__ import annotations

import datetime as _dt
import json
import os
import shutil
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
PKG_SRC = Path("D:/AgenticOS/monitoring/freecash")
COPY = HERE / "routine_copy" / "freecash"
LOCALAPPDATA = Path(os.environ["LOCALAPPDATA"])
BASE_SCRATCH = LOCALAPPDATA / "Temp" / ("fcr4-apppath-mapping-%d" % os.getpid())
PROD_ROOT = Path("D:/AgenticOS/data/freecash-monitor")

UTC = _dt.timezone.utc
DAY1 = _dt.datetime(2026, 9, 29, 12, 0, 0, tzinfo=UTC)
DAY2 = _dt.datetime(2026, 9, 30, 12, 0, 0, tzinfo=UTC)


def bind(root: Path):
    os.environ["FREECASH_DATA_ROOT"] = str(root)
    for mod in ("paths", "gate", "notify", "operator_state", "changedetect", "run_daily_check"):
        sys.modules.pop(mod, None)
    import gate, notify, operator_state, paths, run_daily_check  # noqa: E402
    assert str(paths.data_root()).lower().startswith(str(LOCALAPPDATA).lower()), "data_root escaped Temp"
    paths.ensure_layout()
    notify.set_sender(notify._stub_send)
    return gate, notify, operator_state, paths, run_daily_check


def scenario(name, include_currency):
    root = BASE_SCRATCH / name / "root"
    print("\n" + "=" * 74)
    print("SCENARIO %s  (Path-B record currency: %s)" % (name, "USD" if include_currency else "omitted"))
    print("scratch root: %s" % root)
    gate, notify, operator_state, paths, run_daily_check = bind(root)

    def put(day_key, rec):
        operator_state.ensure_template()
        doc = operator_state.load_document() or {}
        doc["records"] = [rec]
        paths.write_json_atomic(paths.operator_state_path(), doc)

    d1, d2 = gate.day_key(DAY1), gate.day_key(DAY2)
    put(d1, {"day_key": d1, "entered_at_utc": paths.iso_utc(DAY1), "account_status": "ACTIVE",
             "earnings_total_cents": 1340, "balance_cents": 1340, "pending_cents": 0, "currency": "USD"})
    print("-- day1 FULL --")
    run_daily_check.run(["--source", "operator_state"], now=DAY1, sender=notify._stub_send)

    bridge = {"day_key": d2, "entered_at_utc": paths.iso_utc(DAY2),
              "account_status": "SESSION_AUTHENTICATED",
              "earnings_total_cents": None, "balance_cents": None, "pending_cents": None,
              "source": "apppath_session_proxy"}
    if include_currency:
        bridge["currency"] = "USD"
    put(d2, bridge)
    print("-- day2 PATH-B (session proxy + three nulls) --")
    before = len(paths.read_jsonl(paths.alerts_path()))
    run_daily_check.run(["--source", "operator_state"], now=DAY2, sender=notify._stub_send)
    alerts = paths.read_jsonl(paths.alerts_path())[before:]
    kinds = [a.get("event_type") for a in alerts]
    for a in alerts:
        print("   ALERT %-18s %s" % (a.get("event_type"), (a.get("message") or "").splitlines()[0][:110]))
    snap = json.loads((paths.snapshots_dir() / ("%s.json" % d2)).read_text())
    print("day2 snapshot: status=%r earnings=%r balance=%r pending=%r currency=%r"
          % (snap["account_status"], snap["earnings_total_cents"], snap["balance_cents"],
             snap["pending_cents"], snap["currency"]))
    return kinds


def main() -> int:
    print("== verify_mapping_in_scratch.py ==")
    assert str(BASE_SCRATCH).lower().startswith(str(LOCALAPPDATA).lower()), "scratch not under LocalAppData"
    assert PROD_ROOT not in BASE_SCRATCH.parents, "scratch nested under production root"
    if COPY.exists():
        shutil.rmtree(COPY)
    shutil.copytree(PKG_SRC, COPY, ignore=shutil.ignore_patterns("__pycache__"))
    sys.path.insert(0, str(COPY))
    print("package copy : %s" % COPY)

    k_a = scenario("A-bridge-omits-currency", include_currency=False)
    k_b = scenario("B-bridge-carries-currency", include_currency=True)

    failures = []
    if any(k in ("EARNINGS_CHANGED", "BALANCE_CHANGED") for k in k_a):
        failures.append("A: expected no money change when currency is omitted; got %s" % k_a)
    if "STATUS_CHANGED" not in k_a:
        failures.append("A: expected the session-state STATUS_CHANGED; got %s" % k_a)
    if "EARNINGS_CHANGED" not in k_b:
        failures.append("B: expected the spurious null-vs-int EARNINGS_CHANGED; got %s" % k_b)

    print("\n" + "=" * 74)
    print("production root: %s (never used as FREECASH_DATA_ROOT)" % PROD_ROOT)
    print("FAILURES: %s" % (failures or "none"))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
