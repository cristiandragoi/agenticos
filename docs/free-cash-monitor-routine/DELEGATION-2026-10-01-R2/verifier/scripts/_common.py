"""Shared helpers for the R2 adversarial verification scripts.

Nothing here writes outside:
  * the throwaway sandbox root  ($R2_SANDBOX or %TEMP%/r2verifier), and
  * the routine's own artifact dir (logs/).
The shipped package is never imported from a copy unless a script says so.
"""

import hashlib
import json
import os
import shutil
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

REPO = Path("D:/AgenticOS")
PKG = REPO / "monitoring" / "freecash"
PROD_ROOT = REPO / "data" / "freecash-monitor"
PROD_LEDGER_SHA = "a287a902579cb468bb5bf05635fdc882e7d8071bbc9e1d71167bf6ef2a293bf9"
PROD_ALERTS_SHA = "1b9c7c07868b31cb6cc62bb6dcaa943eb5038a9c1f53ce958c9f5c02799399a8"

SBROOT = Path(os.environ.get("R2_SANDBOX") or (Path(tempfile.gettempdir()) / "r2verifier"))


# --------------------------------------------------------------------------- sandbox


def sandbox(name: str) -> Path:
    """A clean directory under the sandbox root.  Never in the repo."""
    root = SBROOT / name
    if root.exists():
        shutil.rmtree(root, ignore_errors=True)
    root.mkdir(parents=True, exist_ok=True)
    assert "AgenticOS" not in str(root) or "Temp" in str(root), root
    return root


def fresh_data_root(name: str) -> Path:
    root = sandbox(name) / "data"
    root.mkdir(parents=True, exist_ok=True)
    return root


def copy_package(dest_parent: Path, name: str = "pkg") -> Path:
    """Copy the shipped package into the sandbox so mutants never touch the repo."""
    target = Path(dest_parent) / name
    if target.exists():
        shutil.rmtree(target, ignore_errors=True)
    shutil.copytree(PKG, target, ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
    return target


def use_package(pkg=PKG) -> None:
    p = str(pkg)
    if p in sys.path:
        sys.path.remove(p)
    sys.path.insert(0, p)


def set_env(data_root, tz="Europe/Berlin", **extra) -> None:
    os.environ["FREECASH_DATA_ROOT"] = str(data_root)
    os.environ["FREECASH_TZ"] = tz
    os.environ["FREECASH_TOAST_STUB"] = "1"
    os.environ["FREECASH_TOAST_RETRY_SLEEP_SECONDS"] = "0"
    os.environ.pop("FREECASH_READ_SOURCE", None)
    os.environ.pop("FREECASH_READ_BASE_URL", None)
    os.environ["PYTHONDONTWRITEBYTECODE"] = "1"
    for k, v in extra.items():
        if v is None:
            os.environ.pop(k, None)
        else:
            os.environ[k] = str(v)


# --------------------------------------------------------------------------- files


def tree(root) -> dict:
    out = {}
    root = Path(root)
    if not root.exists():
        return out
    for p in sorted(root.rglob("*")):
        if p.is_file():
            b = p.read_bytes()
            out[str(p.relative_to(root)).replace("\\", "/")] = (len(b), hashlib.sha256(b).hexdigest())
    return out


def diff(a: dict, b: dict):
    added = sorted(k for k in b if k not in a)
    removed = sorted(k for k in a if k not in b)
    changed = sorted(k for k in a if k in b and a[k] != b[k])
    return added, removed, changed


def alerts(root) -> list:
    p = Path(root) / "alerts" / "alerts.jsonl"
    if not p.exists():
        return []
    return [json.loads(line) for line in p.read_text(encoding="utf-8").splitlines() if line.strip()]


def alert_lines(root) -> list:
    p = Path(root) / "alerts" / "alerts.jsonl"
    if not p.exists():
        return []
    return [line for line in p.read_text(encoding="utf-8").splitlines() if line.strip()]


def ledger(root) -> dict:
    p = Path(root) / "state" / "last-run.json"
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}


def pending(root) -> dict:
    p = Path(root) / "approvals" / "pending.json"
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else {"items": []}


def write_record(data_root, day, account_status="ACTIVE", earnings_total_cents=1025,
                 balance_cents=1025, pending_cents=0, currency="USD") -> dict:
    p = Path(data_root) / "state" / "operator-state.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    if p.exists():
        doc = json.loads(p.read_text(encoding="utf-8"))
    else:
        doc = {"schema_version": 1, "kind": "operator_entered_daily_status",
               "note": "", "how_to": [], "records": [], "template_record": {}}
    rec = {
        "day_key": day,
        "entered_at_utc": "%sT06:40:00Z" % day,
        "account_status": account_status,
        "earnings_total_cents": earnings_total_cents,
        "balance_cents": balance_cents,
        "pending_cents": pending_cents,
        "currency": currency,
    }
    doc["records"].append(rec)
    p.write_text(json.dumps(doc, indent=2), encoding="utf-8")
    return rec


# --------------------------------------------------------------------------- misc


class Recorder:
    """Stand-in for the toast channel; counts real deliveries."""

    delivery_label = "TOAST_OK"

    def __init__(self, fail_times=0):
        self.messages = []
        self.attempts = 0
        self.fail_times = fail_times

    def __call__(self, message):
        self.attempts += 1
        if self.attempts <= self.fail_times:
            raise RuntimeError("simulated toast failure #%d" % self.attempts)
        self.messages.append(message)


def utc(y, m, d, h=6, mi=0):
    return datetime(y, m, d, h, mi, 0, tzinfo=timezone.utc)


def line(text=""):
    print(text, flush=True)


def check(label, cond, evidence="") -> bool:
    print("%s  %s%s" % ("PASS" if cond else "FAIL", label, ("  :: " + evidence) if evidence else ""),
          flush=True)
    return bool(cond)


def header(title):
    line("=" * 96)
    line(title)
    line("=" * 96)
