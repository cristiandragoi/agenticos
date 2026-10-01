#!/usr/bin/env bash
# rule-gate-harness.sh -- EXECUTABLE RULE-ENFORCEMENT / ACCEPTANCE GATE for the
# Free Cash daily status-monitoring routine (rules R1-R4).
#
#   bash docs/free-cash-monitor-routine/DELEGATION-2026-09-20-R2/rule-gate-harness.sh
#
# What it does, in order
#   1. copies monitoring/freecash to a THROWAWAY tree under $LOCALAPPDATA/Temp and
#      drives the REAL entry point (run_daily_check.py) plus the real modules from
#      that copy, with FREECASH_DATA_ROOT pointed at throwaway state roots;
#   2. INJECTS one deliberately violating input per rule and requires the routine to
#      REFUSE it (refusal assertion / non-zero exit).  A gate that has never been
#      observed refusing a violation certifies nothing;
#   3. runs a MUTATION SELF-TEST: for each rule it weakens one mechanism in the
#      throwaway copy and requires THIS HARNESS to report FAIL.  If the harness still
#      reports PASS on a weakened mechanism, the harness itself is vacuous and exits 2;
#   4. re-verifies the carried evidence: the offline suite (tests/run_all.py, run
#      against the real repo) and both R2 static scanners on the real tree;
#   5. audits the legacy verifier server/scripts/verify-freecash-rules.mjs and shows
#      why its PASS is not evidence;
#   6. digest-hashes the WHOLE production state tree data/freecash-monitor before and
#      after and fails (exit 4) if a single byte changed.
#
# Guarantees
#   * NO network egress of any kind: every network-shaped control runs against a
#     patched in-process transport; no socket is opened and no host is contacted.
#   * NO file under the repository is created, modified or deleted (the repo is read
#     and hashed only).  PYTHONDONTWRITEBYTECODE=1 for every child process.
#   * No secret is read and no credential is used.
#   * The only artifacts are inside the temp root, which is announced and retained
#     (delete it yourself, or pass --clean).
#
# Exit codes
#   0  every rule refused its injected violation AND every forbidden mutation was detected
#   1  a rule ACCEPTED its injected violation (gate failure -- rule named on stdout)
#   2  a mutation was NOT detected (the harness is vacuous -- rule named on stdout)
#   3  environment/setup failure (no python, missing routine, unappliable mutation)
#   4  the production state tree changed: the harness is not isolated
#
# Options
#   --only R1[,R2..]   run only these rules' sections (and only their mutants)
#   --no-mutants       skip the mutation self-test
#   --clean            delete the temp root at the end (default: retain + announce)
#   --quiet-prepare    suppress the per-file copy-fidelity lines

set -uo pipefail

REPO_DEFAULT="D:/AgenticOS"
ROOT="${FREECASH_REPO_ROOT:-$REPO_DEFAULT}"
ROOT="${ROOT//\\//}"
SRC_PKG="$ROOT/monitoring/freecash"

TMPBASE="${LOCALAPPDATA:-$HOME/AppData/Local}"
TMPBASE="${TMPBASE//\\//}"
TMPROOT="${FREECASH_GATE_TMP:-$TMPBASE/Temp/freecash-rule-gate}"
PKG="$TMPROOT/pkg"
HELPER="$TMPROOT/rule_gate_checks.py"
PROD_ROOT="$ROOT/data/freecash-monitor"

ONLY=""
RUN_MUTANTS=1
CLEAN=0
QUIET_PREPARE=0

while [ $# -gt 0 ]; do
  case "$1" in
    --only) ONLY="${2:-}"; shift 2 ;;
    --no-mutants) RUN_MUTANTS=0; shift ;;
    --clean) CLEAN=1; shift ;;
    --quiet-prepare) QUIET_PREPARE=1; shift ;;
    -h|--help) sed -n '2,40p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 3 ;;
  esac
done

PY="${FREECASH_PYTHON:-python}"
if ! command -v "$PY" >/dev/null 2>&1; then
  echo "[FATAL] python not found on PATH (python3 does not exist on this host; use FREECASH_PYTHON to point at one)" >&2
  exit 3
fi
if [ ! -d "$SRC_PKG" ]; then
  echo "[FATAL] routine not found: $SRC_PKG" >&2
  exit 3
fi

declare -A R_STATUS R_CONTROLS R_REFUSED R_ACCEPTED R_NOTE
for r in R1 R2 R3 R4; do R_STATUS[$r]="not-run"; R_CONTROLS[$r]=0; R_REFUSED[$r]=0; R_ACCEPTED[$r]=0; R_NOTE[$r]="-"; done
MUT_TOTAL=0
MUT_DETECTED=0
MUT_VACUOUS=""
ISOLATION_FAIL=0

# --- production state digest (whole tree, so a stray snapshot/alert line fails it) ---
prod_digest() {
  if [ ! -d "$PROD_ROOT" ]; then printf 'ABSENT'; return; fi
  ( cd "$PROD_ROOT" && find . -type f | LC_ALL=C sort | xargs -r sha256sum ) 2>/dev/null | sha256sum | awk '{print $1}'
}
prod_show() {
  if [ ! -d "$PROD_ROOT" ]; then echo "  (production state tree ABSENT: $PROD_ROOT)"; return; fi
  ( cd "$PROD_ROOT" && find . -type f | LC_ALL=C sort | xargs -r sha256sum ) 2>/dev/null | sed 's/^/  /'
}

# --- setup -------------------------------------------------------------------
rm -rf "$TMPROOT"
mkdir -p "$TMPROOT"

cat > "$HELPER" <<'PYEOF'
"""rule_gate_checks.py -- section checks for rule-gate-harness.sh (R1-R4).

Written into the harness temp root and run against a throwaway copy of
monitoring/freecash.  Nothing here writes to the repository: the copy lives under
the temp root and every state root is a subdirectory of the temp root.

Section exit codes:  0 = every injected violation REFUSED (rule holds)
                     1 = at least one injected violation ACCEPTED (rule broken)
                     3 = setup error
"""

import argparse
import ast
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

DAY = "2026-09-20"          # injected operator-local day (FREECASH_TZ=UTC makes it exact)
NOW = "2026-09-20T12:00:00+00:00"

METRICS = {
    "account_status": "ACTIVE",
    "earnings_total_cents": 1340,
    "balance_cents": 1340,
    "pending_cents": 0,
    "currency": "USD",
}

ROUTINE_MODULES = (
    "run_daily_check", "gate", "changedetect", "notify", "approval_queue",
    "operator_state", "paths", "watchdog", "readonly_client", "verify_readonly",
)

NET_MODULES = ("socket", "urllib", "http", "requests", "httpx", "aiohttp", "ftplib", "telnetlib")

#: One weakened mechanism per rule: name -> (rule, file, exact_old, exact_new).
MUTANTS = {
    "R1.lock-always-acquired": (
        "R1", "gate.py",
        "    except FileExistsError:\n        return False, lock",
        "    except FileExistsError:\n        return True, lock",
    ),
    "R2.method-allowlist-off": (
        "R2", "readonly_client.py",
        "    if verb not in ALLOWED_METHODS:",
        "    if False and verb not in ALLOWED_METHODS:",
    ),
    "R2.path-allowlist-off": (
        "R2", "readonly_client.py",
        "    if not any(pattern.match(path) for pattern in ALLOWED_PATHS):",
        "    if False and not any(pattern.match(path) for pattern in ALLOWED_PATHS):",
    ),
    "R2.host-allowlist-off": (
        "R2", "readonly_client.py",
        "    if host not in ALLOWED_HOSTS:",
        "    if False and host not in ALLOWED_HOSTS:",
    ),
    "R3.dedupe-off": ("R3", "notify.py", "    if key_seen(dedupe_key):", "    if False:"),
    "R4.human-guard-off": (
        "R4", "approval_queue.py",
        "    if who.lower() in NON_HUMAN_DECIDERS:",
        "    if False:",
    ),
    "R4.execution-state-armed": (
        "R4", "approval_queue.py",
        'EXECUTION_STATE_NOT_EXECUTED = "NOT_EXECUTED"',
        'EXECUTION_STATE_NOT_EXECUTED = "EXECUTED"',
    ),
    "R4.expiry-armed": (
        "R4", "approval_queue.py",
        "NO_EXPIRY = None",
        'NO_EXPIRY = "2099-01-01T00:00:00Z"',
    ),
}

