"""notify.py -- R3 delivery: append-only alert log + Windows toast (cap 2 tries).

Channels (ROUTINE-DESIGN 5.1)::

    alerts/alerts.jsonl   append-only, always on -- the canonical evidence record
    Windows toast         default delivery channel; a stub sender is available for
                          offline tests (delivery label STUB_OK, never TOAST_OK)
    SMTP                  opt-in and OFF by default; not wired to any credential here

Invariants enforced here:

* ``OK_NO_CHANGE`` is **log-only** -- it never dispatches a notification;
* the dedupe key is written into ``notified-keys.json`` **before** the dispatch
  attempt, so a crash can lose one message but can never duplicate one;
* a delivery failure means at most two attempts, then one ``DELIVERY_FAILED``
  line carrying the **full original message**, the key marked ``FAILED_TOAST``,
  and no further retry of that key ever;
* a failed notification never blocks a state write, never re-reads the status
  source, never causes a second run and never touches the approval queue.
"""

import os
import subprocess
import time
import uuid

import paths

SEVERITY_INFO = "info"
SEVERITY_NOTIFY = "notify"
SEVERITY_ALERT = "alert"

SEVERITIES = (SEVERITY_INFO, SEVERITY_NOTIFY, SEVERITY_ALERT)

#: Event types whose default severity is not "info".
_ALERT_EVENTS = frozenset({"READ_FAILED", "RUN_FAILED", "MISSED_DAY", "DELIVERY_FAILED", "MONITOR_DEGRADED"})
_NOTIFY_EVENTS = frozenset(
    {"EARNINGS_CHANGED", "STATUS_CHANGED", "BALANCE_CHANGED", "APPROVAL_PENDING"}
)

MAX_MESSAGE = 500
MAX_ATTEMPTS = 2
DEFAULT_RETRY_SLEEP_SECONDS = 5.0
DELIVERY_QUEUED = "QUEUED"
DELIVERY_TOAST_OK = "TOAST_OK"
DELIVERY_STUB_OK = "STUB_OK"
DELIVERY_FAILED = "FAILED_TOAST"

_sender_override = None


def default_severity(event_type: str) -> str:
    if event_type in _ALERT_EVENTS:
        return SEVERITY_ALERT
    if event_type in _NOTIFY_EVENTS:
        return SEVERITY_NOTIFY
    return SEVERITY_INFO


# --------------------------------------------------------------------------- log


def alert(event_type, day_key, message, severity=None, dedupe_key=None, observed=None) -> dict:
    """Append exactly one line to the append-only alert log.  Returns the record."""
    text = "" if message is None else str(message)
    if len(text) > MAX_MESSAGE:
        text = text[: MAX_MESSAGE - 3] + "..."
    record = {
        "event_id": str(uuid.uuid4()),
        "ts_utc": paths.iso_utc(),
        "day_key": day_key,
        "event_type": event_type,
        "dedupe_key": dedupe_key,
        "severity": severity or default_severity(event_type),
        "message": text,
        "observed": observed if isinstance(observed, dict) else {},
    }
    paths.append_jsonl(paths.alerts_path(), record)
    return record


def zero_notifications_message(prior_day=None, source_note=None) -> str:
    base = "No change vs %s. No notification sent." % (prior_day or "the previous snapshot")
    if source_note:
        base += " Source DEGRADED (%s)." % source_note
    else:
        base += " Source DEGRADED."
    return base


def emit_no_change(day, prior_day=None, observed=None, source_note=None, sender=None) -> dict:
    """The log-only no-change line.  Never dispatches, whatever else happens."""
    _record = alert(
        "OK_NO_CHANGE",
        day,
        zero_notifications_message(prior_day, source_note),
        severity=SEVERITY_INFO,
        observed=observed,
    )
    dispatch(  # MUTATION: notify the operator on a no-change day
        zero_notifications_message(prior_day, source_note),
        "nochange:%s" % day,
        day,
        "OK_NO_CHANGE",
        sender=sender,
    )
    return _record


