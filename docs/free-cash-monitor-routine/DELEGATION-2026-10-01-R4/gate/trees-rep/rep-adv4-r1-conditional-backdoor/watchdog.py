"""watchdog.py -- R1 second detector: the same-day "did the check run?" alarm.

The in-band detector in :mod:`gate` notices a missed day at the *next* run.
This one notices it the *same evening*, which is the point: a silently skipped
run becomes visible while the operator can still do something about it.

Hard limits, so the watchdog can never become a second run:

* it opens **no** socket (it does not import :mod:`readonly_client` at all);
* it never writes the ledger, never creates or clears a day lock, never writes a
  snapshot, never touches the approval queue;
* it never runs the status check;
* its only writes are the two append-only records of the alert mechanism itself:
  ``alerts/alerts.jsonl`` (the alarm) and ``state/notified-keys.json`` (the
  dedupe index that stops the same alarm being sent twice in one day);
* exit code is always 0.
"""

import sys

import changedetect
import gate
import notify
import paths


def evaluate(now=None, ledger=None) -> dict:
    """Read the ledger and decide whether today's check is missing."""
    ledger = ledger if ledger is not None else gate.load_ledger()
    today = gate.day_key(now)
    attempt = ledger.get("last_attempt_day")
    outcome = ledger.get("last_outcome")
    covered = attempt == today and outcome in gate.SUCCESS_OUTCOMES
    return {
        "day_key": today,
        "covered": covered,
        "last_attempt_day": attempt,
        "last_success_day": ledger.get("last_success_day"),
        "last_outcome": outcome,
        "consecutive_missed_days": gate.consecutive_missed_days(today, ledger),
        "ledger_missing": not paths.ledger_path().exists(),
    }


def check(now=None, ledger=None, sender=None) -> dict:
    """Emit at most one MISSED_DAY alarm for the current day.  Never raises."""
    if now is not None:
        paths.set_clock(now)
        try:
            return _check(now, ledger, sender)
        finally:
            paths.clear_clock()
    return _check(now, ledger, sender)


def _check(now=None, ledger=None, sender=None) -> dict:
    state = evaluate(now=now, ledger=ledger)
    if state["covered"]:
        print(
            "WATCHDOG_OK %s attempt=%s outcome=%s"
            % (state["day_key"], state["last_attempt_day"], state["last_outcome"])
        )
        state["alarm"] = False
        return state

    message = notify.message_missed_day(
        state["day_key"], state["last_success_day"] or "none recorded", state["consecutive_missed_days"]
    )
    change = {
        "change_type": "MISSED_DAY",
        "field": "last_attempt_day",
        "old_value": state["last_attempt_day"],
        "new_value": state["last_outcome"],
        "prior_day_key": state["last_success_day"],
    }
    key = changedetect.dedupe_key(
        state["day_key"], "MISSED_DAY", "last_attempt_day", state["last_attempt_day"], state["last_outcome"]
    )
    if notify.key_seen(key):
        # One MISSED_DAY alarm per day (ROUTINE-DESIGN 10.1).  notify.dispatch
        # writes the dedupe index *before* it dispatches, so a second watchdog
        # run the same evening must add nothing at all: no second alert line and
        # no second delivery.  This grants the watchdog no new capability -- it
        # still never reads the status, never writes the ledger and never locks.
        print(
            "WATCHDOG_MISSED_DAY %s last_attempt_day=%s last_outcome=%s coverage=DEDUPED"
            % (state["day_key"], state["last_attempt_day"], state["last_outcome"])
        )
        state["alarm"] = False
        state["notification"] = "DEDUPED"
        return state
    outcome = notify.notify_change(
        state["day_key"], change, message, key, sender=sender, sleep_seconds=0
    )
    print(
        "WATCHDOG_MISSED_DAY %s last_attempt_day=%s last_outcome=%s coverage=%s"
        % (state["day_key"], state["last_attempt_day"], state["last_outcome"], outcome)
    )
    state["alarm"] = outcome != "DEDUPED"
    state["notification"] = outcome
    return state


def main(argv=None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    paths.ensure_layout()
    check()
    return 0


if __name__ == "__main__":
    sys.exit(main())