VIOLATION_SOURCE = '''\
"""Injected R2 violation: an earning/write action inside a "read-only" routine."""


def cash_out_everything(session):
    return session.post("https://api.freecash.example/v1/cashout", json={"amount_cents": 99999})


def claim_offer(session, offer_id):
    return session.request("POST", "/offers/%s/claim" % offer_id)
'''

DRIVER = '''\
import json
import os
import sys

sys.path.insert(0, os.environ["FREECASH_PKG"])
from datetime import datetime  # noqa: E402

import run_daily_check  # noqa: E402

now = datetime.fromisoformat(os.environ["FREECASH_NOW"])
extra = json.loads(os.environ.get("FREECASH_EXTRA_ARGS") or "[]")
sys.exit(run_daily_check.run(extra, now=now))
'''


# --------------------------------------------------------------------------- util


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def seed_operator_state(data_root, days):
    """Write one operator-entered record per day so the routine has a real reading."""
    path = Path(data_root) / "state" / "operator-state.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    doc = {
        "schema_version": 1,
        "kind": "operator_entered_daily_status",
        "note": "gate-harness throwaway state; no real account data",
        "how_to": [],
        "records": [],
        "template_record": {},
    }
    for index, day in enumerate(days):
        doc["records"].append({
            "day_key": day,
            "entered_at_utc": "%sT06:40:00Z" % day,
            "account_status": "ACTIVE",
            "earnings_total_cents": 1340 + index,
            "balance_cents": 1340 + index,
            "pending_cents": 0,
            "currency": "USD",
        })
    path.write_text(json.dumps(doc, indent=2), encoding="utf-8")


def child_env(pkg, data_root, extra=None):
    env = dict(os.environ)
    env.update({
        "FREECASH_PKG": str(pkg),
        "FREECASH_DATA_ROOT": str(data_root),
        "FREECASH_TZ": "UTC",
        "FREECASH_TOAST_STUB": "1",
        "FREECASH_TOAST_RETRY_SLEEP_SECONDS": "0",
        "FREECASH_NOW": NOW,
        "FREECASH_EXTRA_ARGS": "[]",
        "PYTHONPATH": str(pkg),
        "PYTHONDONTWRITEBYTECODE": "1",
    })
    env.update(extra or {})
    return env


def run_driver(pkg, tmp, data_root, extra_args=None):
    env = child_env(pkg, data_root)
    if extra_args is not None:
        env["FREECASH_EXTRA_ARGS"] = json.dumps(extra_args)
    return subprocess.run(
        [sys.executable, str(Path(tmp) / "run_once.py")],
        env=env, capture_output=True, text=True, cwd=str(tmp), timeout=300,
    )


class Report:
    """Per-rule evidence recorder.  Every control is a violation that must be refused."""

    def __init__(self, rule):
        self.rule = rule
        self.controls = 0
        self.refused = 0
        self.accepted = 0
        self.errors = 0
        self.baseline_ok = True

    def base(self, cid, label, observed, ok=True):
        print("[BASE %s] %s: %s" % (cid, label, observed))
        if not ok:
            self.errors += 1
            self.baseline_ok = False
            print("[BASE %s] PREMISE-FAILED the rule cannot be evaluated from this run" % cid)

    def info(self, cid, label, observed):
        print("[INFO %s] %s: %s" % (cid, label, observed))

    def ctrl(self, cid, inject):
        self.controls += 1
        print("[CTRL %s] INJECT %s" % (cid, inject))

    def obs(self, cid, observed):
        print("[CTRL %s] OBSERVED %s" % (cid, observed))

    def verdict(self, cid, ok, detail, ok_label="REFUSED_OK", fail_label="ACCEPTED_VIOLATION"):
        if ok:
            self.refused += 1
            print("[CTRL %s] VERDICT %s %s" % (cid, ok_label, detail))
        else:
            self.accepted += 1
            print("[CTRL %s] VERDICT %s %s" % (cid, fail_label, detail))

    def finish(self):
        bad = self.accepted + self.errors
        status = "PASS" if bad == 0 else "FAIL"
        print("[SECTION %s] %s controls=%d refused=%d accepted_violations=%d errors=%d"
              % (self.rule, status, self.controls, self.refused, self.accepted, self.errors))
        return 1 if bad else 0


# --------------------------------------------------------------------------- prepare


