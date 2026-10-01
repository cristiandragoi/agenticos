#!/usr/bin/env python3
"""Free Cash Daily Monitor — Rule Enforcement (4 rules)."""

import json, sys
from datetime import datetime, timezone
from pathlib import Path

BASE = Path(__file__).resolve().parents[2]
DATA_DIR = BASE / "data" / "freecash"
STATE_FILE = DATA_DIR / "state.json"
LOG_FILE = (DATA_DIR / f"{datetime.now(timezone.utc).strftime('%Y%m%d')}.log").resolve()


def fetch_status() -> dict:
    return {"balance": 0, "available_to_withdraw": 0, "pending_surveys": []}


def prepare_actions(status) -> list:
    if status.get("available_to_withdraw"):
        return [{"name": f"Withdraw ${status['available_to_withdraw']:.2f}", "type": "withdraw", "amount": status["available_to_withdraw"]}]
    return []


def prompt_approve(actions):
    if not actions:
        return []
    print("\nAvailable actions:")
    for i, a in enumerate(actions, 1):
        print(f"  [{i}] {a['name']}")
    approved = []
    for i, action in enumerate(actions, 1):
        while True:
            resp = input(f"\nApprove #{i} [{action['name']}]? y/n/e → ").strip().lower()
            if resp == "y":
                approved.append(action)
                break
            elif resp == "n":
                print("  Declined.")
                break
            elif resp in ("e",):
                print("  Exiting.")
                if approved:
                    return approved
                else:
                    return []
    return approved


def run_action(action):
    success = True
    msg = f"Executed {action['name']}."
    return True, success, msg


def log_entry(balance, actions):
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    line = json.dumps({"ts": datetime.now(timezone.utc).isoformat(), "balance": balance, "actions": actions})
    with open(LOG_FILE, "a") as f:
        f.write(line + "\n")


def save_today(balance):
    state = {"today": datetime.now(timezone.utc).strftime("%Y-%m-%d"), "balance": balance}
    STATE_FILE.write_text(json.dumps(state))


def main() -> int:
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    if STATE_FILE.exists():
        st = json.loads(STATE_FILE.read_text())
        if st.get("today") == today:
            print(f"{today}: Already checked.")
            return 0

    try:
        status = fetch_status()
        actions = prepare_actions(status)
        if not actions:
            print("No actions available.")
            save_today(status["balance"])
            return 0

        approved = prompt_approve(actions)
        executions = []
        for a in approved:
            ok, success, msg = run_action(a)
            executions.append({"name": a["name"], "success": success})
        log_entry(status["balance"], executions)
        save_today(status["balance"])
        print("Daily check done.")
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())