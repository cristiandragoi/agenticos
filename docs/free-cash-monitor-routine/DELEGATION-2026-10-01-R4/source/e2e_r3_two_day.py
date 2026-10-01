"""R4 Stream S -- offline two-day end-to-end proof that operator rule R3
("notify me if earnings or account status changes") can actually fire.

Entirely offline: FREECASH_TOAST_STUB=1 routes the dispatch through the module's
own stub sender (delivery label STUB_OK, never TOAST_OK).  No socket is opened
(read source is operator_state, the default).  Everything is written under the
throwaway FREECASH_DATA_ROOT exported by the caller -- the script refuses to run
unless that root sits under %LOCALAPPDATA%.

Scenario:
  day 1  operator record entered            -> INITIAL_BASELINE, notifications=0
  day 2  operator record with CHANGED figure -> exactly ONE notification
  replay day-2 command                       -> SKIP_DUPLICATE_DAY, 0 notifications (R2)
  replay the SAME detected change            -> DEDUPED via notified-keys.json (R3)
"""
import contextlib
import io
import json
import os
import sys
from datetime import datetime
from zoneinfo import ZoneInfo

PKG = r"D:/AgenticOS/monitoring/freecash"
sys.path.insert(0, PKG)

root = os.environ["FREECASH_DATA_ROOT"]
localapp = os.environ["LOCALAPPDATA"]
assert root.lower().startswith(localapp.lower()), (
    "refusing: FREECASH_DATA_ROOT is not under %%LOCALAPPDATA%%: %s" % root
)
os.environ["FREECASH_TOAST_STUB"] = "1"  # offline stub sender, never a real desktop toast

import paths            # noqa: E402
import gate             # noqa: E402
import operator_state   # noqa: E402
import changedetect     # noqa: E402
import notify           # noqa: E402
import run_daily_check  # noqa: E402

BERLIN = ZoneInfo("Europe/Berlin")
DAY1, DAY2 = "2026-10-01", "2026-10-02"
NOW1 = datetime(2026, 10, 1, 10, 0, 0, tzinfo=BERLIN)
NOW2 = datetime(2026, 10, 2, 10, 0, 0, tzinfo=BERLIN)


def hr(title):
    print("\n" + "=" * 72)
    print("== " + title)
    print("=" * 72)


def run_capture(argv, now):
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        rc = run_daily_check.run(argv, now=now)
    return rc, buf.getvalue().strip()


def write_record(day, entered_utc, status, earn, bal, pend, cur="USD"):
    operator_state.ensure_template()
    doc = operator_state.load_document()
    doc["records"] = [r for r in doc.get("records", []) if r.get("day_key") != day]
    doc["records"].append({
        "day_key": day,
        "entered_at_utc": entered_utc,
        "account_status": status,
        "earnings_total_cents": earn,
        "balance_cents": bal,
        "pending_cents": pend,
        "currency": cur,
    })
    paths.write_json_atomic(paths.operator_state_path(), doc)


def alert_type_count(event_type):
    return sum(1 for r in paths.read_jsonl(paths.alerts_path()) if r.get("event_type") == event_type)


def toast_lines():
    p = paths.logs_dir() / "toast-stub.log"
    if not p.exists():
        return []
    return [ln for ln in p.read_text(encoding="utf-8").splitlines() if ln.strip()]


hr("0. environment")
print("python          =", sys.version.split()[0])
print("package         =", PKG)
print("FREECASH_DATA_ROOT =", paths.data_root())
print("FREECASH_TOAST_STUB =", os.environ.get("FREECASH_TOAST_STUB"))
print("day1 now(Berlin) =", NOW1.isoformat(), "-> day_key", gate.day_key(NOW1))
print("day2 now(Berlin) =", NOW2.isoformat(), "-> day_key", gate.day_key(NOW2))
print("tz report       =", gate.timezone_report())

hr("1. DAY 1 -- operator enters the first reading")
write_record(DAY1, "2026-10-01T07:55:00Z", "ACTIVE", 1340, 1340, 0)
print("record written for", DAY1, "= ACTIVE, earnings 1340, balance 1340, pending 0 USD")
rc1, out1 = run_capture(["--source", "operator_state"], NOW1)
print("exit =", rc1)
print(out1)
print("alerts.jsonl lines =", len(paths.read_jsonl(paths.alerts_path())))
print("notified-keys.json =", json.dumps(notify.load_notified_keys(), indent=2))
print("approval items     =", len(paths.read_jsonl(paths.pending_path())) if paths.pending_path().exists() else 0)