def cmd_prepare(a):
    src = Path(a.src)
    pkg = Path(a.pkg)
    if pkg.exists():
        shutil.rmtree(pkg)
    shutil.copytree(src, pkg, ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
    (Path(a.tmp) / "run_once.py").write_text(DRIVER, encoding="utf-8")
    print("[PREPARE] source=%s" % src)
    print("[PREPARE] copy=%s  py_files=%d  driver=%s" % (pkg, len(list(pkg.rglob("*.py"))), Path(a.tmp) / "run_once.py"))
    for name in ("run_daily_check.py", "gate.py", "changedetect.py", "notify.py",
                 "approval_queue.py", "readonly_client.py", "paths.py",
                 "operator_state.py", "watchdog.py", "verify_readonly.py"):
        real, copy = sha256_file(src / name), sha256_file(pkg / name)
        print("[PREPARE] copy-fidelity %-20s identical=%s sha256=%s" % (name, real == copy, copy[:16]))
    return 0


def cmd_mutate(a):
    rule, fname, old, new = MUTANTS[a.mutant]
    path = Path(a.pkg) / fname
    text = path.read_text(encoding="utf-8")
    occurrences = text.count(old)
    if occurrences != 1:
        print("[MUTANT %s] ERROR anchor occurs %d times in %s (expected exactly 1) -- mutation NOT applied"
              % (a.mutant, occurrences, fname))
        return 3
    path.write_text(text.replace(old, new), encoding="utf-8")
    print("[MUTANT %s] APPLIED %s: %r -> %r" % (a.mutant, fname, old.strip()[:60], new.strip()[:60]))
    return 0


def cmd_list_mutants(a):
    for name in MUTANTS:
        print(name)
    return 0


# --------------------------------------------------------------------------- R1


def cmd_r1(a):
    rep = Report("R1")
    pkg, tmp = Path(a.pkg), Path(a.tmp)

    data = tmp / "data-r1"
    seed_operator_state(data, [DAY])
    lock = data / "state" / "day-locks" / (DAY + ".lock")
    ledger = data / "state" / "last-run.json"
    snaps = lambda root: sorted(p.name for p in (root / "snapshots").glob("*.json"))

    first = run_driver(pkg, tmp, data)
    out1 = (first.stdout or "").strip()
    rep.base("R1.0", "first status read of operator-local day %s (NOT a violation)" % DAY,
             'exit=%d stdout="%s" lock_exists=%s snapshots=%s'
             % (first.returncode, out1, lock.exists(), snaps(data)),
             ok=(first.returncode == 0 and "RUN_OK" in out1 and lock.exists() and len(snaps(data)) == 1))
    if not rep.baseline_ok:
        print("[SECTION R1] FAIL premise failed; refusals cannot be evaluated")
        return 1

    lock_sha, ledger_sha = sha256_file(lock), sha256_file(ledger)

    # --- R1.1 duplicate same-day run -------------------------------------------------
    rep.ctrl("R1.1", "a SECOND status read on the same operator-local day %s (duplicate run)" % DAY)
    second = run_driver(pkg, tmp, data)
    out2 = (second.stdout or "").strip()
    lock_sha2, ledger_sha2 = sha256_file(lock), sha256_file(ledger)
    rep.obs("R1.1", 'exit=%d stdout="%s"' % (second.returncode, out2))
    rep.obs("R1.1", "snapshots=%s lock_sha256_unchanged=%s ledger_sha256_unchanged=%s"
            % (snaps(data), lock_sha2 == lock_sha, ledger_sha2 == ledger_sha))
    rep.verdict(
        "R1.1",
        ("SKIP_DUPLICATE_DAY" in out2) and len(snaps(data)) == 1
        and lock_sha2 == lock_sha and ledger_sha2 == ledger_sha,
        'assertion: stdout contains "SKIP_DUPLICATE_DAY %s" AND snapshots==1 AND day-lock and ledger byte-identical '
        '(exit 0 is by design: a duplicate is not an error)' % DAY,
    )

    # --- R1.2 concurrency ------------------------------------------------------------
    rep.ctrl("R1.2", "5 concurrent invocations racing on the same day (O_CREAT|O_EXCL lock)")
    data2 = tmp / "data-r1b"
    seed_operator_state(data2, [DAY])
    env2 = child_env(pkg, data2)
    procs = [
        subprocess.Popen([sys.executable, str(tmp / "run_once.py")], env=env2,
                         stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, cwd=str(tmp))
        for _ in range(5)
    ]
    outs = []
    for proc in procs:
        stdout, _stderr = proc.communicate(timeout=300)
        outs.append((stdout or "").strip())
    winners = sum(1 for o in outs if "RUN_OK" in o)
    skips = sum(1 for o in outs if "SKIP_DUPLICATE_DAY" in o)
    locks2 = sorted(p.name for p in (data2 / "state" / "day-locks").glob("*.lock"))
    rep.obs("R1.2", "outcomes: RUN_OK=%d SKIP_DUPLICATE_DAY=%d snapshots=%s locks=%s"
            % (winners, skips, snaps(data2), locks2))
    rep.verdict("R1.2", winners == 1 and skips == 4 and len(snaps(data2)) == 1 and len(locks2) == 1,
                "assertion: exactly 1 winner, 4 refusals, 1 snapshot, 1 lock file")

    # --- R1.3 --force-recheck --------------------------------------------------------
    rep.ctrl("R1.3", "--force-recheck (an explicit request for a second same-day status read)")
    third = run_driver(pkg, tmp, data, extra_args=["--force-recheck", "--reason", "gate-harness negative control"])
    out3 = (third.stdout or "").strip()
    rep.obs("R1.3", 'exit=%d stdout="%s"' % (third.returncode, out3))
    rep.verdict("R1.3", third.returncode == 3 and "REFUSED_FORCE_RECHECK" in out3,
                "assertion: exit==3 AND stdout contains REFUSED_FORCE_RECHECK")

    # --- R1.4 mechanism attribution + honest residual risk ---------------------------
    data4 = tmp / "data-r1d"
    seed_operator_state(data4, [DAY])
    os.environ["FREECASH_DATA_ROOT"] = str(data4)
    os.environ["FREECASH_TZ"] = "UTC"
    sys.path.insert(0, str(pkg))
    import run_daily_check  # noqa: E402

    calls = []

    def fake_transport(method, url, timeout=None, headers=None):
        calls.append((method, url))
        if method == "HEAD":
            return {"method": method, "url": url, "status": 200, "reason": "OK", "headers": {}, "body": b""}
        return {"method": method, "url": url, "status": 200, "reason": "OK", "headers": {},
                "body": json.dumps(METRICS).encode("utf-8")}

    moment = datetime.fromisoformat(NOW)
    rc1 = run_daily_check.run(["--source", "metrics_http"], now=moment, transport=fake_transport)
    reads1 = len(calls)
    (data4 / "state" / "day-locks" / (DAY + ".lock")).unlink()
    rc2 = run_daily_check.run(["--source", "metrics_http"], now=moment, transport=fake_transport)
    reads2 = len(calls) - reads1
    rep.info("R1.4", "MECHANISM-ATTRIBUTION",
             "the day-lock FILE is the gate: with the lock present, run1 exit=%d issued %d status reads "
             "(GET/HEAD pair); after deleting only state/day-locks/%s.lock in the throwaway root, run2 "
             "exit=%d issued %d MORE status reads for the same day. No OS-level immutability, ACL or "
             "signature protects the lock." % (rc1, reads1, DAY, rc2, reads2))
    return rep.finish()


# --------------------------------------------------------------------------- R2


def socket_sites(pkg):
    importers = {}
    for name in ROUTINE_MODULES:
        path = pkg / (name + ".py")
        if not path.exists():
            importers[name] = ["<missing>"]
            continue
        hits = []
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    if alias.name.split(".")[0] in NET_MODULES:
                        hits.append(alias.name)
            elif isinstance(node, ast.ImportFrom):
                if (node.module or "").split(".")[0] in NET_MODULES:
                    hits.append(node.module)
        importers[name] = hits
    return importers


def cmd_r2(a):
    rep = Report("R2")
    repo, pkg, tmp = Path(a.repo), Path(a.pkg), Path(a.tmp)
    env_nb = dict(os.environ)
    env_nb["PYTHONDONTWRITEBYTECODE"] = "1"
    py_scanner = repo / "monitoring" / "freecash" / "verify_readonly.py"
    sh_scanner = repo / "docs" / "free-cash-monitor-routine" / "verify-readonly.sh"

    # --- R2.0 the shipped static scanners on the real tree ---------------------------
    py0 = subprocess.run([sys.executable, str(py_scanner)], capture_output=True, text=True,
                         cwd=str(repo), env=env_nb)
    sh0 = subprocess.run(["bash", str(sh_scanner), "monitoring/freecash"], capture_output=True,
                         text=True, cwd=str(repo), env=env_nb)
    py_line = [l for l in (py0.stdout or "").splitlines() if "forbidden=" in l]
    sh_line = [l for l in (sh0.stdout or "").splitlines() if "forbidden=" in l]
    rep.base("R2.0", "shipped R2 static scanners on the real tree monitoring/freecash",
             'verify_readonly.py exit=%d %s | verify-readonly.sh exit=%d %s'
             % (py0.returncode, py_line[-1] if py_line else "(none)",
                sh0.returncode, sh_line[-1] if sh_line else "(none)"),
             ok=(py0.returncode == 0 and sh0.returncode == 0
                 and any("forbidden=0" in l for l in py_line) and any("forbidden=0" in l for l in sh_line)))

    # --- R2.1 / R2.2 injected violating file, scanned by both scanners ----------------
    vdir = tmp / "r2-violation"
    vdir.mkdir(parents=True, exist_ok=True)
    (vdir / "cashout.py").write_text(VIOLATION_SOURCE, encoding="utf-8")
    py1 = subprocess.run([sys.executable, str(py_scanner), str(vdir)], capture_output=True,
                         text=True, cwd=str(repo), env=env_nb)
    sh1 = subprocess.run(["bash", str(sh_scanner), str(vdir)], capture_output=True,
                         text=True, cwd=str(repo), env=env_nb)
    py_find = [l.strip() for l in (py1.stderr or "").splitlines() if "FORBIDDEN" in l][:2]
    sh_find = [l.strip() for l in (sh1.stderr or "").splitlines() if "FORBIDDEN" in l][:2]
    rep.ctrl("R2.1", "a source file containing an earning action (session.post .../v1/cashout, POST /offers/<id>/claim) seeded into a scanned tree")
    rep.obs("R2.1", "verify_readonly.py exit=%d findings=%r" % (py1.returncode, py_find))
    rep.verdict("R2.1", py1.returncode == 1 and "forbidden=0" not in (py1.stdout or ""),
                "assertion: the Python scanner exits 1 and prints FORBIDDEN lines (a scanner that scans nothing cannot pass)")
    rep.ctrl("R2.2", "the same violating file scanned by the shipped shell checker")
    rep.obs("R2.2", "verify-readonly.sh exit=%d findings=%r" % (sh1.returncode, sh_find))
    rep.verdict("R2.2", sh1.returncode == 1, "assertion: the shell checker exits 1 on the injected violation")

    # --- R2.3..R2.9 the single socket site refuses writes before any network write ----
    os.environ["FREECASH_DATA_ROOT"] = str(tmp / "data-r2")
    sys.path.insert(0, str(pkg))
    import readonly_client as rc  # noqa: E402

    calls = []

    def fake_transport(method, url, timeout=None, headers=None):
        calls.append((method, url))
        if method == "HEAD":
            return {"method": method, "url": url, "status": 200, "reason": "OK", "headers": {}, "body": b""}
        return {"method": method, "url": url, "status": 200, "reason": "OK", "headers": {},
                "body": json.dumps(METRICS).encode("utf-8")}

    base = "http://localhost:3001"
    probes = [
        ("R2.3", "POST %s/api/v1/status/metrics (a write verb, no body)" % base,
         lambda: rc.request("POST", base + "/api/v1/status/metrics", transport=fake_transport)),
        ("R2.4", 'POST %s/api/v1/cashout with an earnings payload json={"amount_cents": 99999}' % base,
         lambda: rc.request("POST", base + "/api/v1/cashout", transport=fake_transport,
                            json={"amount_cents": 99999})),
        ("R2.5", "PUT %s/api/v1/status" % base,
         lambda: rc.request("PUT", base + "/api/v1/status", transport=fake_transport)),
        ("R2.6", "DELETE %s/api/v1/status" % base,
         lambda: rc.request("DELETE", base + "/api/v1/status", transport=fake_transport)),
        ("R2.7", "GET %s/api/v1/cashout (write-endpoint path reached with a read verb)" % base,
         lambda: rc.request("GET", base + "/api/v1/cashout", transport=fake_transport)),
        ("R2.8", "GET with a request body (data=b" + repr(b"amount_cents=99999") + ")",
         lambda: rc.request("GET", base + "/api/v1/status/metrics", transport=fake_transport,
                            data=b"amount_cents=99999")),
        ("R2.9", "GET an allowlisted PATH on a NON-allowlisted provider host http://api.freecash.example:3001/api/v1/status/metrics",
         lambda: rc.request("GET", "http://api.freecash.example:3001/api/v1/status/metrics", transport=fake_transport)),
    ]
    for cid, label, fn in probes:
        rep.ctrl(cid, label)
        before = len(calls)
        refused = False
        try:
            result = fn()
            rep.obs(cid, "NOT REFUSED -- the request reached the transport: %r" % (result,))
        except rc.ForbiddenWriteError as exc:
            refused = True
            rep.obs(cid, "REFUSED before any socket write: ForbiddenWriteError: %s" % exc)
        except Exception as exc:  # noqa: BLE001
            rep.obs(cid, "refused with a different exception: %s: %s" % (type(exc).__name__, exc))
        attempted = len(calls) - before
        rep.obs(cid, "transport_calls_delta=%d" % attempted)
        rep.verdict(cid, refused and attempted == 0,
                    "assertion: ForbiddenWriteError raised AND the single socket site was never reached")

    # --- R2.10 non-vacuity: the allowlisted read must still work ----------------------
    ok_read = False
    try:
        allowed = rc.request("GET", base + "/api/v1/status/metrics", transport=fake_transport)
        ok_read = int(allowed["status"]) == 200
    except Exception as exc:  # noqa: BLE001
        allowed = "%s: %s" % (type(exc).__name__, exc)
    rep.base("R2.10", "NON-VACUITY allowlisted read",
             "GET %s/api/v1/status/metrics -> %r ; transport_calls_total=%d (exactly the one allowlisted read)"
             % (base, allowed if not ok_read else "HTTP 200", len(calls)),
             ok=(ok_read and len(calls) == 1 and calls[0][0] == "GET"))

    # --- R2.11 static: one socket site, one network-capable import --------------------
    imp = socket_sites(pkg)
    offenders = sorted(name for name, hits in imp.items() if hits and name != "readonly_client")
    request_sites = (pkg / "readonly_client.py").read_text(encoding="utf-8").count("conn.request(")
    rep.base("R2.11", "static: network-capable imports and the single socket site",
             "imports=%s ; non-readonly_client offenders=%s ; 'conn.request(' in readonly_client.py=%d"
             % (json.dumps(imp), offenders or "none", request_sites),
             ok=(not offenders and request_sites == 1))
    return rep.finish()


# --------------------------------------------------------------------------- R3


def _snap(day, status="ACTIVE", earn=1340, bal=1340, pend=0, currency="USD", available=True):
    return {
        "day_key": day, "currency": currency, "account_status": status,
        "earnings_total_cents": earn, "balance_cents": bal, "pending_cents": pend,
        "source": {"data_available": available},
    }


class RecordingSender:
    delivery_label = "TOAST_OK"

    def __init__(self):
        self.sent = []
        self.attempts = 0

    def __call__(self, message):
        self.attempts += 1
        self.sent.append(message)


class FailingSender:
    delivery_label = "TOAST_OK"

    def __init__(self):
        self.attempts = 0

    def __call__(self, message):
        self.attempts += 1
        raise RuntimeError("simulated toast failure")


def cmd_r3(a):
    rep = Report("R3")
    pkg, tmp = Path(a.pkg), Path(a.tmp)
    os.environ["FREECASH_DATA_ROOT"] = str(tmp / "data-r3")
    os.environ["FREECASH_TZ"] = "UTC"
    sys.path.insert(0, str(pkg))
    import changedetect as cd  # noqa: E402
    import notify  # noqa: E402

    verdict = cd.compare(_snap("2026-09-19", earn=1340, bal=1340),
                         _snap(DAY, earn=1500, bal=1500))
    rep.base("R3.0", "baseline comparison: earnings 1340 -> 1500 with the balance dragged along",
             "changes=%d %s" % (len(verdict["changes"]),
                                [(c["change_type"], c["field"]) for c in verdict["changes"]]),
             ok=(len(verdict["changes"]) == 1
                 and verdict["changes"][0]["change_type"] == "EARNINGS_CHANGED"))
    if not rep.baseline_ok:
        print("[SECTION R3] FAIL premise failed; refusals cannot be evaluated")
        return 1

    # --- R3.1 exactness: a one-cent move must not be swallowed ------------------------
    rep.ctrl("R3.1", "a 1-cent earnings move (1240 -> 1241): any relative threshold would swallow it")
    one = cd.compare(_snap("d1", earn=1240, bal=1), _snap("d2", earn=1241, bal=1))
    rep.obs("R3.1", "changes=%d %s" % (len(one["changes"]),
                                       [(c["change_type"], c["old_value"], c["new_value"]) for c in one["changes"]]))
    rep.verdict("R3.1", len(one["changes"]) == 1, "assertion: the 1-cent move is reported as exactly one change",
                ok_label="DETECTED_OK", fail_label="SWALLOWED")

    # --- R3.2 duplicate change must not notify twice ----------------------------------
    change = dict(verdict["changes"][0])
    change["prior_day_key"] = "2026-09-19"
    key = cd.dedupe_key(DAY, change["change_type"], change["field"], change["old_value"], change["new_value"])
    change["dedupe_key"] = key
    sender = RecordingSender()
    first = notify.notify_change(DAY, change, "gate-harness message", key, sender=sender, sleep_seconds=0)
    rep.ctrl("R3.2", "re-emit the SAME distinct change (same dedupe key %s...) a second time" % key[:16])
    rep.obs("R3.2", 'first emission result=%s sends=%d' % (first, len(sender.sent)))
    second = notify.notify_change(DAY, change, "gate-harness message", key, sender=sender, sleep_seconds=0)
    keys_after = notify.load_notified_keys()["keys"]
    rep.obs("R3.2", 'second emission result=%s sends=%d keys_in_index=%d' % (second, len(sender.sent), len(keys_after)))
    rep.verdict("R3.2", first == "NOTIFIED" and second == "DEDUPED" and len(sender.sent) == 1 and len(keys_after) == 1,
                "assertion: second emission returns DEDUPED and the sender is never invoked again")

    # --- R3.3 non-vacuity: a new key must still notify --------------------------------
    rep.ctrl("R3.3", "the same change re-detected on the NEXT day (new day-scoped key) -- must NOT be suppressed")
    key_next = cd.dedupe_key("2026-09-21", change["change_type"], change["field"],
                             change["old_value"], change["new_value"])
    third = notify.notify_change("2026-09-21", change, "gate-harness message", key_next, sender=sender, sleep_seconds=0)
    rep.obs("R3.3", 'result=%s sends=%d' % (third, len(sender.sent)))
    rep.verdict("R3.3", third == "NOTIFIED" and len(sender.sent) == 2,
                "assertion: dedupe is key-scoped, not a global mute (a fresh key is delivered exactly once)",
                ok_label="NOTIFIED_OK", fail_label="WRONGLY_SUPPRESSED")

    # --- R3.4 failed delivery is bounded and the key is recorded before dispatch -------
    rep.ctrl("R3.4", "delivery failure (sender raises), then a re-emit of the same key")
    fail_sender = FailingSender()
    key_fail = cd.dedupe_key(DAY, "BALANCE_CHANGED", "balance_cents", 900, 1000)
    change_fail = {"change_type": "BALANCE_CHANGED", "field": "balance_cents",
                   "old_value": 900, "new_value": 1000, "prior_day_key": "2026-09-19",
                   "dedupe_key": key_fail}
    res1 = notify.notify_change(DAY, change_fail, "gate-harness message", key_fail,
                                sender=fail_sender, sleep_seconds=0)
    entry = notify.load_notified_keys()["keys"].get(key_fail)
    attempts_after_first = fail_sender.attempts
    res2 = notify.notify_change(DAY, change_fail, "gate-harness message", key_fail,
                                sender=fail_sender, sleep_seconds=0)
    failures = [e for e in (tmp / "data-r3" / "alerts" / "alerts.jsonl").read_text(encoding="utf-8").splitlines()
                if e.strip() and json.loads(e).get("event_type") == "DELIVERY_FAILED"]
    rep.obs("R3.4", 'first=%s attempts=%d key_recorded=%s delivery=%r' %
            (res1, attempts_after_first, key_fail in notify.load_notified_keys()["keys"],
             (entry or {}).get("delivery")))
    rep.obs("R3.4", 're-emit=%s attempts_now=%d delivery_failed_lines=%d' %
            (res2, fail_sender.attempts, len(failures)))
    rep.verdict("R3.4", res1 == "FAILED" and attempts_after_first == 2 and res2 == "DEDUPED"
                and fail_sender.attempts == 2 and len(failures) == 1
                and (entry or {}).get("delivery") == notify.DELIVERY_FAILED,
                "assertion: at most 2 attempts, the key is already in the index after the failure, "
                "and a re-emit of a FAILED key is refused (no retry storm)")

    # --- R3.5 a no-change day is log-only ---------------------------------------------
    rep.ctrl("R3.5", "a no-change day while a real sender is installed (OK_NO_CHANGE must never dispatch)")
    quiet = RecordingSender()
    notify.set_sender(quiet)
    try:
        record = notify.emit_no_change(DAY, prior_day="2026-09-19", observed={"account_status": "ACTIVE"})
    finally:
        notify.set_sender(None)
    rep.obs("R3.5", 'event_type=%s severity=%s sends=%d' %
            (record.get("event_type"), record.get("severity"), len(quiet.sent)))
    rep.verdict("R3.5", record.get("event_type") == "OK_NO_CHANGE" and record.get("severity") == "info"
                and len(quiet.sent) == 0,
                "assertion: the no-change line is written to alerts.jsonl with severity=info and zero dispatches",
                ok_label="LOG_ONLY_OK", fail_label="DISPATCHED_ON_NO_CHANGE")
    return rep.finish()


# --------------------------------------------------------------------------- R4


def cmd_r4(a):
    rep = Report("R4")
    pkg, tmp = Path(a.pkg), Path(a.tmp)
    data = tmp / "data-r4"
    data.mkdir(parents=True, exist_ok=True)
    env = child_env(pkg, data)
    os.environ.update({"FREECASH_DATA_ROOT": str(data), "FREECASH_TZ": "UTC",
                       "FREECASH_TOAST_STUB": "1"})
    sys.path.insert(0, str(pkg))
    import approval_queue as aq  # noqa: E402

    moment = datetime.fromisoformat(NOW)
    change = {"change_type": "EARNINGS_CHANGED", "field": "earnings_total_cents",
              "old_value": 1340, "new_value": 1500, "dedupe_key": "gate-harness"}
    item = aq.enqueue(DAY, change, "earnings moved 1340 -> 1500", now=moment)
    rep.base("R4.0", "enqueue one item (the routine's only approval-queue write)",
             "status=%s expires_at_utc=%r execution_state=%s execution_allowed_by_this_routine=%r"
             % (item["status"], item["expires_at_utc"], item["execution_state"],
                item["execution_allowed_by_this_routine"]),
             ok=(item["status"] == "PENDING" and item["expires_at_utc"] is None
                 and item["execution_state"] == "NOT_EXECUTED"
                 and item["execution_allowed_by_this_routine"] is False))
    rep.base("R4.0b", "frozen module constants",
             "NO_EXPIRY=%r EXECUTION_STATE_NOT_EXECUTED=%r EXECUTION_ALLOWED_BY_THIS_ROUTINE=%r"
             % (aq.NO_EXPIRY, aq.EXECUTION_STATE_NOT_EXECUTED, aq.EXECUTION_ALLOWED_BY_THIS_ROUTINE),
             ok=(aq.NO_EXPIRY is None and aq.EXECUTION_STATE_NOT_EXECUTED == "NOT_EXECUTED"
                 and aq.EXECUTION_ALLOWED_BY_THIS_ROUTINE is False))
    if not rep.baseline_ok:
        print("[SECTION R4] FAIL premise failed; refusals cannot be evaluated")
        return 1

    cli = [sys.executable, str(pkg / "approval_queue.py"), "decide",
           "--id", item["approval_id"], "--decision", "approve", "--note", "gate-harness"]

    def run_cli(extra):
        return subprocess.run(cli + extra, env=env, capture_output=True, text=True,
                              cwd=str(tmp), timeout=300)

    # --- R4.1 no human identifier -----------------------------------------------------
    rep.ctrl("R4.1", "decide with NO --by identifier (a machine trying to record a decision)")
    r = run_cli([])
    rep.obs("R4.1", "exit=%d stderr=%r" % (r.returncode, (r.stderr or "").strip()[:220]))
    rep.verdict("R4.1", r.returncode != 0 and "--by" in (r.stderr or ""),
                "assertion: non-zero exit and the refusal names the missing --by",
                fail_label="DECISION_ACCEPTED_WITHOUT_HUMAN")

    # --- R4.2 non-human identity ------------------------------------------------------
    rep.ctrl("R4.2", 'decide --by "system" (a non-human identity)')
    r = run_cli(["--by", "system"])
    rep.obs("R4.2", "exit=%d stderr=%r" % (r.returncode, (r.stderr or "").strip()[:220]))
    rep.verdict("R4.2", r.returncode == 4 and "not a human identity" in (r.stderr or ""),
                "assertion: exit==4 AND stderr contains \"not a human identity\"",
                fail_label="MACHINE_DECISION_ACCEPTED")

    # --- R4.3 blank identity ----------------------------------------------------------
    rep.ctrl("R4.3", "decide --by '   ' (blank identifier)")
    r = run_cli(["--by", "   "])
    rep.obs("R4.3", "exit=%d stderr=%r" % (r.returncode, (r.stderr or "").strip()[:220]))
    rep.verdict("R4.3", r.returncode == 4 and "--by is required" in (r.stderr or ""),
                "assertion: exit==4 AND stderr contains \"--by is required\"",
                fail_label="DECISION_ACCEPTED_WITHOUT_HUMAN")

    # --- R4.4 second non-human identity ----------------------------------------------
    rep.ctrl("R4.4", 'decide --by "automation" (a non-human identity)')
    r = run_cli(["--by", "automation"])
    rep.obs("R4.4", "exit=%d stderr=%r" % (r.returncode, (r.stderr or "").strip()[:220]))
    rep.verdict("R4.4", r.returncode == 4, "assertion: exit==4",
                fail_label="MACHINE_DECISION_ACCEPTED")

    # --- R4.5 the auto-execution attempt ---------------------------------------------
    rep.ctrl("R4.5", "approve as a human, then look for ANY state that could execute the item")
    r = run_cli(["--by", "Alice (gate-harness human)"])
    after = aq.find_item(item["approval_id"])
    decided_lines = []
    decided_path = data / "approvals" / "decided.jsonl"
    if decided_path.exists():
        decided_lines = [json.loads(l) for l in decided_path.read_text(encoding="utf-8").splitlines() if l.strip()]
    offenders = []
    for record in [after] + decided_lines:
        if record.get("execution_state") != "NOT_EXECUTED":
            offenders.append(("execution_state", record.get("execution_state")))
        if record.get("expires_at_utc") is not None:
            offenders.append(("expires_at_utc", record.get("expires_at_utc")))
    rep.obs("R4.5", 'human decision exit=%d stdout=%r' % (r.returncode, (r.stdout or "").strip()[:160]))
    rep.obs("R4.5", "after approval: status=%s expires_at_utc=%r execution_state=%s "
                    "execution_allowed_by_this_routine=%r audit_records=%d offenders=%s"
            % (after["status"], after["expires_at_utc"], after["execution_state"],
               after["execution_allowed_by_this_routine"], len(decided_lines), offenders or "none"))
    rep.verdict("R4.5", r.returncode == 0 and after["status"] == "APPROVED"
                and after["execution_state"] == "NOT_EXECUTED" and after["expires_at_utc"] is None
                and after["execution_allowed_by_this_routine"] is False and not offenders,
                "assertion: the human decision is recorded (non-vacuity) AND nothing anywhere holds an "
                "executable state or an expiry",
                ok_label="NOT_EXECUTED_OK", fail_label="EXECUTION_ARMED")

    # --- R4.6 no TTL job may flip an expired PENDING item -----------------------------
    rep.ctrl("R4.6", "a deliberately EXPIRED pending item (expires_at_utc=2020-01-01) exposed to a full "
                     "routine run and to the watchdog (no TTL job may change it)")
    data2 = tmp / "data-r4b"
    seed_operator_state(data2, [DAY])
    os.environ["FREECASH_DATA_ROOT"] = str(data2)
    stale = aq.enqueue(DAY, change, "stale item for the TTL control", now=moment)
    doc = aq.load_document()
    for entry in doc["items"]:
        if entry["approval_id"] == stale["approval_id"]:
            entry["expires_at_utc"] = "2020-01-01T00:00:00Z"
    aq.save_document(doc, now=moment)
    routine = run_driver(pkg, tmp, data2)
    watchdog = subprocess.run([sys.executable, str(pkg / "watchdog.py")],
                              env=child_env(pkg, data2), capture_output=True, text=True,
                              cwd=str(tmp), timeout=300)
    reloaded = aq.find_item(stale["approval_id"])
    rep.obs("R4.6", 'routine exit=%d stdout="%s" ; watchdog exit=%d stdout="%s"'
            % (routine.returncode, (routine.stdout or "").strip()[:120],
               watchdog.returncode, (watchdog.stdout or "").strip()[:120]))
    rep.obs("R4.6", "expired item after both runs: status=%s expires_at_utc=%r execution_state=%s"
            % (reloaded["status"], reloaded["expires_at_utc"], reloaded["execution_state"]))
    rep.verdict("R4.6", reloaded["status"] == "PENDING"
                and reloaded["expires_at_utc"] == "2020-01-01T00:00:00Z"
                and reloaded["execution_state"] == "NOT_EXECUTED",
                "assertion: the item is still PENDING, its expiry is untouched and its execution state is "
                "still NOT_EXECUTED (no TTL job, no watchdog, no scheduler retry exists)",
                ok_label="STILL_PENDING_OK", fail_label="TTL_JOB_CHANGED_ITEM")

    # --- R4.7 static: no execution path consumes an approved item ---------------------
    rep.ctrl("R4.7", "static: does ANY execution path consume an APPROVED/decided item anywhere in the routine?")
    callers, writers, approved_users = [], [], []
    for path in sorted(pkg.rglob("*.py")):
        if "tests" in path.parts or path.name == "approval_queue.py":
            continue
        text = path.read_text(encoding="utf-8")
        if re.search(r"\bdecide\(", text):
            callers.append(path.name)
        if re.search(r'\[\s*["\'](execution_state|expires_at_utc)["\']\s*\]\s*=', text):
            writers.append(path.name)
        if "APPROVED" in text:
            approved_users.append(path.name)
    rep.obs("R4.7", "outside approval_queue.py: decide() callers=%s ; execution_state/expires_at_utc writers=%s ; "
                    "references to APPROVED=%s" % (callers or "none", writers or "none", approved_users or "none"))
    rep.verdict("R4.7", not callers and not writers and not approved_users,
                "assertion: no module outside approval_queue.py calls decide(), writes an executable state, "
                "or even mentions APPROVED (a decision is not consumable by this routine)",
                ok_label="NO_EXECUTION_PATH", fail_label="EXECUTION_PATH_EXISTS")
    return rep.finish()


# --------------------------------------------------------------------------- legacy


def cmd_legacy(a):
    repo = Path(a.repo)
    verifier = repo / "server" / "scripts" / "verify-freecash-rules.mjs"
    monitor = repo / "server" / "scripts" / "freecash-daily-monitor.mjs"
    print("[LEGACY] verifier=%s sha256=%s" % (verifier, sha256_file(verifier)[:16] if verifier.exists() else "MISSING"))
    print("[LEGACY] certified artifact=%s sha256=%s" % (monitor, sha256_file(monitor)[:16] if monitor.exists() else "MISSING"))
    if not (verifier.exists() and monitor.exists()):
        print("[LEGACY] cannot audit: file missing")
        return 3
    run = subprocess.run(["node", str(verifier)], capture_output=True, text=True, cwd=str(repo), timeout=180)
    print("[LEGACY] command: node server/scripts/verify-freecash-rules.mjs -> exit=%d" % run.returncode)
    for line in (run.stdout or "").strip().splitlines():
        print("[LEGACY] out| %s" % line)
    check = subprocess.run(["node", "--check", str(monitor)], capture_output=True, text=True, cwd=str(repo), timeout=180)
    print("[LEGACY] command: node --check server/scripts/freecash-daily-monitor.mjs -> exit=%d" % check.returncode)
    for line in (check.stderr or "").strip().splitlines()[:3]:
        print("[LEGACY] parse-error| %s" % line)
    src = monitor.read_text(encoding="utf-8", errors="replace")
    r3 = (not ("checkForChanges" in src)) or (".log(" in src)
    r4 = ((not ("requiresApproval" in src)) and ("prepareActionRequests" in src)) or ("approval-request.json" in src)
    print("[LEGACY] expression ProbeR3 (checkRule3 return) on the real monitor -> %s "
          "[checkForChanges=%s, '.log(' occurrences=%d]"
          % (r3, "checkForChanges" in src, src.count(".log(")))
    print("[LEGACY] expression ProbeR4 (checkRule4 return) on the real monitor -> %s "
          "[requiresApproval=%s, prepareActionRequests=%s, 'approval-request.json' occurrences=%d]"
          % (r4, "requiresApproval" in src, "prepareActionRequests" in src, src.count("approval-request.json")))
    synthetic = "function act(session){ return session.post('/v1/cashout', {amount: 9}); } // no logging at all"
    print("[LEGACY] expression ProbeR3 on a SYNTHETIC monitor whose only action is an unguarded cashout POST -> %s"
          % ((not ("checkForChanges" in synthetic)) or (".log(" in synthetic)))
    return 0


# --------------------------------------------------------------------------- main


def main(argv=None):
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(newline="\n", encoding="utf-8")
        except (AttributeError, ValueError):  # pragma: no cover - non-reconfigurable stream
            pass
    parser = argparse.ArgumentParser(prog="rule_gate_checks.py")
    sub = parser.add_subparsers(dest="command", required=True)

    def common(p):
        p.add_argument("--pkg", required=True)
        p.add_argument("--tmp", required=True)
        p.add_argument("--repo", default="")
        p.add_argument("--src", default="")
        p.add_argument("--data-root", default="")

    p = sub.add_parser("prepare"); common(p)
    p = sub.add_parser("mutate"); common(p); p.add_argument("--mutant", required=True)
    p = sub.add_parser("list-mutants"); common(p)
    p = sub.add_parser("legacy"); common(p)
    for name in ("r1", "r2", "r3", "r4"):
        common(sub.add_parser(name))

    args = parser.parse_args(sys.argv[1:] if argv is None else argv)
    handlers = {
        "prepare": cmd_prepare, "mutate": cmd_mutate, "list-mutants": cmd_list_mutants,
        "legacy": cmd_legacy, "r1": cmd_r1, "r2": cmd_r2, "r3": cmd_r3, "r4": cmd_r4,
    }
    try:
        return handlers[args.command](args)
    except Exception as exc:  # noqa: BLE001
        print("[ERROR] %s: %s: %s" % (args.command, type(exc).__name__, exc))
        return 3


if __name__ == "__main__":
    sys.exit(main())
PYEOF

SECTIONS="R1 R2 R3 R4"
if [ -n "$ONLY" ]; then
  SECTIONS=""
  IFS=',' read -r -a wanted <<< "$ONLY"
  for w in "${wanted[@]}"; do SECTIONS="$SECTIONS ${w// /}"; done
fi

section_ran() { case " $SECTIONS " in *" $1 "*) return 0 ;; *) return 1 ;; esac; }

