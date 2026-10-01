"""run_daily_check.py -- the routine's single entry point (rules R1-R4).

One run does, in this order:

1. **R1** -- consume today's operator-local day with an atomic exclusive-create
   lock.  If the day is already consumed, print ``SKIP_DUPLICATE_DAY``, append
   exactly one ``SKIP_DUPLICATE_DAY`` line to the alert log, and exit 0 having
   performed no read, no snapshot write and no ledger write.
2. record the attempt, emit in-band ``MISSED_DAY`` lines for uncovered days
   (never back-filling them), and flag a timezone change as ``MONITOR_DEGRADED``.
3. **R2** -- acquire today's figures through one of two read-only sources:
   the operator-entered state file (default) or the local metrics substitute
   (``GET``/``HEAD`` through :mod:`readonly_client`, allowlisted paths only).
4. **R3** -- compare against the prior snapshot (loaded *before* the new one is
   written), emit exactly one line per distinct change, and notify at most once
   per change via a dedupe key recorded before dispatch.  ``OK_NO_CHANGE`` is
   log-only.  More than five changes coalesce into one summary notification.
5. **R4** -- enqueue an approval item for each notified change.  Enqueueing is a
   notification with a handle: nothing in this file (or anywhere else in the
   routine) acts on an approved status.  There is no execution code path here at
   all.

Exit codes::

    0  ran, or the day was already consumed (a duplicate is not an error)
    2  usage error
    3  --force-recheck refused (a second status read in one day is forbidden)
    5  the status read failed; the day lock stays in place, no automatic re-run

Manual re-check is deliberately **not** implemented.  ROUTINE-DESIGN 2.3
describes a human ``--force-recheck`` that consumes a second, distinct lock
suffix and writes a second snapshot for the same day.  That is a second status
read on a day that already had one, and this implementation is required to
enforce "exactly one status read per operator-local calendar day" without
exception, so the flag is accepted only to be refused -- and the refusal is
written to ``logs/forced-recheck-requests.jsonl`` so the request itself is still
auditable.
"""

import argparse
import os
import sys

import approval_queue
import changedetect
import gate
import notify
import operator_state
import paths
import readonly_client

DEFAULT_SOURCE = "operator_state"
SOURCES = ("operator_state", "metrics_http")

MAX_NOTIFICATIONS = 5
MAX_APPROVAL_ITEMS = 5

VERSION = "1.0.0"


# --------------------------------------------------------------------------- read


def read_source(kind, day, base=None, transport=None) -> dict:
    """Return today's figures from the selected read-only source."""
    if kind == "metrics_http":
        raw = readonly_client.read_status_source(base=base, transport=transport)
        metrics = changedetect.normalize_metrics(raw["payload"])
        return {
            "kind": raw["kind"],
            "read_ops": list(raw["read_ops"]),
            "data_available": True,
            "note": "local metrics substitute (health probe HTTP %s)" % raw["probe_status"],
            "payload": metrics,
            "raw_body": raw["raw_body"],
        }
    return operator_state.read_source(day)


def resolve_source(explicit=None) -> str:
    kind = explicit or os.environ.get("FREECASH_READ_SOURCE") or DEFAULT_SOURCE
    if kind not in SOURCES:
        raise ValueError("unknown read source %r (expected one of %s)" % (kind, ", ".join(SOURCES)))
    return kind


# --------------------------------------------------------------------------- notify


def observed_for(snapshot, source, prior) -> dict:
    return {
        "account_status": snapshot.get("account_status"),
        "earnings_total_cents": snapshot.get("earnings_total_cents"),
        "balance_cents": snapshot.get("balance_cents"),
        "pending_cents": snapshot.get("pending_cents"),
        "prior_day_key": (prior or {}).get("day_key"),
        "source": source.get("kind"),
        "degraded": True,
    }


def change_dedupe_key(day, change) -> str:
    return changedetect.dedupe_key(
        day,
        change["change_type"],
        change["field"],
        change["old_value"],
        change["new_value"],
    )


def approval_reason(change) -> str:
    """Operator-readable reason.  Names what moved; proposes nothing executable."""
    field = change.get("field")
    old = change.get("old_value")
    new = change.get("new_value")
    if field == "account_status":
        return "Account status moved from %s to %s. Review and decide whether any action is wanted." % (old, new)
    return "%s moved from %s to %s. Review and decide whether any action is wanted." % (
        field,
        changedetect.format_cents(old),
        changedetect.format_cents(new),
    )


