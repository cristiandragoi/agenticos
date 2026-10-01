"""changedetect.py -- R3: snapshot schema, exact-integer comparison, dedupe key.

Snapshot is written once per successful day and is never rewritten.  The prior
snapshot is loaded **before** the new one is written, so the comparison can
never be against itself (the defect that made the legacy monitor unable to ever
detect a change).

Compared fields are exhaustive and exact -- four fields, integer cents, no
relative or percentage threshold::

    account_status       str   any inequality -> STATUS_CHANGED
    earnings_total_cents int   any inequality -> EARNINGS_CHANGED
    balance_cents        int   any inequality -> BALANCE_CHANGED
    pending_cents        int   any inequality -> EARNINGS_CHANGED (subtype pending)

A missing field is a *read failure*, not a silent zero: the routine reports it
rather than inventing a value.

Dedupe key (one change -> exactly one notification)::

    sha256( day_key | change_type | field | old_value | new_value )

The day key is part of the key on purpose: the same change re-detected on a
later day is a new key and does notify again, while a re-run inside the same day
(R1 already prevents that) could never notify twice.
"""

import hashlib
import json
from datetime import datetime, timedelta, timezone

import paths

COMPARED_FIELDS = (
    ("account_status", "STATUS_CHANGED", None),
    ("earnings_total_cents", "EARNINGS_CHANGED", None),
    ("balance_cents", "BALANCE_CHANGED", None),
    ("pending_cents", "EARNINGS_CHANGED", "pending"),
)

STATUS_BASELINE = "INITIAL_BASELINE"
STATUS_NO_CHANGE = "OK_NO_CHANGE"
DEGRADED = "MONITOR_DEGRADED"

_RETENTION_SNAPSHOT_DAYS = 90
_RETENTION_LOG_DAYS = 30

_MONEY_ALIASES = {
    "earnings_total_cents": (
        "earnings_total_cents",
        "earnings_cents",
        "total_earnings_cents",
    ),
    "balance_cents": ("balance_cents", "available_cents", "net_balance_cents"),
    "pending_cents": ("pending_cents", "pending_total_cents"),
}
#: Whole-currency fallbacks (USD dollars -> integer cents, rounded).
_DOLLAR_ALIASES = {
    "earnings_total_cents": ("earnings_total", "earnings"),
    "balance_cents": ("balance", "available"),
    "pending_cents": ("pending",),
}
_STATUS_ALIASES = ("account_status", "status")
_CURRENCY_ALIASES = ("currency", "currency_code")
_CONTAINERS = ("metrics", "data", "snapshot", "account")


class MetricError(ValueError):
    """Raised when a read result cannot be turned into the four compared fields."""


# --------------------------------------------------------------------------- parse


def _candidates(payload):
    """Yield the dicts a field may live in (top level first, then containers)."""
    seen = []
    if isinstance(payload, dict):
        seen.append(payload)
        for key in _CONTAINERS:
            inner = payload.get(key)
            if isinstance(inner, dict) and inner not in seen:
                seen.append(inner)
    return seen


def _lookup(payload, names):
    for scope in _candidates(payload):
        for name in names:
            if name in scope and scope[name] is not None:
                return scope[name]
    return None


def _as_cents(value, field):
    if isinstance(value, bool):
        raise MetricError("field %s must be an integer number of cents" % field)
    if isinstance(value, int):
        return int(value)
    if isinstance(value, float):
        return int(round(value * 100))
    if isinstance(value, str):
        text = value.strip().replace(",", "")
        try:
            return int(round(float(text) * 100))
        except ValueError:
            raise MetricError("field %s is not numeric: %r" % (field, value))
    raise MetricError("field %s has unsupported type %s" % (field, type(value).__name__))


def normalize_metrics(payload) -> dict:
    """Extract the four compared fields (+ currency) or raise MetricError."""
    if not isinstance(payload, dict):
        raise MetricError("metrics payload is not a JSON object")
    out = {}
    for field, _change, _sub in COMPARED_FIELDS:
        if field == "account_status":
            raw = _lookup(payload, _STATUS_ALIASES)
            if raw is None:
                raise MetricError("metrics payload is missing 'account_status'")
            if not isinstance(raw, str):
                raw = str(raw)
            out[field] = raw.strip().upper()
            continue
        raw = _lookup(payload, _MONEY_ALIASES[field])
        source = "cents"
        if raw is None:
            raw = _lookup(payload, _DOLLAR_ALIASES[field])
            source = "whole-currency"
        if raw is None:
            raise MetricError("metrics payload is missing '%s'" % field)
        value = _as_cents(raw, field)
        if source == "whole-currency":
            value = int(round(value)) if isinstance(value, int) else value
        out[field] = int(value)
    currency = _lookup(payload, _CURRENCY_ALIASES)
    out["currency"] = (str(currency).strip().upper() if currency else "UNKNOWN")
    return out


# --------------------------------------------------------------------------- build


def sha256_hex(blob) -> str:
    if isinstance(blob, str):
        blob = blob.encode("utf-8")
    return hashlib.sha256(blob or b"").hexdigest()