echo "==============================================================================="
echo "RULE-GATE HARNESS -- Free Cash daily monitor (R1-R4) -- executable acceptance gate"
echo "run_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)  host_os=$(uname -s)  bash=${BASH_VERSION}"
echo "repo=$ROOT"
echo "python=$($PY -c 'import sys; print(sys.version.split()[0], sys.executable)')"
echo "temp_root=$TMPROOT"
echo "injected_day=2026-09-20  injected_clock=2026-09-20T12:00:00+00:00  FREECASH_TZ=UTC"
echo "network_policy: no socket is opened by this harness; every network-shaped control uses a patched in-process transport"
echo "==============================================================================="
echo

PROD_BEFORE="$(prod_digest)"
echo "[ISOLATION] production state tree: $PROD_ROOT"
prod_show
echo "[ISOLATION] digest_before=$PROD_BEFORE"
echo

echo "--- PREPARE (throwaway copy) --------------------------------------------------"
if [ "$QUIET_PREPARE" -eq 1 ]; then
  "$PY" "$HELPER" prepare --pkg "$PKG" --tmp "$TMPROOT" --src "$SRC_PKG" | grep -E "^\[PREPARE\] (source|copy)="
else
  "$PY" "$HELPER" prepare --pkg "$PKG" --tmp "$TMPROOT" --src "$SRC_PKG"