def emit_initial_baseline(day, observed=None, source_note=None) -> dict:
    return alert(
        "INITIAL_BASELINE",
        day,
        "First run: baseline recorded for %s. No notification sent. Source DEGRADED (%s)."
        % (day, source_note or "substitute source"),
        severity=SEVERITY_INFO,
        observed=observed,
    )


# --------------------------------------------------------------------------- keys


def load_notified_keys() -> dict:
    doc = paths.read_json(paths.notified_keys_path(), default=None)
    if not isinstance(doc, dict) or not isinstance(doc.get("keys"), dict):
        doc = {"schema_version": paths.SCHEMA_VERSION, "keys": {}}
    return doc


def key_seen(key: str) -> bool:
    return key in load_notified_keys()["keys"]


def key_delivery(key: str):
    entry = load_notified_keys()["keys"].get(key)
    return entry.get("delivery") if isinstance(entry, dict) else None


def record_notified_key(key: str, delivery: str) -> dict:
    """Write the key (atomically) into the index.  Called BEFORE any dispatch."""
    doc = load_notified_keys()
    entry = doc["keys"].get(key)
    if isinstance(entry, dict):
        entry["delivery"] = delivery
        entry["updated_at_utc"] = paths.iso_utc()
    else:
        doc["keys"][key] = {
            "first_notified_at_utc": paths.iso_utc(),
            "delivery": delivery,
        }
    paths.write_json_atomic(paths.notified_keys_path(), doc)
    return doc["keys"][key]


# --------------------------------------------------------------------------- toast


def _stub_send(message: str) -> None:
    """Offline stand-in for the toast channel (test/host without a desktop).

    The delivery label it produces is ``STUB_OK``, never ``TOAST_OK``, so a
    stubbed run can never be mistaken for a real delivery.
    """
    line = "[STUB TOAST %s] %s\n" % (paths.iso_utc(), message.replace("\n", " | "))
    path = paths.logs_dir() / "toast-stub.log"
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "a", encoding="utf-8", newline="\n") as fh:
        fh.write(line)


_stub_send.delivery_label = DELIVERY_STUB_OK


def _toast_send(message: str) -> None:
    """Deliver via a Windows-native balloon tip.  Raises on any failure."""
    script = (
        "$ErrorActionPreference='Stop';"
        "Add-Type -AssemblyName System.Windows.Forms;"
        "Add-Type -AssemblyName System.Drawing;"
        "$n=New-Object System.Windows.Forms.NotifyIcon;"
        "$n.Icon=[System.Drawing.SystemIcons]::Information;"
        "$n.BalloonTipTitle='FreeCash Monitor';"
        "$n.BalloonTipText=$env:FREECASH_TOAST_TEXT;"
        "$n.Visible=$true;"
        "$n.ShowBalloonTip(20000);"
        "Start-Sleep -Seconds 6;"
        "$n.Dispose();"
    )
    env = dict(os.environ)
    env["FREECASH_TOAST_TEXT"] = message[:1200]
    completed = subprocess.run(
        ["powershell", "-NoProfile", "-NonInteractive", "-Command", script],
        env=env,
        capture_output=True,
        timeout=90,
    )
    if completed.returncode != 0:
        stderr = (completed.stderr or b"").decode("utf-8", "replace").strip()
        raise RuntimeError("toast exited %s: %s" % (completed.returncode, stderr[:200]))


def set_sender(sender) -> None:
    """Test seam: route dispatches through *sender* until cleared."""
    global _sender_override
    _sender_override = sender


def get_sender():
    if _sender_override is not None:
        return _sender_override
    if os.environ.get("FREECASH_TOAST_STUB") == "1":
        return _stub_send
    return _toast_send


def retry_sleep_seconds() -> float:
    raw = os.environ.get("FREECASH_TOAST_RETRY_SLEEP_SECONDS")
    try:
        return float(raw) if raw is not None else DEFAULT_RETRY_SLEEP_SECONDS
    except ValueError:
        return DEFAULT_RETRY_SLEEP_SECONDS