def build_snapshot(day, metrics, source, raw_body=b"", now=None) -> dict:
    """Build the immutable snapshot for *day* (schema in ROUTINE-DESIGN 4.1)."""
    metrics = dict(metrics or {})
    source = dict(source or {})
    available = bool(source.get("data_available", True))
    snapshot = {
        "schema_version": paths.SCHEMA_VERSION,
        "day_key": day,
        "captured_at_utc": paths.iso_utc(now),
        "source": {
            "kind": source.get("kind") or "unknown",
            "read_ops": list(source.get("read_ops") or []),
            "data_available": available,
            "note": source.get("note"),
        },
        # Every source available today is a substitute for the provider read:
        # the marker lets a "no change" report ever be mistaken for
        # "provider verified no change" (ROUTINE-DESIGN 4.1 / 9.1 item 4).
        "degraded": True,
        "account_status": metrics.get("account_status") if available else None,
        "earnings_total_cents": metrics.get("earnings_total_cents") if available else None,
        "balance_cents": metrics.get("balance_cents") if available else None,
        "pending_cents": metrics.get("pending_cents") if available else None,
        "currency": metrics.get("currency") if available else None,
        "raw_response_sha256": sha256_hex(raw_body),
    }
    return snapshot


def snapshot_path(day):
    return paths.snapshots_dir() / ("%s.json" % day)


def save_snapshot(snapshot: dict, now=None):
    """Write the snapshot unless it already exists.  Returns (path, written)."""
    path = snapshot_path(snapshot["day_key"])
    if path.exists():
        return path, False
    paths.write_json_atomic(path, snapshot)
    return path, True


def load_snapshot(day):
    raw = paths.read_json(snapshot_path(day), default=None)
    return raw if isinstance(raw, dict) else None


def load_prior_snapshot(day):
    """Most recent snapshot strictly before *day*, or None."""
    if not paths.snapshots_dir().exists():
        return None
    best = None
    for entry in paths.snapshots_dir().glob("*.json"):
        key = entry.stem
        if key >= day:
            continue
        if best is None or key > best:
            best = key
    return load_snapshot(best) if best else None


# --------------------------------------------------------------------------- compare


def dedupe_key(day, change_type, field, old_value, new_value) -> str:
    subject = "%s|%s|%s|%s|%s" % (day, change_type, field, old_value, new_value)
    return hashlib.sha256(subject.encode("utf-8")).hexdigest()


def _has_data(snapshot) -> bool:
    if not isinstance(snapshot, dict):
        return False
    source = snapshot.get("source") or {}
    return bool(source.get("data_available", True))


def compare(prior, current) -> dict:
    """Compare *current* against *prior*.

    Returns ``{"baseline": bool, "changes": [...], "degraded": [...]}``.
    ``baseline`` is True when there is nothing trustworthy to compare against
    (no prior snapshot, or either side has no data) -- a first run must never
    produce a fake alarm.
    """
    result = {"baseline": False, "changes": [], "degraded": []}
    if not _has_data(prior) or not _has_data(current):
        result["baseline"] = True
        if prior is not None and not _has_data(current):
            result["degraded"].append(
                "no data for %s; comparison skipped" % current.get("day_key")
            )
        return result
    if prior.get("currency") != current.get("currency"):
        result["degraded"].append(
            "currency changed %s -> %s; money comparison skipped"
            % (prior.get("currency"), current.get("currency"))
        )
        money_fields = {field for field, _c, _s in COMPARED_FIELDS if field != "account_status"}
    else:
        money_fields = set()
    # ROUTINE-DESIGN 5.3 template (a) carries the balance movement *inside* the
    # earnings notification ("Balance: $13.40 (changed too)"), and acceptance
    # test T3.1 (ROUTINE-DESIGN 7) requires exactly one EARNINGS_CHANGED line and
    # exactly one notification for a fixture in which both moved.  An earnings
    # change that drags the balance with it is therefore ONE distinct change, not
    # two; a balance movement on its own is still its own BALANCE_CHANGED event.
    earnings_moved = prior.get("earnings_total_cents") != current.get("earnings_total_cents")
    for field, change_type, subtype in COMPARED_FIELDS:
        if field in money_fields:
            continue
        if field == "balance_cents" and earnings_moved:
            continue
        old = prior.get(field)
        new = current.get(field)
        if old == new:
            continue
        change = {
            "change_type": change_type,
            "field": field,
            "old_value": old,
            "new_value": new,
            "prior_day_key": prior.get("day_key"),
        }
        if subtype:
            change["subtype"] = subtype
        result["changes"].append(change)
    return result


# --------------------------------------------------------------------------- money


def format_cents(value) -> str:
    if not isinstance(value, int):
        return "unknown"
    sign = "-" if value < 0 else ""
    return "%s$%d.%02d" % (sign, abs(value) // 100, abs(value) % 100)


def delta_cents(old, new):
    if isinstance(old, int) and isinstance(new, int):
        return new - old
    return None


# --------------------------------------------------------------------------- housekeeping


def prune_old_artifacts(now=None, snapshot_days=_RETENTION_SNAPSHOT_DAYS, log_days=_RETENTION_LOG_DAYS):
    """Retention pass (ROUTINE-DESIGN 9.1): snapshots 90d, run logs 30d.

    The alert log and the decision trail are audit records and are never pruned.
    """
    moment = now or datetime.now(timezone.utc)
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    removed = []
    for path, keep_days, pattern in (
        (paths.snapshots_dir(), snapshot_days, "*.json"),
        (paths.logs_dir(), log_days, "run-*.log"),
    ):
        if not path.exists():
            continue
        cutoff = moment - timedelta(days=keep_days)
        for entry in path.glob(pattern):
            try:
                stamp = datetime.fromtimestamp(entry.stat().st_mtime, timezone.utc)
            except OSError:
                continue
            if stamp < cutoff:
                try:
                    entry.unlink()
                    removed.append(str(entry))
                except OSError:
                    continue
    return removed


def load_json_file(path, default=None):
    return paths.read_json(path, default=default)


def parse_json_text(text):
    return json.loads(text)