fi
prep_rc=${PIPESTATUS[0]}
if [ "$prep_rc" -ne 0 ]; then echo "[FATAL] prepare failed" >&2; exit 3; fi
echo

echo "--- LEGACY PRIOR-ART AUDIT ---------------------------------------------------"
"$PY" "$HELPER" legacy --pkg "$PKG" --tmp "$TMPROOT" --repo "$ROOT"
echo

echo "--- CARRIED EVIDENCE RE-VERIFICATION (offline suite, run against the real repo) --"
suite_out="$(cd "$ROOT" && PYTHONDONTWRITEBYTECODE=1 "$PY" monitoring/freecash/tests/run_all.py 2>&1)"
suite_rc=$?
printf '%s\n' "$suite_out" | grep -E "^run_all:" | sed 's/^/[CARRIED] /'
printf '%s\n' "$suite_out" | grep -vE "^run_all:" | grep -v '^$' | tail -3 | sed 's/^/[CARRIED] tail| /'
echo "[CARRIED] command: cd $ROOT && python monitoring/freecash/tests/run_all.py -> exit=$suite_rc"
CARRIED_FAIL=0
if [ "$suite_rc" -ne 0 ]; then
  echo "[CARRIED] FAIL the offline suite is red (exit=$suite_rc) -- every rule claim above is unproven on a red suite"
  CARRIED_FAIL=1
