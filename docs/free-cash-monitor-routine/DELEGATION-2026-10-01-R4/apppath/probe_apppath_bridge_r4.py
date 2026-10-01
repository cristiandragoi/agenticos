#!/usr/bin/env python
"""probe_apppath_bridge_r4.py -- Stream A (app-path bridge), DELEGATION-2026-10-01-R4.

WHAT THIS IS
    A read-only probe/bridge for PATH B -- the app-side (already-authenticated)
    FreeCash path implemented in ``server/src/services/freeCash/freeCashExecutor.ts``.
    It maps whatever authenticated account state PATH B actually persists onto the
    four-field shape the routine's source ``monitoring/freecash/operator_state.py``
    reads, and writes the candidate record ONLY to a throwaway scratch root.

RULES IT HOLDS (operator numbering, title carried with the number)
    R1 (zero automated earning actions) : GET only, loopback only, no request body,
                                          no credential, no provider login.
    R2 (exactly one status read per Europe/Berlin calendar day) : this probe NEVER
                                          imports the routine and NEVER acquires a day
                                          lock; the production day is untouched.
    R4 (human approval before any external action) : nothing is started, nothing is
                                          authenticated, nothing external is touched.

EXIT CODES
    0  a fresh authenticated session was found; a candidate operator record was
       emitted to the scratch root (a PARTIAL_READING warning is printed when the
       money fields are null, which is true for every Path-B reading today).
    2  usage error.
    3  NO_AUTHENTICATED_SESSION -- the red case. Names each reason it holds.
    4  AUTHENTICATED_SESSION_FOUND but the reading cannot be produced (unexpected
       shape / scratch write blocked).

ISOLATION
    Scratch root: ``$LOCALAPPDATA/Temp/fcr4-apppath-<pid>/``. The probe also prints
    the sha256 of the three production state files before and after itself, so a
    re-run proves it did not touch the production root.
"""

from __future__ import annotations

import datetime as _dt
import hashlib
import json
import os
import socket
import sys
import tempfile
from pathlib import Path

try:
    from zoneinfo import ZoneInfo  # 3.11.9 venv ships tzdata
except Exception:  # pragma: no cover
    ZoneInfo = None

# --------------------------------------------------------------------------- config

APPDATA = Path(os.environ.get("APPDATA", Path.home() / "AppData" / "Roaming"))
APP_PATH_DIR = APPDATA / "AgenticOS" / "data" / "freecash"
EVIDENCE_DIR = APP_PATH_DIR / "evidence"

PROD_ROOT = Path("D:/AgenticOS/data/freecash-monitor")
PROD_FILES = (
    PROD_ROOT / "state" / "last-run.json",
    PROD_ROOT / "alerts" / "alerts.jsonl",
    PROD_ROOT / "state" / "operator-state.json",
)

LOOPBACK_HOST = "127.0.0.1"
LOOPBACK_PORT = 4600
AUTH_PATH = "/api/projects/proj-free-cash/freecash/auth"
HEALTH_PATH = "/api/health"
HTTP_TIMEOUT = 5.0

#: The service's own freshness window (prerequisiteService.ts:51,148-153).
FRESH_WINDOW = _dt.timedelta(hours=24)

#: The routine's operator-state record fields (operator_state.py:58-66).
RECORD_FIELDS = (
    "day_key", "entered_at_utc", "account_status",
    "earnings_total_cents", "balance_cents", "pending_cents", "currency",
)


# --------------------------------------------------------------------------- helpers


def sha256_file(path: Path) -> str:
    try:
        h = hashlib.sha256()
        with open(path, "rb") as fh:
            for chunk in iter(lambda: fh.read(65536), b""):
                h.update(chunk)
        return h.hexdigest()
    except OSError:
        return "ABSENT"


def day_key_berlin() -> str:
    if ZoneInfo is not None:
        try:
            return _dt.datetime.now(ZoneInfo("Europe/Berlin")).strftime("%Y-%m-%d")
        except Exception:
            pass
    return _dt.datetime.now().strftime("%Y-%m-%d")


