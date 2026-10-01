"""operator_state.py -- read source B: the operator-entered daily figures file.

Why this source exists (grounded, not invented): research
(``docs/free-cash-monitor-routine/PROVIDER-API-RESEARCH.md`` section 7) found that
no live read-only provider status/earnings source exists for the monitored
account, and that automated access to the consumer platform is prohibited by its
own terms.  The two acquisition paths that are both available today and
compliant are (a) the operator's own dashboard reading, typed once a day into a
local file, and (b) the local metrics substitute (W1/W2 in
:mod:`readonly_client`).

This module reads (a).  It opens no socket, requests nothing, and holds no
credential.  Every snapshot built from it is marked ``degraded: true`` and its
source kind is ``operator_entered``, so a "no change" report can never be
mistaken for a provider-verified one.

File format -- ``<data root>/state/operator-state.json``::

    {
      "schema_version": 1,
      "kind": "operator_entered_daily_status",
      "note": "...",
      "records": [
        {"day_key": "2026-09-18",
         "entered_at_utc": "2026-09-18T06:40:00Z",
         "account_status": "ACTIVE",
         "earnings_total_cents": 1340,
         "balance_cents": 1340,
         "pending_cents": 0,
         "currency": "USD"}
      ],
      "template_record": {...}
    }

One record per local calendar day, ``day_key`` in ``YYYY-MM-DD``.  Only the
record whose ``day_key`` equals today's operator-local day is used: a stale
record is never silently carried forward as if it were today's reading.
"""

import json
import os

import paths

KIND = "operator_entered"
READ_OPS = []

TEMPLATE_RECORD = {
    "day_key": "YYYY-MM-DD",
    "entered_at_utc": "YYYY-MM-DDTHH:MM:SSZ",
    "account_status": "ACTIVE",
    "earnings_total_cents": 0,
    "balance_cents": 0,
    "pending_cents": 0,
    "currency": "USD",
}

_RECORD_FIELDS = (
    "day_key",
    "entered_at_utc",
    "account_status",
    "earnings_total_cents",
    "balance_cents",
    "pending_cents",
    "currency",
)

_HOW_TO = [
    "Open your own account dashboard in a browser and log in yourself.",
    "Note four figures: account status, total earnings, current balance, pending amount.",
    "Append one record to the records list with today's local date as day_key.",
    "Amounts are integer cents (1340 == 13.40). entered_at_utc is the moment you read them.",
]


def template_document() -> dict:
    return {
        "schema_version": paths.SCHEMA_VERSION,
        "kind": "operator_entered_daily_status",
        "note": (
            "Operator-entered daily status figures. This routine only reads this "
            "file; it never contacts the platform and never takes an action. "
            "Every snapshot built from it is marked degraded: true."
        ),
        "how_to": list(_HOW_TO),
        "records": [],
        "template_record": dict(TEMPLATE_RECORD),
    }


def ensure_template() -> bool:
    """Create the operator state file with an empty template if it is absent."""
    path = paths.operator_state_path()
    if path.exists():
        return False
    paths.write_json_atomic(path, template_document())
    return True


def load_document():
    return paths.read_json(paths.operator_state_path(), default=None)


def record_for_day(day, document=None):
    """Return the record whose day_key is exactly *day*, else None."""
    doc = document if document is not None else load_document()
    if not isinstance(doc, dict):
        return None
    records = doc.get("records")
    if not isinstance(records, list):
        return None
    match = None
    for entry in records:
        if isinstance(entry, dict) and entry.get("day_key") == day:
            match = entry
    return match


def read_source(day) -> dict:
    """Read today's operator-entered figures.  Never raises, never opens a socket.

    Returns a dict with the same shape the other read source produces, so
    ``run_daily_check`` treats both sources identically.
    """
    ensure_template()
    document = load_document() or {}
    record = record_for_day(day, document)
    if record is None:
        return {
            "kind": KIND,
            "read_ops": list(READ_OPS),
            "data_available": False,
            "note": (
                "no operator-entered record for %s in %s"
                % (day, os.path.basename(str(paths.operator_state_path())))
            ),
            "payload": None,
            "raw_body": b"",
        }
    payload = {key: record.get(key) for key in _RECORD_FIELDS if key in record}
    payload.pop("day_key", None)
    payload.pop("entered_at_utc", None)
    raw = json.dumps(record, sort_keys=True).encode("utf-8")
    return {
        "kind": KIND,
        "read_ops": list(READ_OPS),
        "data_available": True,
        "note": "operator-entered record for %s" % day,
        "payload": payload,
        "raw_body": raw,
    }
