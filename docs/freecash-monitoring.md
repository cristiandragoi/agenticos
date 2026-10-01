# Free Cash Monitoring Workflow Guide

## Overview

This routine monitors your Free Cash Finance Automation account once per day, logging balances and awaiting human approval before submitting any withdrawal or survey completions. Automated earning actions are never triggered by the script.

## 4 Operational Rules (NON-NEGOTIABLE)

1. **Check Once Per Day** — The cron job only fires daily; after a check completes, no further polls occur until the next day's scheduled window.
2. **No Auto Earning Actions** — The script can fetch lists of available tasks/surveys but will NEVER auto-submit earners or complete actions without human approval.
3. **Human Approval Required** — Every potential action (withdrawal, survey) appears in the summary with an explicit prompt: `echo "Approve <action>? (y/n)"`. Script halts and logs reason on 'n'.
4. **Balance Logging** — Each run records timestamp, balance, previous balance, change amount, actions attempted, approvals given into `data/freecash/daily.log`. Zero-change runs still log to confirm no drift occurred.

## Workflow Steps

### 01: Daily Trigger (Cron)

```bash
# Runs daily at 05:05 UTC (adjust time as needed)
0 5 * * * /path/to/make_freecash_check.py >> /path/to/logs/freecashioc.txt 2>&l
```

The script first checks if today's check was done; if yes → exit immediately.

### 02: Read Status (Read-Only)

Call `fetch_freecash_status()` to retrieve current balance, available-to-withdraw amount, pending survey list. This call uses HEAD/GET only — never POSTs that auto-submit tasks.

### 03: Prepare Action List

From status data, build a structured list like:

```python
[
    {"name": "Transfer $10 to BankOfAccount", "type": "withdraw", "amount": 10},
    {"name": "Complete survey A-42 (est. $5)", "type": "survey", "id": "A-42"},
]
```

### 04: Log Current State (Balance Rule)

Append entry to `data/freecash/YYYYMMDD.log`:

```jsonline
{"ts":"2026-09-12T05:07:42Z","prev_balance":0.00,"current_balance":10.25,"change":"+10.25"}
```

### 05: Human Approval Gate

Display a text-based summary with each action listed and a single prompt per line:

```
=== Free Cash Status ===
Balance: $10.25 (prev: $0.00, change: +$10.25)

Available actions to consider:
  [W] Withdraw $10.00 to Checking Account ****1234
  [S] Complete survey ID=SUR-992 (estimated reward: $5.00)

Approve W with 'y' or 'n'? y
```

On `n`: log reason string, halt without executing. Only approved actions bubble to step 06.

### 06: Execute Single Actions One-at-a-Time

Batching is strictly prohibited. For each approval granted:

1. Call single-action API endpoint (POST withdraw or POST survey-submit)
2. Log result immediately: success/failure + message
3. Loop to next approved action if exists
4. Halt after last approval regardless of success/failure count

### 07: Finalize & Mark Complete

Write `{complete: true, reason: "all actions handled"} ` to close the day's log file. Set flag in a small state database so tomorrow's cron check finds today already handled and exits early.

---

## Test Checklist (Validate Each Component)

**Read-Only Safety**
- [ ] `fetch_freecash_status()` never posts to earn endpoints
- [ ] Network capture shows only GET/HEAD requests during status phase

**Approval Gate Enforcement**
- [ ] Script prompts for approval with clear `[W]` and `[S]` labels
- [ ] Typing `n` at any prompt logs reason like "Declined withdrawal SUR-992" and skips action
- [ ] Declining all actions exits cleanly with status code 0

**Action Execution**
- [ ] Approved withdrawals POST to `/withdraw` endpoint only
- [ ] Approved surveys POST to `/survey/complete<id>` endpoint exactly once per approval
- [ ] No re-submit loops on transient failures; script halts if an action fails after second attempt

**Balance Logging**
- [ ] Log line includes previous balance (to show delta) and change amount with +/- sign
- [ ] Empty approvals still log `{actions_taken: [], complete: true}`
- [ ] Directory `data/freecash/` contains exactly one `.log` per UTC date, named YYYYMMDD.log

**Cron Guardrails**
- [ ] Second invocation same-day returns early with message "Daily check already completed for {date}"
- [ ] Cron time offset adjustment (e.g., change 05:05→12:00) requires no code changes

---

## Quickstart Commands

```bash
# Clone repo or use existing path
cd /path/to/AgenticOS/scripts

# First-time run (requires you to approve any available actions in CLI)
python make_freecash_check.py

# View today's log
tail data/freecash/daily.log

# Adjust cron file location
# Edit D:\AgenticOS\config\frecash-crontab
```

---

## Related Docs

- `docs/monitoring-best-practices.md` — General monitoring patterns  
- `scripts/make_freecash_check.py` — Main Python implementation  
- `data/freecash/daily.log` — Current log file location  