def iso_utc(now=None) -> str:
    m = now or _dt.datetime.now(_dt.timezone.utc)
    return m.astimezone(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def read_json(path: Path):
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return None


def newest(glob_pat: str):
    hits = sorted(EVIDENCE_DIR.glob(glob_pat), key=lambda p: p.stat().st_mtime, reverse=True)
    return hits[0] if hits else None


def probe_loopback_get(path: str):
    """One loopback GET, no body, no credential. Returns (status, body_text, error)."""
    raw = ("GET %s HTTP/1.1\r\nHost: %s:%d\r\nConnection: close\r\n\r\n"
           % (path, LOOPBACK_HOST, LOOPBACK_PORT)).encode("ascii")
    try:
        with socket.create_connection((LOOPBACK_HOST, LOOPBACK_PORT), timeout=HTTP_TIMEOUT) as s:
            s.sendall(raw)
            chunks = []
            while True:
                b = s.recv(65536)
                if not b:
                    break
                chunks.append(b)
            data = b"".join(chunks)
        head, _, body = data.partition(b"\r\n\r\n")
        first = head.split(b"\r\n", 1)[0].decode("latin-1")
        status = int(first.split()[1]) if len(first.split()) > 1 else 0
        return status, body.decode("utf-8", "replace"), None
    except OSError as exc:
        return 0, "", "%s: %s" % (type(exc).__name__, exc)


# --------------------------------------------------------------------------- main


def main() -> int:
    print("== probe_apppath_bridge_r4.py -- Stream A, app-path (Path B) bridge ==")
    print("run_at            : %s (Europe/Berlin day %s)" % (iso_utc(), day_key_berlin()))
    print("interpreter       : %s" % sys.version.replace("\n", " "))
    print("production root   : %s (read-only; sha256 printed below)" % PROD_ROOT)

    prod_before = {str(p): sha256_file(p) for p in PROD_FILES}
    for k, v in prod_before.items():
        print("  before %s  %s" % (v, k))

    # ---- 1. app-path artefacts on disk (the durable state that survives a restart)
    print("\n-- 1. app-path artefacts (Path B) --")
    session_evidence = APP_PATH_DIR / "session-evidence.json"
    se = read_json(session_evidence)
    if se is None:
        print("ABSENT  : %s" % session_evidence)
    else:
        mtime = _dt.datetime.fromtimestamp(session_evidence.stat().st_mtime).isoformat()
        print("PRESENT : %s  mtime=%s" % (session_evidence, mtime))
        print("          authenticated=%r verifiedAt=%r" % (se.get("authenticated"), se.get("verifiedAt")))

    newest_session = newest("session-*.json")
    newest_inspect = newest("inspect-work-*.json")
    inspect_accounts = sorted(EVIDENCE_DIR.glob("inspect-account-*.json"))
    print("newest session-*.json     : %s" % (newest_session or "NONE"))
    print("newest inspect-work-*.json: %s" % (newest_inspect or "NONE"))
    print("inspect-account-*.json    : %s" % (inspect_accounts or "NONE (inspectAccountState has never written one)"))

    artefact_state = None
    artefact_verified = None
    if isinstance(se, dict):
        artefact_state = se.get("authenticated")
        artefact_verified = se.get("verifiedAt")

    # ---- 2. live loopback read of the app-path session route (GET only)
    print("\n-- 2. live loopback GET %s%s --" % (LOOPBACK_HOST, AUTH_PATH))
    status, body, err = probe_loopback_get(AUTH_PATH)
    live_state = None
    if err:
        print("UNREACHABLE : %s" % err)
    else:
        print("HTTP %s" % status)
        if body:
            print("body: %s" % body[:400])
        try:
            live_state = json.loads(body).get("sessionState")
        except ValueError:
            live_state = None
    h_status, _, h_err = probe_loopback_get(HEALTH_PATH)
    print("health GET %s -> HTTP %s %s" % (HEALTH_PATH, h_status, ("(%s)" % h_err) if h_err else ""))

    # ---- 3. decide: is there an authenticated session?
    print("\n-- 3. session verdict --")
    reasons = []
    fresh = False
    age = None
    if artefact_verified:
        try:
            v = _dt.datetime.strptime(artefact_verified, "%Y-%m-%dT%H:%M:%S.%fZ").replace(tzinfo=_dt.timezone.utc)
        except ValueError:
            try:
                v = _dt.datetime.strptime(artefact_verified, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=_dt.timezone.utc)
            except ValueError:
                v = None
        if v is not None:
            age = _dt.datetime.now(_dt.timezone.utc) - v
            fresh = age <= FRESH_WINDOW

    if err and h_err:
        reasons.append("APP_PATH_UNREACHABLE: no listener on %s:%d (%s)" % (LOOPBACK_HOST, LOOPBACK_PORT, err))
    elif live_state is not None and str(live_state).lower() != "authenticated":
        reasons.append("LIVE_SESSION_STATE=%r (route answers, session not authenticated)" % live_state)

    if artefact_state is not True:
        reasons.append("EVIDENCE_UNAUTHENTICATED: session-evidence.json authenticated=%r" % artefact_state)
    elif not fresh:
        reasons.append(
            "EVIDENCE_STALE: session-evidence.json authenticated=true but verifiedAt=%s (age %.2f d > 24 h window)"
            % (artefact_verified, (age.total_seconds() / 86400.0) if age else -1)
        )

    if reasons:
        print("VERDICT: NO_AUTHENTICATED_SESSION")
        for r in reasons:
            print("  REASON: %s" % r)
        print("\nRED_CASE: no authenticated Path-B session -> no reading is produced.")
        _print_prod_after(prod_before)
        return 3

    print("VERDICT: AUTHENTICATED_SESSION_FOUND (live=%r fresh_evidence=%s)" % (live_state, fresh))

    # ---- 4. the four-field mapping into operator_state.py's shape
    print("\n-- 4. four-field mapping (Path B -> operator_state record) --")
    account_status = "SESSION_AUTHENTICATED"  # session-state proxy; Path B exposes no provider status vocabulary
    record = {
        "day_key": day_key_berlin(),
        "entered_at_utc": iso_utc(),
        "account_status": account_status,
        "earnings_total_cents": None,   # Path B carries no earnings figure anywhere
        "balance_cents": None,          # inspectAccountState() records only balance_text_present=<bool>
        "pending_cents": None,          # Path B carries no pending figure anywhere
        "currency": None,               # Path B carries no currency
        "source": "apppath_session_proxy",
        "bridge_note": ("account_status is a SESSION proxy, not the provider's account-status "
                        "vocabulary; the three money fields are null because Path B persists no figures."),
    }
    for f in RECORD_FIELDS:
        print("  %-22s = %r" % (f, record.get(f)))
    partial = all(record[f] is None for f in ("earnings_total_cents", "balance_cents", "pending_cents"))
    if partial:
        print("PARTIAL_READING: all three money fields are null -- Path B has no money extractor.")

    # ---- 5. emit to a throwaway scratch root ONLY
    scratch = Path(tempfile.gettempdir()) / ("fcr4-apppath-%d" % os.getpid())
    scratch.mkdir(parents=True, exist_ok=True)
    target = scratch / "candidate-operator-record.json"
    doc = {
        "schema_version": 1,
        "kind": "operator_entered_daily_status",
        "note": "STREAM A bridge candidate -- generated by probe_apppath_bridge_r4.py; scratch only.",
        "records": [record],
    }
    with open(target, "w", encoding="utf-8") as fh:
        json.dump(doc, fh, indent=2)
        fh.write("\n")
    print("\nwrote candidate operator-state doc: %s" % target)
    print("production root touched: NO (scratch=%s; prod hashes re-checked below)" % scratch)

    _print_prod_after(prod_before)
    return 0


def _print_prod_after(prod_before: dict) -> None:
    print("\n-- hermeticity (sha256 before/after) --")
    ok = True
    for p in PROD_FILES:
        after = sha256_file(p)
        same = (prod_before.get(str(p)) == after)
        ok = ok and same
        print("  %s  %s  %s" % ("SAME" if same else "CHANGED", after, p))
    print("PRODUCTION_ROOT_UNCHANGED: %s" % ("YES" if ok else "NO"))
    print("DAY_LOCK_CREATED: NO (this probe never imports the routine and never acquires a lock)")


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit(2)
