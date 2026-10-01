"""Stream L (RS-4) harness -- dedupe red case + bounded sink-failure red case.

Runs against a COPY of monitoring/freecash under this delivery directory and a
throwaway FREECASH_DATA_ROOT.  Sends nothing to any real recipient:
  * the "successful dispatch" case uses the shipped offline stub sender
    (delivery label STUB_OK, writes logs/toast-stub.log only);
  * the unreachable-sink cases use failing transports and are asserted to be
    bounded (no exception escapes) and non-dropping (event recorded).

Usage (from repo root):
  FREECASH_DATA_ROOT=... python sink_harness.py <pkg_dir> <scratch_root>
"""

import json
import os
import sys
import traceback

PKG = sys.argv[1] if len(sys.argv) > 1 else os.environ["FC_PKG"]
ROOT = sys.argv[2] if len(sys.argv) > 2 else os.environ["FREECASH_DATA_ROOT"]
sys.path.insert(0, PKG)
os.environ["FREECASH_DATA_ROOT"] = ROOT

import changedetect  # noqa: E402
import notify  # noqa: E402
import paths  # noqa: E402

DAY = "2026-10-01"
PRIOR_DAY = "2026-09-30"


def hr(title):
    print("\n" + "=" * 72)
    print(title)
    print("=" * 72)


class RecordingSender:
    """Stands in for a reachable sink; counts deliveries."""

    delivery_label = notify.DELIVERY_STUB_OK

    def __init__(self):
        self.messages = []

    def __call__(self, message):
        self.messages.append(message)


class RaisingSender:
    """Stands in for an UNREACHABLE sink (locked session / no desktop shell)."""

    delivery_label = notify.DELIVERY_TOAST_OK

    def __init__(self, text):
        self.calls = 0
        self.text = text

    def __call__(self, message):
        self.calls += 1
        raise RuntimeError(self.text)


def alerts():
    return paths.read_jsonl(paths.alerts_path())


def lines_for(key, event_type=None):
    out = []
    for rec in alerts():
        if rec.get("dedupe_key") == key and (event_type is None or rec.get("event_type") == event_type):
            out.append(rec)
    return out


print("pkg           =", PKG)
print("data_root     =", paths.data_root())
print("FREECASH_TOAST_STUB =", repr(os.environ.get("FREECASH_TOAST_STUB")))
paths.ensure_layout()

change = {
    "change_type": "EARNINGS_CHANGED",
    "field": "earnings_total_cents",
    "old_value": 1234,
    "new_value": 5678,
    "prior_day_key": PRIOR_DAY,
}

# --------------------------------------------------------------------- PART 1
hr("PART 1 -- DEDUPE: one change -> exactly one delivery (R3)")
key = changedetect.dedupe_key(DAY, change["change_type"], change["field"], change["old_value"], change["new_value"])
print("dedupe_key =", key)
print("subject    =", "%s|%s|%s|%s|%s" % (DAY, change["change_type"], change["field"], change["old_value"], change["new_value"]))
spy = RecordingSender()
notify.set_sender(spy)
r1 = notify.notify_change(DAY, change, "msg-A same change", key, sender=spy, sleep_seconds=0)
print("dispatch #1 ->", r1, "| sender.messages =", len(spy.messages))
r2 = notify.notify_change(DAY, change, "msg-A same change", key, sender=spy, sleep_seconds=0)
print("dispatch #2 (SAME key) ->", r2, "| sender.messages =", len(spy.messages))
print("key_delivery(%s...) = %s" % (key[:12], notify.key_delivery(key)))
print("alert lines for key, event EARNINGS_CHANGED =", len(lines_for(key, "EARNINGS_CHANGED")))
print("PASS dedupe:", (r1 == "NOTIFIED" and r2 == "DEDUPED" and len(spy.messages) == 1))

# --------------------------------------------------------------------- PART 2
hr("PART 2 -- OK_NO_CHANGE is log-only (never dispatches)")
spy2 = RecordingSender()
before = len(spy2.messages)
rec = notify.emit_no_change(DAY, prior_day=PRIOR_DAY, sender=spy2)
print("emit_no_change ->", rec["event_type"], "| dispatched:", len(spy2.messages) - before)
print("PASS log-only:", len(spy2.messages) == 0)

# --------------------------------------------------------------------- PART 3
hr("PART 3 -- UNREACHABLE SINK: bounded failure, event recorded, no drop")

# 3a: shipped offline stub (reachable, STUB_OK) -- proves the dispatch pipeline
#     end to end without notifying a real recipient.
key_stub = changedetect.dedupe_key(DAY, "BALANCE_CHANGED", "balance_cents", 100, 200)
notify.set_sender(None)  # clear override
os.environ["FREECASH_TOAST_STUB"] = "1"
print("get_sender() with FREECASH_TOAST_STUB=1 ->", notify.get_sender().__name__)
r_stub = notify.dispatch("msg-stub balance 100 -> 200", key_stub, DAY, "BALANCE_CHANGED", sleep_seconds=0)
print("stub dispatch ->", r_stub, "| key_delivery =", notify.key_delivery(key_stub))