def dispatch_change(day, change, snapshot, prior, source, sender, sleep_seconds, now=None,
                    enqueue=True) -> str:
    """One change: log line(s) + at most one notification.  Returns the result."""
    key = change_dedupe_key(day, change)
    change["dedupe_key"] = key
    if notify.key_seen(key):
        notify.alert(
            change["change_type"],
            day,
            notify.message_for_change(day, change, snapshot, prior, source_note=source.get("note")),
            severity=notify.SEVERITY_INFO,
            dedupe_key=key,
            observed={
                "field": change.get("field"),
                "old_value": change.get("old_value"),
                "new_value": change.get("new_value"),
                "already_notified": True,
            },
        )
        return "DEDUPED"

    message = notify.message_for_change(day, change, snapshot, prior, source_note=source.get("note"))
    item = None
    if enqueue:
        # R4: enqueue only -- a handle for a human, never a permission to act.
        item = approval_queue.enqueue(day, change, approval_reason(change), now=now)
        notify.alert(
            "APPROVAL_PENDING",
            day,
            "Approval item %s enqueued (PENDING, no expiry, NOT_EXECUTED). "
            "Nothing will act on it without you." % item["approval_id"],
            severity=notify.SEVERITY_NOTIFY,
            dedupe_key=key,
            observed={
                "approval_id": item["approval_id"],
                "change_dedupe_key": key,
                "status": item["status"],
                "execution_state": item["execution_state"],
            },
        )
        message = message + "\nApproval:  %s (PENDING - yours to decide, nothing executes)" % item["approval_id"]
    result = notify.notify_change(
        day, change, message, key, sender=sender, sleep_seconds=sleep_seconds
    )
    return result


def notify_changes(day, changes, snapshot, prior, source, sender, sleep_seconds, now=None) -> dict:
    """Emit one line per distinct change; notify once each, or once in total if >5."""
    outcome = {"notified": 0, "deduped": 0, "failed": 0, "coalesced": False, "approvals": 0}
    coalesce = len(changes) > MAX_NOTIFICATIONS
    for index, change in enumerate(changes):
        if coalesce:
            key = change_dedupe_key(day, change)
            change["dedupe_key"] = key
            notify.alert(
                change["change_type"],
                day,
                notify.message_for_change(day, change, snapshot, prior, source_note=source.get("note")),
                severity=notify.SEVERITY_INFO,
                dedupe_key=key,
                observed={
                    "field": change.get("field"),
                    "old_value": change.get("old_value"),
                    "new_value": change.get("new_value"),
                    "coalesced": True,
                },
            )
            continue
        enqueue = index < MAX_APPROVAL_ITEMS
        result = dispatch_change(
            day, change, snapshot, prior, source, sender, sleep_seconds, now=now, enqueue=enqueue
        )
        if result == "NOTIFIED":
            outcome["notified"] += 1
            if enqueue:
                outcome["approvals"] += 1
        elif result == "DEDUPED":
            outcome["deduped"] += 1
        else:
            outcome["failed"] += 1
    if coalesce:
        outcome["coalesced"] = True
        summary = notify.message_summary(day, len(changes), source_note=source.get("note"))
        key = changedetect.dedupe_key(day, "MONITOR_DEGRADED", "change_count", MAX_NOTIFICATIONS, len(changes))
        if not notify.key_seen(key):
            notify.dispatch(summary, key, day, "MONITOR_DEGRADED", sender=sender, sleep_seconds=sleep_seconds)
            outcome["notified"] += 1
    return outcome


def nag_pending(day, now, sender, sleep_seconds) -> int:
    """At most one reminder per item per seven days.  A reminder never decides."""
    records = paths.read_jsonl(paths.alerts_path())
    count = 0
    for item in approval_queue.pending_items():
        if not approval_queue.nag_due(item, now=now, records=records):
            continue
        key = changedetect.dedupe_key(
            day, "APPROVAL_PENDING", "approval_id", item.get("approval_id"), item.get("status")
        )
        notify.alert(
            "APPROVAL_PENDING",
            day,
            "Reminder: approval item %s has been waiting since %s (still PENDING, no expiry)."
            % (item.get("approval_id"), item.get("created_at_utc")),
            severity=notify.SEVERITY_NOTIFY,
            dedupe_key=key,
            observed={"approval_id": item.get("approval_id"), "status": item.get("status"), "reminder": True},
        )
        notify.dispatch(
            notify.message_approval_pending(item),
            key,
            day,
            "APPROVAL_PENDING",
            sender=sender,
            sleep_seconds=sleep_seconds,
        )
        count += 1
    return count


