"""gate.py -- R1: exactly one status read per operator-local calendar day.

Two layers, and only the first one is the gate:

1. **Atomic day lock.**  ``os.open(lock, O_CREAT | O_EXCL | O_WRONLY)`` on
   ``state/day-locks/<YYYY-MM-DD>.lock``.  That is a single atomic syscall on
   NTFS: two simultaneous processes cannot both create the same path, so there
   is no read-then-write window and no "if it exists" check to race on.  The
   filename *is* the day key; the file is zero bytes, so a partial write can
   never be misread.
2. **Ledger + reconciliation.**  ``state/last-run.json`` records the attempt and
   the success for audit and missed-day arithmetic.  It is **never** the gate,
   so a corrupt or missing ledger cannot cause a second read in one day.

Day key = operator-local calendar day via ``zoneinfo`` (default
``Europe/Berlin``, override with ``FREECASH_TZ``).  The routine fails closed:
anything that goes wrong with the lock means "do not read".
"""

import os
from datetime import date, datetime, timedelta, timezone, tzinfo as tzinfo_type
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import paths

DEFAULT_TZ = "Europe/Berlin"

#: Zone names that need no IANA database: they are exact by definition.
_TZ_ALIASES = {"UTC": timezone.utc, "GMT": timezone.utc, "Z": timezone.utc}

#: Outcomes that mean "today's check happened and produced a snapshot".
SUCCESS_OUTCOMES = frozenset(
    {
        "OK_NO_CHANGE",
        "INITIAL_BASELINE",
        "EARNINGS_CHANGED",
        "STATUS_CHANGED",
        "BALANCE_CHANGED",
        "MONITOR_DEGRADED",
    }
)


# --------------------------------------------------------------------------- time


def tz_name() -> str:
    return os.environ.get("FREECASH_TZ") or DEFAULT_TZ


def system_local_zone():
    """The machine's own time zone, as the operating system sees it right now."""
    return datetime.now().astimezone().tzinfo or timezone.utc


def resolve_tz(spec=None):
    """Resolve a zone name / tzinfo into ``(tzinfo, kind)``.

    ``kind`` is ``"explicit"`` (a tzinfo was passed), ``"utc"`` (a UTC alias),
    ``"zoneinfo"`` (a real IANA zone resolved locally) or ``"system-local"``.

    ``"system-local"`` means the configured name is **not** resolvable on this
    host -- Python's zoneinfo ships without an IANA database, so ``tzdata`` is
    normally required on Windows and is not installed here.  The routine then
    uses the machine's own local zone, which *is* the operator's wall clock, and
    reports the condition as ``MONITOR_DEGRADED`` rather than pretending the
    configured name was honoured.
    """
    if isinstance(spec, tzinfo_type):
        return spec, "explicit"
    name = spec or tz_name()
    if name in _TZ_ALIASES:
        return _TZ_ALIASES[name], "utc"
    try:
        return ZoneInfo(name), "zoneinfo"
    except (ZoneInfoNotFoundError, ValueError, OSError, KeyError):
        return system_local_zone(), "system-local"


def zone(spec=None):
    """The tzinfo the routine should use.  Never fails, never returns None."""
    return resolve_tz(spec)[0]


def timezone_report(spec=None) -> dict:
    resolved, kind = resolve_tz(spec)
    configured = spec if isinstance(spec, str) else (spec or tz_name())
    return {
        "configured": str(configured),
        "kind": kind,
        "available": kind in ("explicit", "utc", "zoneinfo"),
        "offset_now": datetime.now(resolved).strftime("%z"),
    }


def day_key(now=None, tz=None) -> str:
    """Operator-local calendar day for *now* (default: the current instant)."""
    if now is None:
        now = datetime.now(timezone.utc)
    elif now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    return now.astimezone(zone(tz)).date().isoformat()


def _as_date(value):
    try:
        return date.fromisoformat(value)
    except (TypeError, ValueError):
        return None


# --------------------------------------------------------------------------- lock