# 3b: REAL default sender (_toast_send) with the transport unlaunchable.
os.environ.pop("FREECASH_TOAST_STUB", None)
notify.set_sender(None)
print("get_sender() with stub unset ->", notify.get_sender().__name__)
saved_path = os.environ.get("PATH", "")
key_real = changedetect.dedupe_key(DAY, "STATUS_CHANGED", "account_status", "ACTIVE", "PAUSED")
escaped = False
try:
    os.environ["PATH"] = r"C:\__no_such_dir__"
    r_real = notify.dispatch("msg-real toast unreachable", key_real, DAY, "STATUS_CHANGED", sleep_seconds=0)
except BaseException as exc:  # noqa: BLE001
    escaped = True
    r_real = "EXCEPTION_ESCAPED: %r" % (exc,)
    traceback.print_exc()
finally:
    os.environ["PATH"] = saved_path
print("real-sender dispatch ->", r_real, "| EXCEPTION_ESCAPED =", escaped)
print("key_delivery(real) =", notify.key_delivery(key_real))
for rec in lines_for(key_real):
    print("  alert:", rec["event_type"], "| delivery=", rec.get("observed", {}).get("delivery"),
          "| attempts=", rec.get("observed", {}).get("attempts"),
          "| error=", rec.get("observed", {}).get("error"))
print("PASS bounded+recorded:", (not escaped and r_real == "FAILED_TOAST"))

# 3c: ONE dispatch to an unreachable sink -> bounded, event recorded, no drop.
sink = RaisingSender("no interactive desktop session / desktop shell absent (reproduced)")
key_fail = changedetect.dedupe_key(DAY, "EARNINGS_CHANGED", "earnings_total_cents", 5678, 9999)
escaped2 = False
try:
    rf1 = notify.dispatch("msg-fail full original message", key_fail, DAY, "EARNINGS_CHANGED", sender=sink, sleep_seconds=0)
except BaseException as exc:  # noqa: BLE001
    escaped2 = True
    rf1 = "EXCEPTION_ESCAPED: %r" % (exc,)
    traceback.print_exc()
print("dispatch #1 ->", rf1, "| sender.calls =", sink.calls, "(MAX_ATTEMPTS per call)")
print("EXCEPTION_ESCAPED =", escaped2)
print("key_delivery(fail) =", notify.key_delivery(key_fail))
dfl = lines_for(key_fail, "DELIVERY_FAILED")
mdf = lines_for(key_fail, "MONITOR_DEGRADED")
print("DELIVERY_FAILED lines =", len(dfl), "| MONITOR_DEGRADED lines =", len(mdf))
for rec in dfl:
    print("  DELIVERY_FAILED.message =", json.dumps(rec["message"]))
    print("  observed =", json.dumps(rec.get("observed")))
print("PASS bounded+recorded+no-drop:",
      (not escaped2 and rf1 == "FAILED_TOAST" and len(dfl) == 1 and dfl[0]["message"] == "msg-fail full original message"))

# 3c-2 FINDING (boundary): notify.dispatch() itself is NOT idempotent -- a direct
#      second call with the SAME key re-attempts the dead sink.  The exactly-once
#      guard lives in the CALLERS (notify_change / dispatch_change / the
#      coalesce branch), every one of which checks key_seen() first.
before_calls, before_dfl = sink.calls, len(lines_for(key_fail, "DELIVERY_FAILED"))
rf_direct2 = notify.dispatch("msg-fail full original message", key_fail, DAY, "EARNINGS_CHANGED", sender=sink, sleep_seconds=0)
print("FINDING dispatch() a 2nd time, SAME key, called directly ->", rf_direct2,
      "| extra sink calls =", sink.calls - before_calls,
      "| extra DELIVERY_FAILED lines =", len(lines_for(key_fail, "DELIVERY_FAILED")) - before_dfl)
print("FINDING: exactly-once is enforced by notify_change()/dispatch_change(), not by dispatch().")

# 3d: the same change routed through notify_change after a failure -> DEDUPED, no retry.
key_fail2 = changedetect.dedupe_key(DAY, "STATUS_CHANGED", "account_status", "PAUSED", "ACTIVE")
ch2 = {"change_type": "STATUS_CHANGED", "field": "account_status", "old_value": "PAUSED", "new_value": "ACTIVE", "prior_day_key": PRIOR_DAY}
dead_sink = RaisingSender("no interactive desktop session (reproduced)")
n1 = notify.notify_change(DAY, ch2, "msg-nc", key_fail2, sender=dead_sink, sleep_seconds=0)
calls_after_first = dead_sink.calls
n2 = notify.notify_change(DAY, ch2, "msg-nc", key_fail2, sender=dead_sink, sleep_seconds=0)
print("notify_change #1 ->", n1, "| calls =", calls_after_first)
print("notify_change #2 (SAME key) ->", n2, "| calls =", dead_sink.calls, "(no second attempt)")
print("PASS no-retry-after-failure:", n1 == "FAILED" and n2 == "DEDUPED" and dead_sink.calls == calls_after_first)

hr("ALERT LOG TAIL (all evidence lines, verbatim)")
for rec in alerts():
    print(json.dumps(rec, sort_keys=True))