fi
echo

echo "--- INJECTED-VIOLATION CONTROLS -----------------------------------------------"
for rule in $SECTIONS; do
  out="$("$PY" "$HELPER" "${rule,,}" --pkg "$PKG" --tmp "$TMPROOT" --repo "$ROOT" --data-root "$TMPROOT/data-$rule" 2>&1)"
  rc=$?
  printf '%s\n' "$out"
  line="$(printf '%s\n' "$out" | grep -m1 "^\[SECTION $rule\]")"
  case "$line" in
    *" PASS "*) R_STATUS[$rule]="PASS" ;;
    *" FAIL "*) R_STATUS[$rule]="FAIL" ;;
    *) R_STATUS[$rule]="ERROR"; rc=3 ;;
  esac
  R_CONTROLS[$rule]="$(printf '%s\n' "$out" | grep -m1 -o "controls=[0-9]*" | cut -d= -f2)"
  R_REFUSED[$rule]="$(printf '%s\n' "$out" | grep -m1 -o "refused=[0-9]*" | cut -d= -f2)"
  R_ACCEPTED[$rule]="$(printf '%s\n' "$out" | grep -m1 -o "accepted_violations=[0-9]*" | cut -d= -f2)"
  [ "$rc" -ne 0 ] && R_NOTE[$rule]="section exit=$rc"
  echo
