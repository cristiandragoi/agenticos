#!/usr/bin/env python3
"""mutation_harness_r3.py -- adversarially falsify rule_gate_r3.py.

Read-only on the repository: the canonical package is COPIED to a throwaway
directory under $LOCALAPPDATA/Temp and every plant is applied there.  The live
production state root (data/freecash-monitor) is never referenced by any run.

Every substitution asserts its own effect (exactly one replacement, and the
mutated text present only in the copy) and aborts otherwise -- a redirect that
does not redirect is indistinguishable from no redirect at all.

Usage:
    <venv-python> mutation_harness_r3.py --repo D:/AgenticOS --out <evidence dir>
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

PY_DEFAULT = r"C:\Users\cd-pr\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe"

GATE_REL = "docs/free-cash-monitor-routine/DELEGATION-2026-10-01-R3/verifier/rule_gate_r3.py"
SHIPPED_1FILE = "scripts/monitoring/rule_gate_verify.py"
GATE_0930 = "docs/free-cash-monitor-routine/DELEGATION-2026-09-30/verifier/rule_gate.py"
GATE_1001 = "docs/free-cash-monitor-routine/DELEGATION-2026-10-01/verifier/verify_freecash_rules.py"
MJS_VERIFIER = "server/scripts/verify-freecash-rules.mjs"


def run(cmd, env=None, cwd=None, timeout=600):
    p = subprocess.run(cmd, capture_output=True, text=True, env=env, cwd=cwd, timeout=timeout, errors="replace")
    return p.returncode, p.stdout, p.stderr


def substitute(path: Path, old: str, new: str, label: str, insert: bool = False) -> str:
    """Fail-closed single substitution: count the match, abort unless exactly one.

    insert=True is for an INSERT-before-anchor edit, where the anchor legitimately
    survives in the rewritten text; the assertion then requires the whole new
    block to be present exactly once.
    """
    src = path.read_text(encoding="utf-8")
    n = src.count(old)
    if n != 1:
        raise SystemExit("MUTANT %s: anchor matched %d times in %s (expected exactly 1)" % (label, n, path))
    out = src.replace(old, new)
    if insert:
        if out.count(new) != 1:
            raise SystemExit("MUTANT %s: inserted block present %d times (expected 1) in %s"
                             % (label, out.count(new), path))
    else:
        if old in out:
            raise SystemExit("MUTANT %s: anchor survived the rewrite in %s" % (label, path))
        if new not in out:
            raise SystemExit("MUTANT %s: replacement not present after rewrite in %s" % (label, path))
    path.write_text(out, encoding="utf-8", newline="\n")
    return "%s substitution at %s (anchor len=%d)" % ("insert" if insert else "1", path.name, len(old))


def summary_of(text):
    for line in text.splitlines():
        if line.startswith("SUMMARY:"):
            return line.strip()
    return "(no SUMMARY line -- gate did not run)"


# --------------------------------------------------------------------------- mutant definitions

EARLY_READ = '''    if not os.environ.get("FREECASH_ALLOW_EARLY_READ"):
        # MUTANT M-b: a status read BEFORE the day lock is consumed.
        _early = read_source(DEFAULT_SOURCE, gate.day_key(now))
        del _early
'''

WRITE_CALL = '''    if kind == "operator_state":
        # MUTANT M-a: a write/earning endpoint call added to the read path.
        import http.client as _hc
        _conn = _hc.HTTPConnection("127.0.0.1", 4699, timeout=2)
        _conn.request("POST", "/api/v1/withdraw", body=b'{"amount_cents":1}')
        _conn.getresponse().read()
        _conn.close()
    return operator_state.read_source(day)  # mutant M-a
'''

SAVE_FIRST = '''    snapshot = changedetect.build_snapshot(day, metrics, source, raw.get("raw_body") or b"", now=now)
    # MUTANT M-c: the new snapshot is written BEFORE the prior one is loaded.
    snapshot_file, written = changedetect.save_snapshot(snapshot, now=now)
    prior = changedetect.load_prior_snapshot(day)
    verdict = changedetect.compare(prior, snapshot)
'''

DEGRADED_SUCCESS = '''        outcome = "MONITOR_DEGRADED"
        # MUTANT M-d: a data-less run books itself as a success day.
        ledger["last_success_day"] = day
        ledger["consecutive_missed_days"] = 0
'''

NO_GUARD = '''    return who
'''

ALLOWLIST_GUARD = '''    HUMAN_OPERATORS = frozenset({"alice operator", "bob operator", "cd-pr"})
    if who.lower() not in HUMAN_OPERATORS:
        raise NotHumanError(
            "refused: %r is not an allowlisted human operator" % who
        )
    return who
'''


def mutants(repo: Path):
    """Yield (id, title, rule_at_stake, apply_fn) where apply_fn(copy_dir) -> note."""
    run_py = "run_daily_check.py"
    aq = "approval_queue.py"
    gat = "gate.py"

    def m_a(c):
        note = substitute(c / run_py, '    return operator_state.read_source(day)\n', WRITE_CALL, "M-a")
        return note

    def m_b(c):
        anchor = '    source_kind = resolve_source(args.source)\n'
        note = substitute(c / run_py, anchor, EARLY_READ + anchor, "M-b", insert=True)
        return note

    def m_c(c):
        old = ('    prior = changedetect.load_prior_snapshot(day)\n'
               '    snapshot = changedetect.build_snapshot(day, metrics, source, raw.get("raw_body") or b"", now=now)\n'
               '    verdict = changedetect.compare(prior, snapshot)\n'
               '    snapshot_file, written = changedetect.save_snapshot(snapshot, now=now)\n')
        note = substitute(c / run_py, old, SAVE_FIRST, "M-c")
        return note

    def m_d(c):
        old = ('    if not source["data_available"]:\n'
               '        outcome = "MONITOR_DEGRADED"\n'
               '        notify.alert(\n')
        new = ('    if not source["data_available"]:\n' + DEGRADED_SUCCESS + '        notify.alert(\n')
        note = substitute(c / run_py, old, new, "M-d")
        return note

    def m_e(c):
        old = ('    if who.lower() in NON_HUMAN_DECIDERS:\n'
               '        raise NotHumanError(\n'
               '            "refused: %r is not a human identity; this routine may only record a "\n'
               '            "decision made by a person" % who\n'
               '        )\n'
               '    return who\n')
        note = substitute(c / aq, old, NO_GUARD, "M-e")
        return note

    def ctrl(c):
        # POSITIVE CONTROL: a repaired package that SHOULD pass all four rules.
        n1 = substitute(c / gat,
                        '        "MONITOR_DEGRADED",\n', '', "CTRL-R1.3")
        n2 = substitute(c / aq,
                        ('    if who.lower() in NON_HUMAN_DECIDERS:\n'
                         '        raise NotHumanError(\n'
                         '            "refused: %r is not a human identity; this routine may only record a "\n'
                         '            "decision made by a person" % who\n'
                         '        )\n'
                         '    return who\n'),
                        ALLOWLIST_GUARD, "CTRL-R4.3")
        return n1 + " | " + n2

    def ctrl2(c):
        # SECOND CONTROL: fix ONLY the success-set defect, leave the denylist in
        # place.  Pins the causality of the delivered 10-01 gate's verdict.
        n1 = substitute(c / gat,
                        '        "MONITOR_DEGRADED",\n', '', "CTRL2-R1.3")
        return n1

    return [
        ("CTRL", "POSITIVE CONTROL: repaired package (MONITOR_DEGRADED removed from SUCCESS_OUTCOMES; decider guard is an allowlist) -- the gate MUST pass", "none", ctrl),
        ("CTRL2", "CONTROL 2: only MONITOR_DEGRADED removed from SUCCESS_OUTCOMES; decider guard left as the shipped denylist", "none", ctrl2),
        ("M-a", "R2: write/earning endpoint call added to the read path (HTTPConnection POST /api/v1/withdraw)", "Rule 2", m_a),
        ("M-b", "R1: a status read is performed BEFORE the day lock is consumed (read-then-lock)", "Rule 1", m_b),
        ("M-c", "R3: snapshot saved BEFORE the prior snapshot is loaded (kills change detection)", "Rule 3", m_c),
        ("M-d", "R1/R3: a data-less run advances last_success_day and zeroes consecutive_missed_days", "Rule 1", m_d),
        ("M-e", "R4: decider identity guard removed entirely (any label, including 'hermes-agent', signs a decision)", "Rule 4", m_e),
    ]


# --------------------------------------------------------------------------- runtime probes

class Sink(BaseHTTPRequestHandler):
    hits = []

    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(n)
        Sink.hits.append(("POST", self.path, body.decode("utf-8", "replace")))
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"{}")

    def log_message(self, *a):
        pass


def local_sink_probe(mutant_copy: Path, py: str, workroot: Path):
    """Execute the M-a mutant's read path against a localhost sink we control.
    The call is NEVER aimed at a provider; the only network endpoint is 127.0.0.1."""
    srv = HTTPServer(("127.0.0.1", 4699), Sink)
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    time.sleep(0.3)
    Sink.hits = []
    env = dict(os.environ)
    env["FREECASH_DATA_ROOT"] = str(workroot)
    env["AGENTICOS_DATA_DIR"] = str(workroot)
    env["AGENT_TEAMS_DB_PATH"] = str(workroot / "agentic-os.db")
    env["PYTHONPATH"] = str(mutant_copy)
    code = (
        "import run_daily_check as r;"
        "r.paths.ensure_layout();"
        "print(r.read_source('operator_state','2026-10-01'))"
    )
    rc, out, err = run([py, "-c", code], env=env, cwd=str(mutant_copy))
    srv.shutdown()
    return rc, out, err, list(Sink.hits)


IDENTITY_PROBE = '''import json, sys
sys.path.insert(0, PKGPATH)
import approval_queue as a
a.paths.ensure_layout()
LABELS = ["hermes-agent", "assistant", "claude", "system", "routine", "Alice Operator"]
out = {}
for label in LABELS:
    item = a.enqueue("2026-10-01",
                     {"dedupe_key": "probe-key", "field": "earnings_total_cents",
                      "change_type": "EARNINGS_CHANGED"}, "probe")
    try:
        it = a.decide(item["approval_id"], "approve", label, "probe note")
        out[label] = "ACCEPTED status=%s execution_state=%s" % (it["status"], it["execution_state"])
    except a.NotHumanError as exc:
        out[label] = "REFUSED (%s)" % exc
print(json.dumps(out, indent=1))
'''


def identity_probe(pkg: Path, py: str, workroot: Path):
    """Both directions of Rule 4's identity guard, for a given package copy.

    Runs in a throwaway FREECASH_DATA_ROOT: the live production state root is
    never referenced, and approval_queue.decide() only ever writes there.
    """
    env = dict(os.environ)
    env["FREECASH_DATA_ROOT"] = str(workroot)
    env["AGENTICOS_DATA_DIR"] = str(workroot)
    env["AGENT_TEAMS_DB_PATH"] = str(workroot / "agentic-os.db")
    script = workroot / "identity_probe.py"
    script.write_text(IDENTITY_PROBE.replace("PKGPATH", repr(str(pkg))), encoding="utf-8")
    rc, out, err = run([py, str(script)], env=env, cwd=str(pkg))
    return {"rc": rc, "result": out.strip(), "stderr": (err or "").strip()[-300:]}


# --------------------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", default="D:/AgenticOS")
    ap.add_argument("--out", required=True)
    ap.add_argument("--python", default=PY_DEFAULT)
    args = ap.parse_args()

    repo = Path(args.repo).resolve()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    py = args.python
    pkg_src = repo / "monitoring" / "freecash"
    sandbox = Path(tempfile.mkdtemp(prefix="r3-mutants-"))

    # --- baseline: my gate against the UNMUTATED canonical package
    brc, bso, bse = run([py, str(repo / GATE_REL), "--package", str(pkg_src), "--json"])
    base = json.loads(bso)
    base_checks = {c["id"]: c["ok"] for c in base["checks"]}
    base_rules = base["rules"]
    (out / "mygate-baseline-pristine.json").write_text(bso, encoding="utf-8")

    rows = []
    for mid, title, rule, apply_fn in mutants(repo):
        copy = sandbox / ("pkg-" + mid)
        if copy.exists():
            shutil.rmtree(copy)
        shutil.copytree(pkg_src, copy, ignore=shutil.ignore_patterns("__pycache__"))
        note = apply_fn(copy)
        assert (copy / "run_daily_check.py").exists(), "copy lost its modules"

        rc, so, se = run([py, str(repo / GATE_REL), "--package", str(copy), "--json"])
        try:
            j = json.loads(so)
            rules = j["rules"]
            checks = {c["id"]: c["ok"] for c in j["checks"]}
        except Exception as exc:
            rules, checks = {"parse": "ERROR"}, {}
        gate_out = so + se
        (out / ("%s.mygate.json" % mid)).write_text(gate_out, encoding="utf-8")
        bad = sorted(k for k, v in rules.items() if v == "FAIL")
        # caught = a check that PASSED on the pristine tree and FAILS on the mutant
        newly_failed = sorted(cid for cid, ok in checks.items() if not ok and base_checks.get(cid))
        caught = "YES" if (newly_failed or rules.get("parse") == "ERROR") else "NO"

        # --- the delivered gates, run against the same mutant copy
        if mid in ("M-a", "M-b", "M-c", "M-d"):
            changed = "run_daily_check.py"
        elif mid == "M-e":
            changed = "approval_queue.py"
        else:
            changed = "gate.py+approval_queue.py"
        files = changed.split("+")
        one_file = []
        for f in files:
            frc, fso, fse = run([py, str(repo / SHIPPED_1FILE), str(copy / f)])
            one_file.append("(%s rc=%d) %s" % (f, frc, summary_of(fso + fse)))
        wd = sandbox / ("wd-" + mid)
        wd.mkdir(exist_ok=True)
        g9rc, g9so, g9se = run([py, str(repo / GATE_0930), "--package", str(copy), "--workdir", str(wd / "g9")])
        g10rc, g10so, g10se = run([py, str(repo / GATE_1001), str(copy), "--workdir", str(wd / "g10")])
        (out / ("%s.gate-0930.txt" % mid)).write_text(g9so + g9se, encoding="utf-8")
        (out / ("%s.gate-1001.txt" % mid)).write_text(g10so + g10se, encoding="utf-8")
        g9fail = [l.strip() for l in (g9so + g9se).splitlines() if "FAIL" in l][:4]
        g10fail = [l.strip() for l in (g10so + g10se).splitlines() if "[FAIL" in l or " FAIL " in l][:4]

        rows.append({
            "id": mid,
            "title": title,
            "rule": rule,
            "substitution": note,
            "my_gate_exit": rc,
            "my_gate_summary": " ".join("%s=%s" % (k, v) for k, v in sorted(rules.items())),
            "my_gate_failed_checks": newly_failed,
            "my_gate_all_failing_checks": sorted(cid for cid, ok in checks.items() if not ok),
            "caught": caught,
            "gate_0930_exit": g9rc,
            "gate_0930_summary": summary_of(g9so + g9se),
            "gate_0930_fail_lines": g9fail,
            "gate_1001_exit": g10rc,
            "gate_1001_fail_lines": g10fail,
            "gate_1001_result": [l for l in (g10so + g10se).splitlines() if "RESULT" in l][-1:],
            "gate_1file": one_file,
        })

    # --- runtime probes
    probe = {}
    sink_mutant = sandbox / "pkg-M-a"
    if sink_mutant.exists():
        wr = Path(tempfile.mkdtemp(prefix="r3-sinkroot-"))
        rc, so, se, hits = local_sink_probe(sink_mutant, py, wr)
        probe["M-a_sink"] = {"rc": rc, "stdout_tail": (so or "").strip()[-300:], "stderr_tail": (se or "").strip()[-200:],
                             "sink_hits": hits}
    probe["identity_pristine"] = identity_probe(pkg_src, py, Path(tempfile.mkdtemp(prefix="r3-idroot-")))
    ctrl_copy = sandbox / "pkg-CTRL"
    if ctrl_copy.exists():
        probe["identity_ctrl"] = identity_probe(ctrl_copy, py, Path(tempfile.mkdtemp(prefix="r3-idroot-")))

    # --- the shipped .mjs verifier, un-pointable by construction
    mrc, mso, mse = run(["node", str(repo / MJS_VERIFIER)], cwd=str(repo))
    probe["mjs_verifier"] = {"rc": mrc, "tail": (mso or "").strip().splitlines()[-3:]}

    (out / "mutation-harness-result.json").write_text(
        json.dumps({"rows": rows, "runtime_probes": probe, "sandbox": str(sandbox)}, indent=2), encoding="utf-8")

    # --- human-readable table
    lines = []
    lines.append("id    rule    caught  my_gate_newly_failed_checks   gate_0930        gate_1001        shipped_1file")
    lines.append("-" * 120)
    for r in rows:
        g9 = "rc=%d %s" % (r["gate_0930_exit"],
                          "PASS" if "R1=PASS  R2=PASS  R3=PASS  R4=PASS" in r["gate_0930_summary"] else "FAIL")
        g10 = "rc=%d" % r["gate_1001_exit"] + (" PASS" if r["gate_1001_exit"] == 0 else " FAIL")
        one = "; ".join(x for x in r["gate_1file"])[:58]
        lines.append("%-5s %-7s %-7s %-30s %-16s %-16s %s"
                     % (r["id"], r["rule"], r["caught"], ",".join(r["my_gate_failed_checks"]) or "-", g9, g10, one))
    lines.append("")
    lines.append("MY GATE: rule verdict per mutant (newly-failed check ids in brackets):")
    for r in rows:
        lines.append("  %-5s %s   newly_failed=%s" % (r["id"], r["my_gate_summary"], r["my_gate_failed_checks"] or "NONE"))
    lines.append("")
    lines.append("DELIVERED-GATE FAIL LINES (first 4):")
    for r in rows:
        lines.append("  %-5s 09-30 %s" % (r["id"], r["gate_0930_fail_lines"][:2] or ["(none)"]))
        lines.append("  %-5s 10-01 %s" % (r["id"], r["gate_1001_fail_lines"][:2] or ["(none)"]))
    lines.append("")
    lines.append("RUNTIME PROBES:")
    for k, v in probe.items():
        lines.append("  %s: %s" % (k, json.dumps(v)[:900]))
    (out / "mutation-table.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines))
    print("\nsandbox=%s" % sandbox)
    return 0


if __name__ == "__main__":
    sys.exit(main())
