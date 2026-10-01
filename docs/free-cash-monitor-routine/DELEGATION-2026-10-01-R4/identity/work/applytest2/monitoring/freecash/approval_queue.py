"""approval_queue.py -- R4 (operator title: "human approval before ANY external
action; nothing auto-executes"): enqueue only.  This routine cannot execute
anything.

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

Identity control (R4) -- ALLOWLIST, fail-closed
-----------------------------------------------
The decider guard is an **operator-owned allowlist**, not a denylist of bad
words.  Two DIFFERENT properties are carried by two different mechanisms and
must be reported separately:

* **ATTRIBUTION** ("only a human may sign a decision") -- carried by the
  allowlist below;
* **SAFETY** ("an approval can never arm an action") -- carried by the frozen
  fields ``execution_state`` / ``execution_allowed_by_this_routine`` /
  ``expires_at_utc``, which are written *only* as the constants
  ``NOT_EXECUTED`` / ``False`` / ``None`` and re-asserted on every write.

The allowlist rule:

* it lives at ``<data root>/state/human-deciders.json`` (resolve it read-only
  with ``approval_queue.py allowlist``).  It is a plain JSON file the operator
  writes by hand; this module has **no code path that writes it**;
* an optional single identity may also be supplied with the
  ``FREECASH_OPERATOR_IDENTITY`` environment variable, for hosts that prefer not
  to keep a file.  It is read, never written, by this routine;
* **missing, unreadable, malformed, out-of-schema, empty, or machine-labelled
  allowlist -> EVERY decider is refused** (fail closed, exit 4).  An
  unconfigured allowlist never means "allow anything";
* there are TWO floors that apply to *both* the allowlist entries and the
  decider: the exact-word set ``NON_HUMAN_DECIDERS`` (retained) and the
  ``MACHINE_LABEL_PATTERN`` (which covers vendor/model names too: hermes,
  assistant, claude, gpt, llm, ...).  Neither floor is the control -- the
  control is allowlist membership -- but together they stop a machine-labelled
  name from ever being allowlisted or signing.

CLI (human only)::

    py -3 D:/AgenticOS/monitoring/freecash/approval_queue.py decide \\
        --id <uuid> --decision approve|reject --by "<name>" --note "<why>"

    py -3 D:/AgenticOS/monitoring/freecash/approval_queue.py list
    py -3 D:/AgenticOS/monitoring/freecash/approval_queue.py allowlist
"""

import argparse
import json
import os
import re
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

#: Cheap word floor (retained).  It catches the bare words only; it is NOT the
#: control.  The control is the operator-owned allowlist below.
NON_HUMAN_DECIDERS = frozenset(
    {"system", "routine", "automation", "agent", "cron", "scheduler", "monitor", "bot", "script", "machine"}
)

#: --- THE CONTROL ---------------------------------------------------------
#: Operator-owned allowlist.  Fixed filename inside the routine's *state*
#: directory, so it cannot be redirected by an environment variable; this module
#: only ever reads it.  When it is missing / corrupt / empty, every decider is
#: refused (fail closed) -- see load_operator_allowlist().
OPERATOR_ALLOWLIST_FILENAME = "human-deciders.json"

#: Optional single-identity source, read (never written) from the host
#: environment.  Same trust boundary as the allowlist file: whoever can set it
#: can already edit the file.  A machine-looking value is refused (fail closed).
OPERATOR_IDENTITY_ENV = "FREECASH_OPERATOR_IDENTITY"

#: Accepted shape version of the allowlist file.
ALLOWLIST_SCHEMA_VERSION = 1

#: Floor pattern applied to allowlist entries, to the env override, and to the
#: decider.  Covers process words and vendor/model names, so "hermes-agent",
#: "assistant" and "claude" are refused even if someone allowlists them.  This
#: is a FLOOR, not the control: the control is allowlist membership.
MACHINE_LABEL_PATTERN = re.compile(
    r"(?i)\b("
    r"agent|ai|anthropic|assistant|automated|automation|bot|chatbot|claude|"
    r"copilot|cron|daemon|deepseek|gemini|gpt|hermes|llm|machine|model|monitor|"
    r"openai|pipeline|qwen|robot|routine|scheduler|script|service|system|worker"
    r")\b"
)

NAG_INTERVAL_DAYS = 7
NAG_EVENT = "APPROVAL_PENDING"


class NotHumanError(RuntimeError):
    """Raised when a decision does not carry a human identity."""


class AllowlistError(NotHumanError):
    """Raised when the operator allowlist is absent or unusable.

    A subclass of NotHumanError on purpose: the CLI already maps NotHumanError
    to a refusal (exit 4), and an unusable allowlist must refuse, never accept.
    """


# --------------------------------------------------------------- identity (control)


def operator_allowlist_path():
    """Where the operator-editable allowlist lives (never created here)."""
    return paths.state_dir() / OPERATOR_ALLOWLIST_FILENAME