# --------------------------------------------------------------------------- dispatch


def dispatch(message, dedupe_key, day_key, event_type, sender=None, sleep_seconds=None) -> str:
    """Notify at most twice, then give up loudly.  Returns the delivery label."""
    sender = sender or get_sender()
    label = getattr(sender, "delivery_label", DELIVERY_TOAST_OK)
    record_notified_key(dedupe_key, DELIVERY_QUEUED)
    sleep_for = retry_sleep_seconds() if sleep_seconds is None else sleep_seconds
    attempts = 0
    last_error = None
    while attempts < MAX_ATTEMPTS:
        attempts += 1
        try:
            sender(message)
            record_notified_key(dedupe_key, label)
            return label
        except Exception as exc:  # noqa: BLE001 - a delivery failure must never escalate
            last_error = exc
            if attempts < MAX_ATTEMPTS and sleep_for:
                time.sleep(sleep_for)
    record_notified_key(dedupe_key, DELIVERY_FAILED)
    alert(
        "DELIVERY_FAILED",
        day_key,
        message,
        severity=SEVERITY_ALERT,
        dedupe_key=dedupe_key,
        observed={
            "event_type": event_type,
            "attempts": attempts,
            "error": str(last_error),
            "delivery": DELIVERY_FAILED,
        },
    )
    alert(
        "MONITOR_DEGRADED",
        day_key,
        "Notification channel failed twice; this message exists only in alerts.jsonl. "
        "Operator must read the log until the channel is fixed.",
        severity=SEVERITY_ALERT,
        dedupe_key=dedupe_key,
        observed={"channel": label, "attempts": attempts},
    )
    return DELIVERY_FAILED


def notify_change(day, change, message, dedupe_key, sender=None, sleep_seconds=None) -> str:
    """One change -> at most one notification, and always exactly one log line."""
    observed = {
        "field": change.get("field"),
        "old_value": change.get("old_value"),
        "new_value": change.get("new_value"),
        "prior_day_key": change.get("prior_day_key"),
    }
    if key_seen(dedupe_key):
        alert(
            change["change_type"],
            day,
            message,
            severity=SEVERITY_INFO,
            dedupe_key=dedupe_key,
            observed=observed,
        )
        return "DEDUPED"
    alert(
        change["change_type"],
        day,
        message,
        # Honour the module's own event table: a MISSED_DAY / READ_FAILED /
        # RUN_FAILED change is an alarm ("alert"), an earnings or status change
        # is a "notify".  Hard-coding SEVERITY_NOTIFY here silently downgraded
        # every alarm routed through this path.
        severity=default_severity(change["change_type"]),
        dedupe_key=dedupe_key,
        observed=observed,
    )
    delivery = dispatch(
        message,
        dedupe_key,
        day,
        change["change_type"],
        sender=sender,
        sleep_seconds=sleep_seconds,
    )
    return "FAILED" if delivery == DELIVERY_FAILED else "NOTIFIED"


# --------------------------------------------------------------------------- templates


def _source_line(source_note=None):
    detail = source_note or "substitute source"
    return "Source:    DEGRADED (%s)" % detail


def _action_line():
    return "ACTION:    No action taken. Review and approve anything you want done."


def _detail_line(dedupe_key):
    return "Detail:    alerts.jsonl dedupe=%s" % (dedupe_key or "run-level")[:16]