def lock_path(day: str):
    return paths.day_locks_dir() / ("%s.lock" % day)


def acquire_day_lock(day: str):
    """Try to consume *day*.  Returns ``(acquired, lock_path)``.

    ``acquired is False`` means another invocation already consumed this day --
    the caller must then perform no further work at all.
    """
    lock = lock_path(day)
    lock.parent.mkdir(parents=True, exist_ok=True)
    try:
        fd = os.open(str(lock), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    except FileExistsError:
        # MUTATION r1-b: an existing lock no longer binds.
        return True, lock
    try:
        os.close(fd)
    except OSError:
        pass
    return True, lock


# --------------------------------------------------------------------------- ledger


def new_ledger(tz=None) -> dict:
    return {
        "schema_version": paths.SCHEMA_VERSION,
        "last_attempt_day": None,
        "last_success_day": None,
        "last_attempt_at_utc": None,
        "last_success_at_utc": None,
        "last_outcome": None,
        "consecutive_missed_days": 0,
        "timezone": tz or tz_name(),
        "updated_at_utc": None,
    }


def load_ledger() -> dict:
    """Load the ledger, filling in any missing keys.  Never raises."""
    raw = paths.read_json(paths.ledger_path(), default=None)
    ledger = new_ledger()
    if isinstance(raw, dict):
        for key in ledger:
            if key in raw:
                ledger[key] = raw[key]
    return ledger


def save_ledger(ledger: dict, now=None) -> None:
    ledger = dict(ledger)
    ledger.setdefault("schema_version", paths.SCHEMA_VERSION)
    ledger["updated_at_utc"] = paths.iso_utc(now)
    ledger["timezone"] = ledger.get("timezone") or tz_name()
    paths.write_json_atomic(paths.ledger_path(), ledger)


def timezone_changed(ledger: dict) -> bool:
    previous = (ledger or {}).get("timezone")
    return bool(previous) and previous != tz_name()


def record_attempt(day: str, now=None, ledger=None) -> dict:
    """Record that *day* has been consumed.  Written immediately after the lock."""
    ledger = dict(ledger) if ledger is not None else load_ledger()
    ledger["last_attempt_day"] = day
    ledger["last_attempt_at_utc"] = paths.iso_utc(now)
    save_ledger(ledger, now)
    return ledger


def record_outcome(day: str, outcome: str, now=None, ledger=None, missed=0) -> dict:
    """Record the outcome of the day's check.

    ``last_success_*`` is only advanced for outcomes in SUCCESS_OUTCOMES; a
    failed read leaves the previous success day in place so the watchdog and the
    next run both see the day as *uncovered*.
    """
    ledger = dict(ledger) if ledger is not None else load_ledger()
    ledger["last_outcome"] = outcome
    ledger["consecutive_missed_days"] = int(missed)
    if outcome in SUCCESS_OUTCOMES:
        ledger["last_success_day"] = day
        ledger["last_success_at_utc"] = paths.iso_utc(now)
    save_ledger(ledger, now)
    return ledger


# --------------------------------------------------------------------------- maths


def missed_days(day: str, ledger: dict) -> list:
    """Every local calendar day strictly between the last success and *day*.

    Deliberately does **not** include *day* itself (today is what we are about
    to check) and does not include the last success day (it succeeded).  The
    routine never back-fills a missed day: a second read of a past day would be
    a second check for that day and would defeat R1.
    """
    today = _as_date(day)
    last = _as_date((ledger or {}).get("last_success_day"))
    if today is None or last is None:
        return []
    cursor = last + timedelta(days=1)
    out = []
    while cursor < today:
        out.append(cursor.isoformat())
        cursor += timedelta(days=1)
    return out


def consecutive_missed_days(day: str, ledger: dict) -> int:
    return len(missed_days(day, ledger))


def clock_moved_backwards(day: str, ledger: dict) -> bool:
    today = _as_date(day)
    last = _as_date((ledger or {}).get("last_success_day"))
    return bool(today and last and last > today)
