"""paths.py -- state layout, atomic file helpers and clock helpers.

Free Cash daily status-monitoring routine (rules R1-R4).
Python 3.14 standard library only.  No third-party imports.

This module performs NO network access and contains no earning action.
It only knows where the routine keeps its state and how to read/write files
without ever leaving a half-written JSON file behind.

State layout (ROUTINE-DESIGN.md section 1.2)::

    <data root>/
    |-- state/
    |   |-- last-run.json            single source of truth for R1 + missed-day math
    |   |-- day-locks/<YYYY-MM-DD>.lock      exclusive-create; presence == day consumed
    |   |-- notified-keys.json       dedupe_key index for R3
    |   `-- operator-state.json      operator-entered daily figures (see README.md)
    |-- snapshots/<YYYY-MM-DD>.json  one immutable snapshot per successful day
    |-- approvals/pending.json       approval queue (R4)
    |-- approvals/decided.jsonl      append-only human decision trail (R4)
    |-- alerts/alerts.jsonl          APPEND-ONLY alert log (canonical evidence record)
    `-- logs/                        run logs / forced-recheck audit
"""

import json
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path

SCHEMA_VERSION = 1

#: Default state root.  Override with the FREECASH_DATA_ROOT environment variable
#: (tests point this at a throwaway directory so the real state is never touched).
DEFAULT_DATA_ROOT = "D:/AgenticOS/data/freecash-monitor"

_SUBDIRS = ("state", "state/day-locks", "snapshots", "approvals", "alerts", "logs")

ISO_FORMAT = "%Y-%m-%dT%H:%M:%SZ"


# --------------------------------------------------------------------------- layout


def data_root() -> Path:
    """Return the routine's data root (never creates it)."""
    raw = os.environ.get("FREECASH_DATA_ROOT") or DEFAULT_DATA_ROOT
    return Path(raw)


def state_dir() -> Path:
    return data_root() / "state"


def day_locks_dir() -> Path:
    return state_dir() / "day-locks"


def snapshots_dir() -> Path:
    return data_root() / "snapshots"


def approvals_dir() -> Path:
    return data_root() / "approvals"


def alerts_dir() -> Path:
    return data_root() / "alerts"


def logs_dir() -> Path:
    return data_root() / "logs"


def alerts_path() -> Path:
    return alerts_dir() / "alerts.jsonl"


def ledger_path() -> Path:
    return state_dir() / "last-run.json"


def notified_keys_path() -> Path:
    return state_dir() / "notified-keys.json"


def operator_state_path() -> Path:
    return state_dir() / "operator-state.json"


def pending_path() -> Path:
    return approvals_dir() / "pending.json"


def decided_path() -> Path:
    return approvals_dir() / "decided.jsonl"


def ensure_layout() -> list:
    """Create every state directory (idempotent).  Returns the paths created."""
    created = []
    for rel in _SUBDIRS:
        p = data_root() / rel
        if not p.exists():
            p.mkdir(parents=True, exist_ok=True)
            created.append(str(p))
    return created


# --------------------------------------------------------------------------- clock

#: Test/simulation seam: when set, every "now" in the routine resolves to it.
#: The routine itself only sets this while a run is in progress with an injected
#: clock (see run_daily_check.run and watchdog.check); production runs never set it.
_clock_override = None


def set_clock(moment) -> None:
    global _clock_override
    _clock_override = moment


def clear_clock() -> None:
    global _clock_override
    _clock_override = None


def now_utc() -> datetime:
    if _clock_override is not None:
        return _clock_override
    return datetime.now(timezone.utc)


def iso_utc(moment=None) -> str:
    moment = moment or now_utc()
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return moment.astimezone(timezone.utc).strftime(ISO_FORMAT)


def parse_iso(value):
    """Parse an ISO-8601 'Z' timestamp; return None when unparsable."""
    if not isinstance(value, str) or not value:
        return None
    try:
        return datetime.strptime(value, ISO_FORMAT).replace(tzinfo=timezone.utc)
    except ValueError:
        return None


# --------------------------------------------------------------------------- files


def read_json(path, default=None):
    """Read JSON, returning *default* when the file is absent or corrupt.

    A corrupt state file must never raise at import/startup time -- the routine
    has to be able to run and report the problem.
    """
    p = Path(path)
    try:
        with open(p, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return default


def write_json_atomic(path, obj) -> Path:
    """Write JSON via a unique temp file + os.replace (never a partial file)."""
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.parent / (".%s.%d.%s.tmp" % (p.name, os.getpid(), uuid.uuid4().hex))
    payload = json.dumps(obj, indent=2, sort_keys=False, ensure_ascii=False)
    with open(tmp, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(payload)
        fh.write("\n")
        fh.flush()
        os.fsync(fh.fileno())
    os.replace(tmp, p)
    return p


def append_jsonl(path, obj) -> Path:
    """Append one JSON object as a single line, using one O_APPEND write.

    Append mode means the file is never rewritten, so an existing line can
    never be lost -- the alert log is the routine's evidence record.
    """
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    line = json.dumps(obj, sort_keys=True, ensure_ascii=False) + "\n"
    blob = line.encode("utf-8")
    fd = os.open(str(p), os.O_APPEND | os.O_CREAT | os.O_WRONLY, 0o644)
    try:
        written = os.write(fd, blob)
        if written != len(blob):
            raise OSError("short append to %s (%d of %d bytes)" % (p, written, len(blob)))
    finally:
        os.close(fd)
    return p


def read_jsonl(path) -> list:
    """Read a JSONL file, skipping unparsable lines."""
    out = []
    p = Path(path)
    if not p.exists():
        return out
    with open(p, "r", encoding="utf-8") as fh:
        for raw in fh:
            raw = raw.strip()
            if not raw:
                continue
            try:
                out.append(json.loads(raw))
            except ValueError:
                continue
    return out