def message_for_change(day, change, current, prior, source_note=None) -> str:
    """Exact message templates (a)/(b) of ROUTINE-DESIGN 5.3."""
    field = change.get("field")
    old = change.get("old_value")
    new = change.get("new_value")
    key = change.get("dedupe_key")
    import changedetect as _cd  # local import: keeps module import graph flat

    if change["change_type"] == "STATUS_CHANGED":
        lines = [
            "[FreeCash] STATUS CHANGE %s" % day,
            "Account status: %s -> %s" % (old, new),
            "Earnings:  %s (unchanged)  Balance: %s (unchanged)"
            % (_cd.format_cents(current.get("earnings_total_cents")), _cd.format_cents(current.get("balance_cents"))),
        ]
    else:
        delta = _cd.delta_cents(old, new)
        delta_text = ""
        if delta is not None:
            sign = "+" if delta >= 0 else "-"
            delta_text = "  (%s%s)" % (sign, _cd.format_cents(abs(delta)))
        heading = {
            "EARNINGS_CHANGED": "EARNINGS CHANGE",
            "BALANCE_CHANGED": "BALANCE CHANGE",
        }.get(change["change_type"], "CHANGE")
        lines = ["[FreeCash] %s %s" % (heading, day)]
        if field == "earnings_total_cents":
            lines.append("Earnings:  %s -> %s%s" % (_cd.format_cents(old), _cd.format_cents(new), delta_text))
            lines.append(
                "Balance:   %s%s"
                % (
                    _cd.format_cents(current.get("balance_cents")),
                    "" if prior.get("balance_cents") == current.get("balance_cents") else " (changed too)",
                )
            )
            lines.append("Pending:   %s" % _cd.format_cents(current.get("pending_cents")))
            lines.append("Status:    %s (unchanged)" % current.get("account_status"))
        elif field == "pending_cents":
            lines.append("Pending:   %s -> %s%s" % (_cd.format_cents(old), _cd.format_cents(new), delta_text))
            lines.append("Earnings:  %s (unchanged)" % _cd.format_cents(current.get("earnings_total_cents")))
            lines.append("Balance:   %s (unchanged)" % _cd.format_cents(current.get("balance_cents")))
        else:
            lines.append("Balance:   %s -> %s%s" % (_cd.format_cents(old), _cd.format_cents(new), delta_text))
            lines.append("Earnings:  %s (unchanged)" % _cd.format_cents(current.get("earnings_total_cents")))
            lines.append("Pending:   %s (unchanged)" % _cd.format_cents(current.get("pending_cents")))
    lines.append(_source_line(source_note))
    lines.append(_detail_line(key))
    lines.append(_action_line())
    return "\n".join(lines)


def message_summary(day, count, source_note=None) -> str:
    return "\n".join(
        [
            "[FreeCash] %d CHANGES %s" % (count, day),
            "More than 5 distinct changes today: individual notifications suppressed.",
            _source_line(source_note),
            "Detail:    alerts.jsonl (one line per change)",
            _action_line(),
        ]
    )


def message_run_failed(day, reason, ledger) -> str:
    return "\n".join(
        [
            "[FreeCash] RUN FAILED %s" % day,
            "Reason:    %s" % reason,
            "Day lock:  CONSUMED (no automatic re-run today - R1)",
            "Attempts:  last_attempt_day=%s last_success_day=%s"
            % (ledger.get("last_attempt_day"), ledger.get("last_success_day")),
            "Detail:    alerts.jsonl dedupe=run:%s" % day,
            "ACTION:    No action taken. A second status read on the same day is not "
            "permitted by this routine (R1).",
        ]
    )


def message_missed_day(day, last_success, consecutive) -> str:
    return "\n".join(
        [
            "[FreeCash] MISSED DAY %s" % day,
            "No successful status check recorded for %s." % day,
            "Last success: %s. consecutive_missed_days=%s" % (last_success, consecutive),
            "ACTION:    No action taken. Investigate why no check ran (machine uptime, "
            "scheduler history, or a failed run).",
        ]
    )


def message_approval_pending(item) -> str:
    return "\n".join(
        [
            "[FreeCash] APPROVAL PENDING %s" % item.get("day_key"),
            "Approval id: %s" % item.get("approval_id"),
            "What changed: %s" % item.get("reason"),
            "Waiting since: %s  (no expiry - this item waits indefinitely)"
            % item.get("created_at_utc"),
            "Detail:    approvals/pending.json",
            'ACTION:    No action taken. Decide it yourself: py -3 '
            'D:/AgenticOS/monitoring/freecash/approval_queue.py decide --id %s '
            '--decision approve|reject --by "<your name>" --note "<why>"' % item.get("approval_id"),
        ]
    )