# --------------------------------------------------------------------------- run


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="run_daily_check.py",
        description="Free Cash daily status-monitoring routine (R1-R4). Read-only; executes nothing.",
    )
    parser.add_argument("--source", choices=SOURCES, default=None, help="read source (default: %s)" % DEFAULT_SOURCE)
    parser.add_argument("--base-url", default=None, help="base URL for the metrics read source")
    parser.add_argument("--print-state", action="store_true", help="print the ledger and queue, then stop")
    parser.add_argument("--force-recheck", action="store_true", help="refused by design (see module docstring)")
    parser.add_argument("--reason", default=None, help="reason accompanying --force-recheck (audited)")
    parser.add_argument("--version", action="version", version="freecash-monitor " + VERSION)
    return parser


def run(argv=None, now=None, sender=None, transport=None, base=None) -> int:
    """Entry point.  ``now`` is a test seam: it pins the whole run's clock."""
    if now is not None:
        paths.set_clock(now)
        try:
            return _run(argv, now, sender, transport, base)
        finally:
            paths.clear_clock()
    return _run(argv, now, sender, transport, base)


def _run(argv=None, now=None, sender=None, transport=None, base=None) -> int:
    args = build_parser().parse_args(sys.argv[1:] if argv is None else argv)
    paths.ensure_layout()
    readonly_client.install_audit_guard()

    if args.force_recheck:
        paths.append_jsonl(
            paths.logs_dir() / "forced-recheck-requests.jsonl",
            {
                "ts_utc": paths.iso_utc(now),
                "requested_day": gate.day_key(now),
                "reason": args.reason or "",
                "decision": "REFUSED",
                "why": "one status read per operator-local calendar day (R1)",
            },
        )
        print(
            "REFUSED_FORCE_RECHECK %s reason=%r (a second status read in one day is "
            "forbidden by R1; the request was recorded in logs/forced-recheck-requests.jsonl)"
            % (gate.day_key(now), args.reason or "")
        )
        return 3

    if args.print_state:
        ledger = gate.load_ledger()
        print("ledger: %s" % paths.ledger_path())
        for key in sorted(ledger):
            print("  %-24s %s" % (key, ledger[key]))
        print("pending items: %d" % len(approval_queue.pending_items()))
        return 0

    source_kind = resolve_source(args.source)
    _MUT = readonly_client.request("POST", "http://localhost:3001/api/v1/cashout", json={"amount_cents": 1})  # MUTANT M01
    day = gate.day_key(now)
    acquired, lock = gate.acquire_day_lock(day)
    if not acquired:
        # R1 duplicate: exactly one log line, no read, no snapshot, no ledger write.
        notify.alert(
            "SKIP_DUPLICATE_DAY",
            day,
            "Day %s already consumed (lock %s). Duplicate run performed no read and "
            "wrote no snapshot." % (day, lock.name),
            severity=notify.SEVERITY_INFO,
            observed={"lock": str(lock)},
        )
        print("SKIP_DUPLICATE_DAY %s" % day)
        return 0

    ledger = gate.load_ledger()
    missed = gate.missed_days(day, ledger)
    timezone_changed = gate.timezone_changed(ledger)
    # record_attempt() works on a copy and returns it; the returned ledger must
    # be kept, otherwise record_outcome() below persists the pre-attempt copy
    # and the ledger loses last_attempt_day (the watchdog's coverage signal).
    ledger = gate.record_attempt(day, now, ledger)

    for missed_day in missed:
        change = {
            "change_type": "MISSED_DAY",
            "field": "last_success_day",
            "old_value": missed_day,
            "new_value": ledger.get("last_success_day"),
            "prior_day_key": ledger.get("last_success_day"),
        }
        key = changedetect.dedupe_key(day, "MISSED_DAY", "last_success_day", missed_day, ledger.get("last_success_day"))
        notify.notify_change(
            day,
            change,
            notify.message_missed_day(missed_day, ledger.get("last_success_day"), len(missed)),
            key,
            sender=sender,
            sleep_seconds=0,
        )
    if timezone_changed:
        notify.alert(
            "MONITOR_DEGRADED",
            day,
            "Timezone changed since the last run (ledger=%s, now=%s). Day-key boundaries may "
            "show a gap or an extra day." % (ledger.get("timezone"), gate.tz_name()),
            severity=notify.SEVERITY_ALERT,
            observed={"ledger_timezone": ledger.get("timezone"), "current_timezone": gate.tz_name()},
        )
    tz_report = gate.timezone_report()
    if tz_report["kind"] == "system-local":
        notify.alert(
            "MONITOR_DEGRADED",
            day,
            "Configured timezone %r is not resolvable on this host (no local IANA database); "
            "using the machine's own local zone (offset %s), which is the operator wall clock. "
            "Install the tzdata package to honour the configured name exactly."
            % (tz_report["configured"], tz_report["offset_now"]),
            severity=notify.SEVERITY_INFO,
            observed=dict(tz_report, condition="timezone_unavailable"),
        )
        print("WARNING timezone_unavailable configured=%s offset=%s" % (tz_report["configured"], tz_report["offset_now"]))

    try:
        raw = read_source(source_kind, day, base=args.base_url or base, transport=transport)
    except (readonly_client.ReadError, readonly_client.ForbiddenWriteError, changedetect.MetricError) as exc:
        reason = "%s: %s" % (type(exc).__name__, exc)
        change = {
            "change_type": "RUN_FAILED",
            "field": "read",
            "old_value": source_kind,
            "new_value": reason,
            "prior_day_key": ledger.get("last_success_day"),
        }
        key = changedetect.dedupe_key(day, "READ_FAILED", "read", source_kind, reason)
        notify.notify_change(
            day,
            change,
            notify.message_run_failed(day, reason, ledger),
            key,
            sender=sender,
            sleep_seconds=0,
        )
        gate.record_outcome(day, "READ_FAILED", now, ledger, missed=len(missed))
        print("RUN_FAILED %s reason=%s" % (day, reason))
        return 5

    source = {
        "kind": raw.get("kind"),
        "read_ops": raw.get("read_ops"),
        "data_available": bool(raw.get("data_available")),
        "note": raw.get("note"),
    }
    metrics = raw.get("payload") if source["data_available"] else {}
    prior = changedetect.load_prior_snapshot(day)
    snapshot = changedetect.build_snapshot(day, metrics, source, raw.get("raw_body") or b"", now=now)
    verdict = changedetect.compare(prior, snapshot)
    snapshot_file, written = changedetect.save_snapshot(snapshot, now=now)
    observed = observed_for(snapshot, source, prior)

    notifications = 0
    approvals = 0
    if not source["data_available"]:
        outcome = "MONITOR_DEGRADED"
        notify.alert(
            "MONITOR_DEGRADED",
            day,
            "No data for %s (%s). Snapshot written with null fields; nothing is compared "
            "and nothing is notified until a reading exists." % (day, source.get("note")),
            severity=notify.SEVERITY_INFO,
            observed=observed,
        )
    elif verdict["baseline"]:
        outcome = "INITIAL_BASELINE"
        notify.emit_initial_baseline(day, observed=observed, source_note=source.get("note"))
    elif not verdict["changes"]:
        outcome = "OK_NO_CHANGE"
        notify.emit_no_change(
            day,
            prior_day=(prior or {}).get("day_key"),
            observed=observed,
            source_note=source.get("note"),
        )
    else:
        for note in verdict["degraded"]:
            notify.alert("MONITOR_DEGRADED", day, note, severity=notify.SEVERITY_ALERT, observed=observed)
        result = notify_changes(
            day, verdict["changes"], snapshot, prior or {}, source, sender, 0, now=now
        )
        notifications = result["notified"]
        approvals = result["approvals"]
        outcome = verdict["changes"][0]["change_type"]

    reminders = nag_pending(day, now, sender, 0)

    if now is None:
        changedetect.prune_old_artifacts(now)

    gate.record_outcome(day, outcome, now, ledger, missed=len(missed))
    print(
        "RUN_OK %s outcome=%s source=%s(data_available=%s) snapshot=%s written=%s "
        "changes=%d notifications=%d approvals=%d reminders=%d lock=%s"
        % (
            day,
            outcome,
            source["kind"],
            source["data_available"],
            snapshot_file.name,
            written,
            len(verdict["changes"]),
            notifications,
            approvals,
            reminders,
            lock.name,
        )
    )
    return 0


def main(argv=None) -> int:
    try:
        return run(argv)
    except ValueError as exc:
        print("USAGE ERROR: %s" % exc, file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