done

if [ "$RUN_MUTANTS" -eq 1 ]; then
  echo "--- MUTATION SELF-TEST (the harness must FAIL on a weakened mechanism) --------"
  MUTANT_LIST="$("$PY" "$HELPER" list-mutants --pkg "$PKG" --tmp "$TMPROOT")"
  MUTANT_LIST="${MUTANT_LIST//$'\r'/}"
  while IFS= read -r mutant; do
    [ -z "$mutant" ] && continue
    mrule="${mutant%%.*}"
    if ! section_ran "$mrule"; then continue; fi
    MUT_TOTAL=$((MUT_TOTAL + 1))
    if [ "${R_STATUS[$mrule]:-not-run}" != "PASS" ]; then
      echo "[MUTANT $mutant] SKIPPED -- baseline section $mrule is ${R_STATUS[$mrule]}; a FAIL under mutation would be meaningless"
      MUT_TOTAL=$((MUT_TOTAL - 1))
      continue
    fi
    rm -rf "$PKG" "$TMPROOT/data-$mrule"
    "$PY" "$HELPER" prepare --pkg "$PKG" --tmp "$TMPROOT" --src "$SRC_PKG" >/dev/null 2>&1
    "$PY" "$HELPER" mutate --pkg "$PKG" --tmp "$TMPROOT" --mutant "$mutant"
    mut_rc=$?
    if [ "$mut_rc" -ne 0 ]; then
      echo "[MUTANT $mutant] SETUP-FAILED (anchor not found) -- counted as VACUOUS"
      MUT_VACUOUS="$MUT_VACUOUS $mutant"
      continue
    fi
    mout="$("$PY" "$HELPER" "${mrule,,}" --pkg "$PKG" --tmp "$TMPROOT" --repo "$ROOT" --data-root "$TMPROOT/data-$mrule" 2>&1)"
    mrc=$?
    printf '%s\n' "$mout" | grep -E "^\[CTRL .*\] VERDICT (ACCEPTED_VIOLATION|EXECUTION_ARMED|TTL_JOB_CHANGED_ITEM|SWALLOWED|DISPATCHED_ON_NO_CHANGE|WRONGLY_SUPPRESSED|NO_[A-Z_]*)|^\[BASE .*\] PREMISE-FAILED|^\[SECTION $mrule\]" | sed 's/^/    /'
    if [ "$mrc" -eq 1 ]; then
      echo "[MUTANT $mutant] DETECTED_OK harness reported FAIL for $mrule (section exit=1) -- the gate is not vacuous"
      MUT_DETECTED=$((MUT_DETECTED + 1))
    else
      echo "[MUTANT $mutant] VACUOUS harness still reported PASS for $mrule (section exit=$mrc) -- THIS HARNESS CERTIFIES NOTHING"
      MUT_VACUOUS="$MUT_VACUOUS $mutant"
    fi
    echo
  done <<< "$MUTANT_LIST"
  echo "[MUTANTS] total=$MUT_TOTAL detected=$MUT_DETECTED vacuous_count=$((MUT_TOTAL - MUT_DETECTED))${MUT_VACUOUS:+ names:$MUT_VACUOUS}"
  echo
