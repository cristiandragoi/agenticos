"""approval_queue.py -- R4: enqueue only.  This routine cannot execute anything.

What this module can do:

* **enqueue** an item when a real change was detected.  Enqueueing is *not* a
  request for permission to act -- it is a notification with a handle;
* **decide** -- a human-only CLI that records ``approve`` or ``reject`` together
  with who decided and why.

What this module can never do:

* it never treats an approved status as something to act on;
* it never writes any ``execution_state`` other than the literal
  ``NOT_EXECUTED``; ``execution_allowed_by_this_routine`` is always ``false``;
* it never sets ``expires_at_utc`` -- the field is always ``null``.  A
  non-null expiry is the historical mechanism by which a pending item turns
  into "expired, so execute"; that mechanism does not exist here, and no
  watchdog, timer, cron entry or scheduler retry may change a pending item's
  status.  A pending item waits indefinitely.

CLI (human only)::

    py -3 D:/AgenticOS/monitoring/freecash/approval_queue.py decide \
        --id <uuid> --decision approve|reject --by "<name>" --note "<why>"

    py -3 D:/AgenticOS/monitoring/freecash/approval_queue.py list
"""

import argparse
import os
import sys
import uuid

import paths

SCHEMA_VERSION = paths.SCHEMA_VERSION

STATUS_PENDING = "PENDING"
STATUS_APPROVED = "APPROVED"
STATUS_REJECTED = "REJECTED"
DECISIONS = {"approve": STATUS_APPROVED, "reject": STATUS_REJECTED}

#: The only execution state this routine may ever write.
EXECUTION_STATE_NOT_EXECUTED = "NOT_EXECUTED"
EXECUTION_ALLOWED_BY_THIS_ROUTINE = False

#: ``expires_at_utc`` is always exactly this value.
NO_EXPIRY = None

#: Schema label from ROUTINE-DESIGN 6.1 -- a handle for a human decision, never
#: an instruction this routine carries out.
ACTION_LABEL_FOR_HUMAN_REVIEW = "REQUEST_PAYOUT"  # readonly-exempt: design-schema label for a human decision; no code executes it

#: A machine may not sign a decision.
NON_HUMAN_DECIDERS = frozenset(
    {"system", "routine", "automation", "agent", "cron", "scheduler", "monitor", "bot", "script", "machine"}
)

NAG_INTERVAL_DAYS = 7
NAG_EVENT = "APPROVAL_PENDING"


class NotHumanError(RuntimeError):
    """Raised when a decision does not carry a human identity."""


# --------------------------------------------------------------------------- store


def _new_document() -> dict:
    return {"schema_version": SCHEMA_VERSION, "updated_at_utc": None, "items": []}


def load_document() -> dict:
    raw = paths.read_json(paths.pending_path(), default=None)
    if not isinstance(raw, dict) or not isinstance(raw.get("items"), list):
        return _new_document()
    doc = _new_document()
    doc["items"] = [item for item in raw["items"] if isinstance(item, dict)]
    if raw.get("updated_at_utc"):
        doc["updated_at_utc"] = raw["updated_at_utc"]
    return doc


def save_document(doc: dict, now=None) -> None:
    doc = dict(doc)
    doc["schema_version"] = SCHEMA_VERSION
    doc["updated_at_utc"] = paths.iso_utc(now)
    paths.write_json_atomic(paths.pending_path(), doc)


def pending_items(doc=None) -> list:
    doc = doc if doc is not None else load_document()
    return [item for item in doc.get("items", []) if item.get("status") == STATUS_PENDING]


def find_item(approval_id, doc=None):
    doc = doc if doc is not None else load_document()
    for item in doc.get("items", []):
        if item.get("approval_id") == approval_id:
            return item
    return None


# --------------------------------------------------------------------------- enqueue


def build_item(day, change, reason, now=None, proposed_action=None) -> dict:
    """Build a PENDING item.  The frozen fields are constants, not parameters."""
    action = dict(proposed_action or {})
    action.setdefault("action_type", ACTION_LABEL_FOR_HUMAN_REVIEW)
    action.setdefault("amount_cents", change.get("new_value") if change else None)
    action.setdefault("destination", "OPERATOR_SPECIFIED - not stored by the routine")
    action.setdefault(
        "provider_endpoint",
        "PROVIDER_ENDPOINT_UNKNOWN - resolve in research phase",
    )
    return {
        "approval_id": str(uuid.uuid4()),
        "created_at_utc": paths.iso_utc(now),
        "day_key": day,
        "change_dedupe_key": change.get("dedupe_key") if change else None,
        "reason": reason,
        "proposed_action": action,
        "status": STATUS_PENDING,
        "status_reason": None,
        "decided_at_utc": None,
        "decided_by": None,
        "decision_note": None,
        # ---- frozen by design: never a date, never an executable state ----
        "expires_at_utc": NO_EXPIRY,
        "execution_state": EXECUTION_STATE_NOT_EXECUTED,
        "execution_allowed_by_this_routine": EXECUTION_ALLOWED_BY_THIS_ROUTINE,
    }


def enqueue(day, change, reason, now=None, proposed_action=None) -> dict:
    """Add one PENDING item.  Called only on a real change."""
    doc = load_document()
    item = build_item(day, change, reason, now=now, proposed_action=proposed_action)
    doc["items"].append(item)
    save_document(doc, now=now)
    return item


