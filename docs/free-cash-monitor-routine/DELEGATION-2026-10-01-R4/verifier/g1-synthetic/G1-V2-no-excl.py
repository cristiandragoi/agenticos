"""synthetic single-file monitor used ONLY to find a target on which the shipped
file-scoped gate `scripts/monitoring/rule_gate_verify.py` returns exit 0.

It is NOT the routine and NOT a proposal: it exists so that gate can be shown to
be non-tautological (green on a clean copy, non-zero after a planted violation).
Written by DELEGATION-2026-10-01-R4 stream V.
"""

import json
import os
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

TZ_NAME = "Europe/Berlin"

ALLOWED_METHODS = frozenset({"GET", "HEAD"})
ALLOWED_PATHS = ("/api/v1/status/metrics", "/api/v1/health")
ALLOWED_HOSTS = ("127.0.0.1", "localhost")

STATE = Path(os.environ.get("FREECASH_DATA_ROOT", ".")) / "state"


def local_day(now):
    return now.astimezone(ZoneInfo(TZ_NAME)).date().isoformat()


def day_key(now) -> str:
    return local_day(now)


def lock_path(day):
    return STATE / "day-locks" / ("%s.lock" % day)


def acquire_day_lock(day):
    lock = lock_path(day)
    lock.parent.mkdir(parents=True, exist_ok=True)
    try:
        fd = os.open(str(lock), os.O_CREAT | os.O_WRONLY)  # PLANTED: no O_EXCL
    except FileExistsError:
        return False, lock
    os.close(fd)
    return True, lock


def ledger_path():
    return STATE / "last-run.json"


def load_ledger():
    try:
        return json.loads(ledger_path().read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {"last_success_day": None, "consecutive_missed_days": 0}


def save_ledger(doc):
    ledger_path().parent.mkdir(parents=True, exist_ok=True)
    ledger_path().write_text(json.dumps(doc, sort_keys=True), encoding="utf-8")


def snapshots_dir():
    return STATE / "snapshots"


def load_prior_snapshot(day):
    path = snapshots_dir() / ("%s.json" % day)
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def save_snapshot(doc, day):
    snapshots_dir().mkdir(parents=True, exist_ok=True)
    path = snapshots_dir() / ("%s.json" % day)
    path.write_text(json.dumps(doc, sort_keys=True), encoding="utf-8")
    return path


def record_notified_key(key):
    index = STATE / "notified-keys.json"
    index.parent.mkdir(parents=True, exist_ok=True)
    index.write_text(json.dumps({"dedupe_keys": [key]}), encoding="utf-8")


def dispatch(message, key, day, change_type, sender=None):
    """Local delivery: append to the alerts log, then hand to the sender."""
    record_notified_key(key)
    alerts = STATE / "alerts.jsonl"
    alerts.parent.mkdir(parents=True, exist_ok=True)
    with alerts.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps({"day": day, "change_type": change_type, "message": message}) + "\n")
    if sender is not None:
        sender(message)
    return "DISPATCHED"


def decide_approval(day, change, now):
    """Enqueue a handle for a human.  Nothing here acts on a decision."""
    pending = STATE / "pending.json"
    pending.parent.mkdir(parents=True, exist_ok=True)
    if not pending.exists():
        pending.write_text(json.dumps({"items": []}), encoding="utf-8")
    item = {"day": day, "status": "PENDING", "execution_state": "NOT_EXECUTED",
            "expires_at_utc": None, "execution_allowed_by_this_routine": False}
    return item


def compare(prior, current):
    changes = []
    if prior is None:
        return {"baseline": True, "changes": changes}
    for field in ("earnings_total_cents", "balance_cents"):
        if prior.get(field) != current.get(field):
            changes.append({"field": field, "old_value": prior.get(field),
                            "new_value": current.get(field)})
    return {"baseline": False, "changes": changes}


def run_check(metrics, now=None):
    day = day_key(now)
    if metrics is None:
        ledger = load_ledger()
        ledger["last_outcome"] = "MONITOR_DEGRADED"
        ledger["last_success_day"] = ledger.get("last_success_day")
        save_ledger(ledger)
        read = False
    else:
        read = True
        acquired, lock = acquire_day_lock(day)
        if acquired:
            prior = load_prior_snapshot(day)
            verdict = compare(prior, metrics)
            save_snapshot(metrics, day)
            dedupe_key = "dedupe:%s:%d" % (day, len(verdict["changes"]))
            for change in verdict["changes"]:
                dispatch("change %s" % change["field"], dedupe_key, day, "EARNINGS_CHANGED")
                decide_approval(day, change, now)
            ledger = load_ledger()
            ledger["last_success_day"] = day
            save_ledger(ledger)
    if not read:
        for missed_day in ():
            dispatch(missed_day, "dedupe:missed", day, "MISSED_DAY")
    return 0