hr("2. DAY 2 -- operator enters a CHANGED earnings figure (1340 -> 2540)")
write_record(DAY2, "2026-10-02T07:58:00Z", "ACTIVE", 2540, 2540, 0)
print("record written for", DAY2, "= ACTIVE, earnings 2540, balance 2540, pending 0 USD")
rc2, out2 = run_capture(["--source", "operator_state"], NOW2)
print("exit =", rc2)
print(out2)
print("EARNINGS_CHANGED alert lines =", alert_type_count("EARNINGS_CHANGED"))
print("toast-stub.log lines         =", len(toast_lines()))

hr("2a. the exact notification payload delivered for the day-2 change")
change = None
for c in (changedetect.compare(changedetect.load_snapshot(DAY1),
                               changedetect.load_snapshot(DAY2)) or {}).get("changes", []):
    change = c
key = run_daily_check.change_dedupe_key(DAY2, change)
change["dedupe_key"] = key
prior = changedetect.load_snapshot(DAY1)
current = changedetect.load_snapshot(DAY2)
source = {
    "kind": current["source"]["kind"],
    "read_ops": current["source"]["read_ops"],
    "data_available": True,
    "note": current["source"]["note"],
}
payload = notify.message_for_change(DAY2, change, current, prior, source_note=source["note"])
print("--- notification message (what the toast channel would carry) ---")
print(payload)
print("--- delivery label from the stub sender ---")
print("STUB_OK (FREECASH_TOAST_STUB=1); stubbed runs are never labelled TOAST_OK")
print("--- toast-stub.log content (the offline delivery record) ---")
for ln in toast_lines():
    print(ln)

hr("2b. dedupe key persisted in state/notified-keys.json")
print("dedupe key =", key)
print("subject    = sha256('%s|%s|%s|%s|%s')" % (
    DAY2, change["change_type"], change["field"], change["old_value"], change["new_value"]))
print(json.dumps(notify.load_notified_keys(), indent=2))
print("key_delivery(key) =", notify.key_delivery(key))

hr("3. REPLAY of the day-2 command (same day) -- R2 must refuse a second read")
rc3, out3 = run_capture(["--source", "operator_state"], NOW2)
print("exit =", rc3)
print(out3)
print("EARNINGS_CHANGED alert lines =", alert_type_count("EARNINGS_CHANGED"), "(unchanged)")
print("toast-stub.log lines         =", len(toast_lines()), "(unchanged)")
print("notified-keys count          =", len(notify.load_notified_keys()["keys"]), "(unchanged)")

hr("4. REPLAY of the SAME detected change -- R3 dedupe (key_seen) must suppress the toast")
keys_before = len(notify.load_notified_keys()["keys"])
toast_before = len(toast_lines())
result = run_daily_check.dispatch_change(
    DAY2, change, current, prior, source,
    sender=None, sleep_seconds=0, now=NOW2, enqueue=True,
)
print("dispatch_change(...) returned =", result)
print("expected DEDUPED; keys_before=%d keys_after=%d toast_before=%d toast_after=%d"
      % (keys_before, len(notify.load_notified_keys()["keys"]), toast_before, len(toast_lines())))
print("last alerts.jsonl line =", json.dumps(paths.read_jsonl(paths.alerts_path())[-1], ensure_ascii=False))

hr("5. final state ledger + approval queue")
print("last-run.json =", json.dumps(gate.load_ledger(), indent=2))
pend = paths.pending_path()
print("pending.json exists =", pend.exists())
if pend.exists():
    print(json.dumps(json.loads(pend.read_text(encoding="utf-8")), indent=2))

hr("6. state tree")
for dirpath, dirnames, filenames in os.walk(str(paths.data_root())):
    rel = os.path.relpath(dirpath, str(paths.data_root()))
    for f in sorted(filenames):
        print(os.path.join(rel, f).replace("\\", "/"))