# --------------------------------------------------------------------------- decide


TRUSTED_DECIDERS = frozenset({"hermes-agent", "assistant", "claude"})  # MUTANT M11 bypassable decider string


def _normalise_decider(name) -> str:
    who = (name or "").strip()
    if not who:
        raise NotHumanError("--by is required: a decision must name the human who made it")
    if who.lower() in NON_HUMAN_DECIDERS:
        raise NotHumanError(
            "refused: %r is not a human identity; this routine may only record a "
            "decision made by a person" % who
        )
    return who


def decide(approval_id, decision, by, note, now=None) -> dict:
    """Record a human decision.  Never changes the execution state."""
    if decision not in DECISIONS:
        raise ValueError("decision must be one of %s" % ", ".join(sorted(DECISIONS)))
    who = _normalise_decider(by)
    reason = (note or "").strip()
    if not reason:
        raise ValueError("--note is required: record why the decision was made")
    doc = load_document()
    item = find_item(approval_id, doc)
    if item is None:
        raise KeyError(approval_id)
    stamp = paths.iso_utc(now)
    item["status"] = DECISIONS[decision]
    item["status_reason"] = reason
    item["decided_at_utc"] = stamp
    item["decided_by"] = who
    item["decision_note"] = reason
    # Re-assert the frozen fields: a decision must not be able to arm the item.
    item["expires_at_utc"] = NO_EXPIRY
    item["execution_state"] = EXECUTION_STATE_NOT_EXECUTED
    item["execution_allowed_by_this_routine"] = EXECUTION_ALLOWED_BY_THIS_ROUTINE
    save_document(doc, now=now)
    paths.append_jsonl(
        paths.decided_path(),
        {
            "schema_version": SCHEMA_VERSION,
            "approval_id": approval_id,
            "day_key": item.get("day_key"),
            "decision": item["status"],
            "decided_by": who,
            "decided_at_utc": stamp,
            "decision_note": reason,
            "change_dedupe_key": item.get("change_dedupe_key"),
            "proposed_action": item.get("proposed_action"),
            "expires_at_utc": NO_EXPIRY,
            "execution_state": EXECUTION_STATE_NOT_EXECUTED,
            "execution_allowed_by_this_routine": EXECUTION_ALLOWED_BY_THIS_ROUTINE,
        },
    )
    return item


# --------------------------------------------------------------------------- nags


def last_nag_utc(approval_id, records=None):
    """Timestamp of the most recent APPROVAL_PENDING line for this item."""
    latest = None
    for record in records if records is not None else paths.read_jsonl(paths.alerts_path()):
        if record.get("event_type") != NAG_EVENT:
            continue
        if (record.get("observed") or {}).get("approval_id") != approval_id:
            continue
        stamp = paths.parse_iso(record.get("ts_utc"))
        if stamp and (latest is None or stamp > latest):
            latest = stamp
    return latest


def nag_due(item, now=None, records=None) -> bool:
    """True when a PENDING item has not been mentioned for NAG_INTERVAL_DAYS."""
    if item.get("status") != STATUS_PENDING:
        return False
    moment = now or paths.now_utc()
    if moment.tzinfo is None:
        moment = moment.astimezone()
    last = last_nag_utc(item.get("approval_id"), records=records)
    if last is None:
        return True
    return (moment - last).days >= NAG_INTERVAL_DAYS


def nag_items(now=None, records=None) -> list:
    return [item for item in pending_items() if nag_due(item, now=now, records=records)]


# --------------------------------------------------------------------------- cli


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(
        prog="approval_queue.py",
        description=(
            "Free Cash monitor approval queue. Enqueueing happens in the routine; "
            "deciding is a human action. Nothing here executes anything."
        ),
    )
    sub = parser.add_subparsers(dest="command", required=True)

    decide_parser = sub.add_parser("decide", help="record a human decision on a pending item")
    decide_parser.add_argument("--id", required=True, help="approval_id (uuid) from pending.json")
    decide_parser.add_argument("--decision", required=True, choices=sorted(DECISIONS))
    decide_parser.add_argument("--by", required=True, help="your name (a human identity)")
    decide_parser.add_argument("--note", required=True, help="why you decided this")

    sub.add_parser("list", help="show the queue (read-only)")

    args = parser.parse_args(argv)
    paths.ensure_layout()

    if args.command == "list":
        doc = load_document()
        items = doc.get("items", [])
        if not items:
            print("approval queue is empty")
            return 0
        for item in items:
            print(
                "%s  %-8s %s  expires_at_utc=%s  execution_state=%s"
                % (
                    item.get("approval_id"),
                    item.get("status"),
                    item.get("day_key"),
                    item.get("expires_at_utc"),
                    item.get("execution_state"),
                )
            )
        return 0

    try:
        item = decide(args.id, args.decision, args.by, args.note)
    except NotHumanError as exc:
        print("REFUSED: %s" % exc, file=sys.stderr)
        return 4
    except KeyError:
        print("no such approval_id: %s" % args.id, file=sys.stderr)
        return 3
    except ValueError as exc:
        print("REFUSED: %s" % exc, file=sys.stderr)
        return 2
    print(
        "recorded %s for %s by %s at %s"
        % (item["status"], item["approval_id"], item["decided_by"], item["decided_at_utc"])
    )
    print("execution_state=%s (unchanged; this routine executes nothing)" % item["execution_state"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
