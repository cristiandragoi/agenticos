"""R3 Stream S probe 2: drive the WIRED routine end-to-end in a THROWAWAY root.
No network. No real state root touched. Usage: probe_operator_source.py <empty|present>
"""
import os
import sys

PKG = r"D:/AgenticOS/monitoring/freecash"
sys.path.insert(0, PKG)

mode = sys.argv[1]
root = os.environ["FREECASH_DATA_ROOT"]
print("mode =", mode, " THROWAWAY root =", root)

import paths
import gate
import operator_state
import run_daily_check

today = gate.day_key()
print("operator-local day_key =", today)
print("paths.data_root() =", paths.data_root())
assert str(paths.data_root()).lower().startswith(os.environ["LOCALAPPDATA"].lower()), "refusing: not under Temp"

paths.ensure_layout()

if mode == "present":
    operator_state.ensure_template()
    doc = operator_state.load_document()
    doc["records"] = [{
        "day_key": today,
        "entered_at_utc": paths.iso_utc(),
        "account_status": "ACTIVE",
        "earnings_total_cents": 1340,
        "balance_cents": 1340,
        "pending_cents": 0,
        "currency": "USD",
    }]
    paths.write_json_atomic(paths.operator_state_path(), doc)

rc = run_daily_check.main(["--source", "operator_state"])
print("exit =", rc)
print("snapshot =", (paths.snapshots_dir() / ("%s.json" % today)).read_text())
print("alerts =", paths.alerts_path().read_text())