def _allowlist_entries(raw, source):
    """Validate one allowlist source into a list of identities (or raise)."""
    if not isinstance(raw, list) or not raw:
        raise AllowlistError(
            "refused: the operator allowlist (%s) lists no identities; refusing "
            "every decider (fail-closed)" % source
        )
    out = []
    for entry in raw:
        if not isinstance(entry, str) or not entry.strip():
            raise AllowlistError(
                "refused: the operator allowlist (%s) has a malformed entry %r; "
                "every entry must be a non-empty name; refusing every decider "
                "(fail-closed)" % (source, entry)
            )
        name = entry.strip()
        if MACHINE_LABEL_PATTERN.search(name) or name.lower() in NON_HUMAN_DECIDERS:
            raise AllowlistError(
                "refused: the operator allowlist (%s) lists a machine-looking "
                "identity %r; a machine may not be allowlisted; refusing every "
                "decider (fail-closed)" % (source, name)
            )
        out.append(name)
    return out


def _read_allowlist_file(path):
    """Return the file's identities, or None when the file does not exist."""
    try:
        with open(path, "r", encoding="utf-8") as fh:
            raw = fh.read()
    except FileNotFoundError:
        return None
    except OSError as exc:
        raise AllowlistError(
            "refused: the operator allowlist at %s cannot be read (%s); refusing "
            "every decider (fail-closed)" % (path, exc.__class__.__name__)
        )
    try:
        doc = json.loads(raw)
    except ValueError as exc:
        raise AllowlistError(
            "refused: the operator allowlist at %s is not valid JSON (%s); "
            "refusing every decider (fail-closed)" % (path, exc)
        )
    if not isinstance(doc, dict):
        raise AllowlistError(
            "refused: the operator allowlist at %s must be a JSON object, found "
            "%s; refusing every decider (fail-closed)" % (path, type(doc).__name__)
        )
    if doc.get("schema_version") != ALLOWLIST_SCHEMA_VERSION:
        raise AllowlistError(
            "refused: the operator allowlist at %s has schema_version=%r (need %d); "
            "refusing every decider (fail-closed)"
            % (path, doc.get("schema_version"), ALLOWLIST_SCHEMA_VERSION)
        )
    return _allowlist_entries(doc.get("operators"), str(path))


def _read_allowlist_env():
    """Return the identities supplied by the environment override (or [])."""
    raw = (os.environ.get(OPERATOR_IDENTITY_ENV) or "").strip()
    if not raw:
        return []
    return _allowlist_entries([raw], "%s environment variable" % OPERATOR_IDENTITY_ENV)


def load_operator_allowlist():
    """Return ``(identities, path)`` -- the configured human identities.

    Fails CLOSED: when nothing is configured, or when a configured source is
    unusable, raises AllowlistError (a NotHumanError) so that *every* decider is
    refused.  A missing allowlist is never an open door.
    """
    path = operator_allowlist_path()
    file_ops = _read_allowlist_file(path)
    env_ops = _read_allowlist_env()
    if file_ops is None and not env_ops:
        raise AllowlistError(
            "refused: no operator identity is configured. Create %s as "
            '{"schema_version": 1, "operators": ["<your name>"]} or set %s="<your '
            "name>\"; an unconfigured allowlist refuses every decider "
            "(fail-closed)." % (path, OPERATOR_IDENTITY_ENV)
        )
    merged = list(dict.fromkeys((file_ops or []) + env_ops))
    return merged, path


def _normalise_decider(name):
    """Return the signing human's name, or refuse (allowlist, fail-closed).

    ATTRIBUTION control only.  Nothing here can arm an item: a decision recorded
    by an accepted name is still written with the frozen fields.
    """
    who = (name or "").strip()
    if not who:
        raise NotHumanError("--by is required: a decision must name the human who made it")
    # The control: the operator-owned allowlist.  An absent/corrupt/unconfigured
    # allowlist raises here, so every decider is refused before any check below.
    allowed, path = load_operator_allowlist()
    # Floors -- retained, but NOT the control.
    if who.lower() in NON_HUMAN_DECIDERS:
        raise NotHumanError(
            "refused: %r is a machine label; a machine may not sign a decision" % who
        )
    if MACHINE_LABEL_PATTERN.search(who):
        raise NotHumanError("refused: %r matches a machine-label pattern" % who)
    if not any(who.casefold() == entry.casefold() for entry in allowed):
        raise NotHumanError(
            "refused: %r is not in the operator allowlist at %s (%d identity/ies "
            "configured); only a configured human may sign" % (who, path, len(allowed))
        )
    return who


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
    decide_parser.add_argument("--by", required=True, help="your name (must match the operator allowlist)")
    decide_parser.add_argument("--note", required=True, help="why you decided this")

    sub.add_parser("list", help="show the queue (read-only)")
    sub.add_parser(
        "allowlist",
        help="show where the operator allowlist lives and who is configured (read-only)",
    )

    args = parser.parse_args(argv)

    if args.command == "allowlist":
        try:
            path = operator_allowlist_path()
            env_set = bool((os.environ.get(OPERATOR_IDENTITY_ENV) or "").strip())
            print("operator allowlist : %s" % path)
            print(
                "override env var   : %s (%s)"
                % (OPERATOR_IDENTITY_ENV, "set" if env_set else "unset")
            )
            allowed, _ = load_operator_allowlist()
            print("state              : CONFIGURED (%d identity/ies)" % len(allowed))
            for name in allowed:
                print("  - %s" % name)
            return 0
        except NotHumanError as exc:
            print("REFUSED: %s" % exc, file=sys.stderr)
            return 4

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