fi

# restore a pristine copy so the retained temp root is not left mutated
rm -rf "$PKG" "$TMPROOT/data-R1" "$TMPROOT/data-R2" "$TMPROOT/data-R3" "$TMPROOT/data-R4"
"$PY" "$HELPER" prepare --pkg "$PKG" --tmp "$TMPROOT" --src "$SRC_PKG" >/dev/null 2>&1
rm -rf "$TMPROOT/data-"*
echo

PROD_AFTER="$(prod_digest)"
echo "[ISOLATION] digest_after=$PROD_AFTER identical=$([ "$PROD_BEFORE" = "$PROD_AFTER" ] && echo True || echo False)"
if [ "$PROD_BEFORE" != "$PROD_AFTER" ]; then
  echo "[ISOLATION] FAIL the production state tree changed during this harness run" >&2
  ISOLATION_FAIL=1
fi
echo

echo "==============================================================================="
echo "RULE-GATE SUMMARY"
printf '%-5s %-6s %-9s %-8s %-9s %s\n' RULE STATUS CONTROLS REFUSED ACCEPTED NOTE
for rule in R1 R2 R3 R4; do
  printf '%-5s %-6s %-9s %-8s %-9s %s\n' "$rule" "${R_STATUS[$rule]}" "${R_CONTROLS[$rule]:-0}" \
    "${R_REFUSED[$rule]:-0}" "${R_ACCEPTED[$rule]:-0}" "${R_NOTE[$rule]}"
done
echo
passed=0; failed=""
for rule in R1 R2 R3 R4; do
  if [ "${R_STATUS[$rule]}" = "PASS" ]; then passed=$((passed + 1)); else failed="$failed $rule"; fi
done
echo "RULES PASSING: $passed/4${failed:+   NOT PROVEN:$failed}"
echo "CONTROLS: $(( ${R_CONTROLS[R1]:-0} + ${R_CONTROLS[R2]:-0} + ${R_CONTROLS[R3]:-0} + ${R_CONTROLS[R4]:-0} )) injected violations, total REFUSED_OK=$(( ${R_REFUSED[R1]:-0} + ${R_REFUSED[R2]:-0} + ${R_REFUSED[R3]:-0} + ${R_REFUSED[R4]:-0} )), total ACCEPTED_VIOLATION=$(( ${R_ACCEPTED[R1]:-0} + ${R_ACCEPTED[R2]:-0} + ${R_ACCEPTED[R3]:-0} + ${R_ACCEPTED[R4]:-0} ))"
if [ "$RUN_MUTANTS" -eq 1 ]; then
  echo "MUTATION SELF-TEST: $MUT_DETECTED/$MUT_TOTAL weakened mechanisms detected as FAIL${MUT_VACUOUS:+   VACUOUS:$MUT_VACUOUS}"
else
  echo "MUTATION SELF-TEST: skipped (--no-mutants): the harness has NOT been shown to fail in this run"
fi
echo "TEMP ROOT: $TMPROOT  (contains the throwaway routine copy and every state root it wrote; nothing was written under $ROOT)"
if [ "$CLEAN" -eq 1 ]; then
  rm -rf "$TMPROOT"
  echo "TEMP ROOT: removed (--clean)"
fi
echo

final=0
[ "${R_STATUS[R1]}" = "PASS" ] && [ "${R_STATUS[R2]}" = "PASS" ] && [ "${R_STATUS[R3]}" = "PASS" ] && [ "${R_STATUS[R4]}" = "PASS" ] || final=1
[ "${CARRIED_FAIL:-0}" -eq 1 ] && final=1
if [ "$RUN_MUTANTS" -eq 1 ] && [ "$MUT_TOTAL" -gt 0 ] && [ "$MUT_DETECTED" -ne "$MUT_TOTAL" ]; then final=2; fi
[ "$ISOLATION_FAIL" -eq 1 ] && final=4

case "$final" in
  0) echo "HARNESS RESULT: PASS -- every rule refused its injected violation and every weakened mechanism was caught" ;;
  1) echo "HARNESS RESULT: FAIL -- a rule ACCEPTED its injected violation (see the ACCEPTED_VIOLATION lines above)" ;;
  2) echo "HARNESS RESULT: VACUOUS -- this harness did not fail on a weakened mechanism and certifies nothing" ;;
  4) echo "HARNESS RESULT: NOT ISOLATED -- the production state tree changed during this run" ;;
esac
exit "$final"
