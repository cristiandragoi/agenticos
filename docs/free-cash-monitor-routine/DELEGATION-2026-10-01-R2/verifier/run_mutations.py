"""run_mutations.py -- DESIGN TRACK 3 adversarial mutation harness.

Builds one copy of monitoring/freecash per mutant under this delegation folder,
applies a single faithful bad edit, then runs every check against the COPY and
records the raw output + exit code without a pipe.

Nothing under monitoring/ or scripts/ is written: the package is only read.
Data roots always resolve to $LOCALAPPDATA/Temp/fc-r2-*/mutroots/<id>, and the
production root is refused.

Usage::

    python run_mutations.py [--only <id>] [--skip-gates]
"""

import argparse
import difflib
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

REPO = Path("D:/AgenticOS")
SRC = REPO / "monitoring" / "freecash"
HERE = Path(__file__).resolve().parent
MUTANTS = HERE / "mutants"
EVIDENCE = HERE / "evidence"
GATE_A = REPO / "docs" / "free-cash-monitor-routine" / "DELEGATION-2026-09-30" / "verifier" / "rule_gate.py"
GATE_B = REPO / "scripts" / "monitoring" / "rule_gate_verify.py"
DEMO = HERE / "demo_probe.py"
SCRATCH = Path(os.environ.get("LOCALAPPDATA", os.path.expanduser("~"))) / "Temp" / "fc-r2-9559"
PRODUCTION_ROOT = Path("D:/AgenticOS/data/freecash-monitor").resolve()

# --------------------------------------------------------------------------- specs
# rule = the brief's operator-rule label (R1 one-per-day, R2 no earning,
# R3 notify-on-change, R4 human approval).  gate_a_rule = the label the package
# gate prints for the same mechanism (it numbers the rules differently).

MUTATIONS = [
    dict(
        id="r1-a-lock-removed",
        rule="R1",
        gate_a_rule="RULE 2 (legacy R1)",
        file="gate.py",
        reason="R1 violation: the atomic exclusive-create day lock is removed, so every "
               "invocation of the same day is a winner and a second read happens.",
        old="""    lock = lock_path(day)
    lock.parent.mkdir(parents=True, exist_ok=True)
    try:
        fd = os.open(str(lock), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    except FileExistsError:
        return False, lock
    try:
        os.close(fd)
    except OSError:
        pass
    return True, lock""",
        new="""    lock = lock_path(day)
    lock.parent.mkdir(parents=True, exist_ok=True)
    # MUTATION r1-a: barrier removed -- every invocation is a winner.
    return True, lock""",
        demos=["r1_twice", "r1_concurrent"],
    ),
    dict(
        id="r1-b-lock-nonbinding",
        rule="R1",
        gate_a_rule="RULE 2 (legacy R1)",
        file="gate.py",
        reason="R1 violation: the O_CREAT|O_EXCL syscall is still there, but an existing "
               "lock no longer binds -- the day is re-read.",
        old="""    except FileExistsError:
        return False, lock""",
        new="""    except FileExistsError:
        # MUTATION r1-b: an existing lock no longer binds.
        return True, lock""",
        demos=["r1_twice", "r1_concurrent"],
    ),
    dict(
        id="r2-a-post-cashout-on-read-path",
        rule="R2",
        gate_a_rule="RULE 1 (legacy R2)",
        file="readonly_client.py",
        reason="R2 violation: POST is added to the method allowlist and a collection path "
               "to the path allowlist, plus a helper that submits an earning action.",
        old="""ALLOWED_METHODS = frozenset({"GET", "HEAD"})""",
        new="""ALLOWED_METHODS = frozenset({"GET", "HEAD", "POST"})  # MUTATION r2-a""",
        extra=[
            (
                """    re.compile(r"^/api/v1/status$"),""",
                """    re.compile(r"^/api/v1/status$"),
    # MUTATION r2-a: the collection endpoint is treated as a read.
    re.compile(r"^/api/v1/transactions$"),""",
            ),
            (
                """def read_status_source(base=None, transport=None) -> dict:""",
                """def collect_earnings(base=None, transport=None) -> dict:
    \"\"\"MUTATION r2-a: submit the day's earnings claim automatically.\"\"\"
    url = (base or base_url()).rstrip("/") + "/api/v1/transactions"
    return request("POST", url, transport=transport)


def read_status_source(base=None, transport=None) -> dict:""",
            ),
        ],
        demos=["r2_forbidden"],
    ),
    dict(
        id="r2-b-urllib-write-path",
        rule="R2",
        gate_a_rule="RULE 1 (legacy R2)",
        file="run_daily_check.py",
        reason="R2 violation: an out-of-band POST /api/v1/claim is added to the read path "
               "with urllib, so the read-only client's allowlist is bypassed entirely.",
        old="""def resolve_source(explicit=None) -> str:""",
        new="""def _submit_claim(day):
    \"\"\"MUTATION r2-b: post the day's claim straight to the collector.

    Written with urllib so it does not have to pass the read-only client's
    allowlist at all.
    \"\"\"
    import urllib.request

    body = b'{"action": "claim", "day": "' + day.encode("ascii") + b'"}'
    req = urllib.request.Request(
        "http://127.0.0.1:3001/api/v1/claim", data=body, method="POST"
    )
    return urllib.request.urlopen(req, timeout=5).status


def resolve_source(explicit=None) -> str:""",
        demos=["r2_bypass", "r2_forbidden"],
    ),
    dict(
        id="r3-a-baseline-is-current",
        rule="R3",
        gate_a_rule="RULE 3",
        file="run_daily_check.py",
        reason="R3 violation: the prior-state load is dropped and the 'previous' baseline "
               "becomes the snapshot just built, so no change can ever be seen.",
        old="""    prior = changedetect.load_prior_snapshot(day)
    snapshot = changedetect.build_snapshot(day, metrics, source, raw.get("raw_body") or b"", now=now)""",
        new="""    # MUTATION r3-a: save-before-load; the baseline is the current state.
    snapshot = changedetect.build_snapshot(day, metrics, source, raw.get("raw_body") or b"", now=now)
    prior = snapshot""",
        demos=["r3_two_days"],
    ),
    dict(
        id="r3-b-sub-dollar-threshold",
        rule="R3",
        gate_a_rule="RULE 3",
        file="changedetect.py",
        reason="R3 violation: a sub-dollar threshold silently swallows real earnings moves "
               "(the comparison is no longer exact).",
        old="""        if old == new:
            continue""",
        new="""        if old == new:
            continue
        # MUTATION r3-b: do not bother the operator about sub-dollar moves.
        if isinstance(old, int) and isinstance(new, int) and abs(new - old) < 100:
            continue""",
        demos=["r3_two_days"],
    ),
    dict(
        id="r4-a-nonhuman-decider-accepted",
        rule="R4",
        gate_a_rule="RULE 4",
        file="approval_queue.py",
        reason="R4 violation: the decider check is deleted, so any machine identity "
               "(e.g. 'system', 'agent-007') can sign an approval.",
        old="""    if who.lower() in NON_HUMAN_DECIDERS:
        raise NotHumanError(
            "refused: %r is not a human identity; this routine may only record a "
            "decision made by a person" % who
        )
    return who""",
        new="""    # MUTATION r4-a: any non-empty string is accepted as the decider.
    return who""",
        demos=["r4_decide"],
    ),
    dict(
        id="r4-b-arms-on-approve",
        rule="R4",
        gate_a_rule="RULE 4",
        file="approval_queue.py",
        reason="R4 violation: an approved item is armed with a live expiry and "
               "EXECUTION_ARMED state -- 'expired' becomes 'execute'.",
        old="""    # Re-assert the frozen fields: a decision must not be able to arm the item.
    item["expires_at_utc"] = NO_EXPIRY
    item["execution_state"] = EXECUTION_STATE_NOT_EXECUTED
    item["execution_allowed_by_this_routine"] = EXECUTION_ALLOWED_BY_THIS_ROUTINE""",
        new="""    # MUTATION r4-b: an approved item is armed with a live expiry.
    if decision == "approve":
        item["expires_at_utc"] = paths.iso_utc(now)
        item["execution_state"] = "EXECUTION_ARMED"
        item["execution_allowed_by_this_routine"] = True
    else:
        item["expires_at_utc"] = NO_EXPIRY
        item["execution_state"] = EXECUTION_STATE_NOT_EXECUTED
        item["execution_allowed_by_this_routine"] = EXECUTION_ALLOWED_BY_THIS_ROUTINE""",
        demos=["r4_decide"],
    ),
]

CONTROL_ID = "canonical-control"
CONTROL_DEMOS = ["r1_twice", "r1_concurrent", "r3_two_days", "r2_forbidden", "r2_bypass", "r4_decide"]


# --------------------------------------------------------------------------- helpers


def assert_scratch(path: Path) -> Path:
    resolved = Path(path).resolve()
    if resolved == PRODUCTION_ROOT:
        raise SystemExit("REFUSED: production root")
    try:
        resolved.relative_to(Path(os.environ.get("LOCALAPPDATA", "~")) / "Temp")
    except ValueError:
        raise SystemExit("REFUSED: %s is not under LOCALAPPDATA/Temp" % resolved)
    return resolved


def sh(cmd, cwd=None, env=None, timeout=300):
    proc = subprocess.run(cmd, cwd=cwd, env=env, capture_output=True, text=True, timeout=timeout)
    return proc.returncode, (proc.stdout or "") + (proc.stderr or "")


def copy_pkg(dest: Path):
    if dest.exists():
        shutil.rmtree(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(SRC, dest, ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))


def apply_mutation(pkg: Path, spec: dict):
    edits = [(spec["file"], spec["old"], spec["new"])]
    for old, new in spec.get("extra", []):
        edits.append((spec["file"], old, new))
    diffs = []
    for name, old, new in edits:
        target = pkg / name
        text = target.read_text(encoding="utf-8")
        count = text.count(old)
        if count != 1:
            raise SystemExit("MUTATION %s: pattern matched %d times in %s (expected 1)" % (spec["id"], count, name))
        mutated = text.replace(old, new, 1)
        if mutated == text:
            raise SystemExit("MUTATION %s: replacement was a no-op" % spec["id"])
        if old not in new and old in mutated:
            # an insertion-style edit legitimately keeps the anchor text
            raise SystemExit("MUTATION %s: pattern survived the rewrite" % spec["id"])
        target.write_text(mutated, encoding="utf-8", newline="\n")
        diffs.append("".join(difflib.unified_diff(text.splitlines(True), mutated.splitlines(True), "a/" + name, "b/" + name)))
    return "\n".join(diffs)


def changed_files(spec: dict):
    return sorted({spec["file"]})


def run_one(spec, skip_gates=False):
    mid = spec["id"]
    mdir = MUTANTS / mid
    pkg = mdir / "pkg"
    copy_pkg(pkg)
    diff = apply_mutation(pkg, spec)
    (mdir / "mutation.diff").write_text(diff, encoding="utf-8", newline="\n")
    row = {"id": mid, "rule": spec["rule"], "gate_a_rule": spec["gate_a_rule"], "file": spec["file"], "reason": spec["reason"]}

    if not skip_gates:
        # gate A (package-scoped)
        code, text = sh([sys.executable, str(GATE_A), "--package", str(pkg)])
        (mdir / "gateA-package.txt").write_text(text, encoding="utf-8", newline="\n")
        (mdir / "gateA-package.exit.txt").write_text(str(code) + "\n", encoding="utf-8", newline="\n")
        summary = [ln.strip() for ln in text.splitlines() if ln.strip().startswith("SUMMARY:")]
        row["gateA_exit"] = code
        row["gateA_summary"] = summary[-1] if summary else ""
        # gate B (single-file scope, on the mutated file)
        tgt = pkg / spec["file"]
        code_b, text_b = sh([sys.executable, str(GATE_B), str(tgt)])
        (mdir / "gateB-single-file.txt").write_text(text_b, encoding="utf-8", newline="\n")
        (mdir / "gateB-single-file.exit.txt").write_text(str(code_b) + "\n", encoding="utf-8", newline="\n")
        summ_b = [ln.strip() for ln in text_b.splitlines() if ln.strip().startswith("SUMMARY:")]
        row["gateB_exit"] = code_b
        row["gateB_summary"] = summ_b[-1] if summ_b else ""
        # read-only static scanner shipped in the package
        code_s, text_s = sh([sys.executable, str(pkg / "verify_readonly.py"), str(pkg)])
        (mdir / "readonly-scan.txt").write_text(text_s, encoding="utf-8", newline="\n")
        (mdir / "readonly-scan.exit.txt").write_text(str(code_s) + "\n", encoding="utf-8", newline="\n")
        row["readonly_scan_exit"] = code_s
        row["readonly_scan_line"] = next((ln.strip() for ln in text_s.splitlines() if "forbidden=" in ln), "")

    demos = {}
    for kind in spec["demos"]:
        root = assert_scratch(SCRATCH / "mutroots" / mid / kind)
        shutil.rmtree(root, ignore_errors=True)
        env = dict(os.environ)
        env["FREECASH_DATA_ROOT"] = str(root)
        env["PYTHONDONTWRITEBYTECODE"] = "1"
        code, text = sh([sys.executable, str(DEMO), kind, str(pkg), str(root)], env=env)
        (mdir / ("demo-%s.txt" % kind)).write_text(text, encoding="utf-8", newline="\n")
        (mdir / ("demo-%s.exit.txt" % kind)).write_text(str(code) + "\n", encoding="utf-8", newline="\n")
        payload = next((ln[len("PROBE_JSON "):] for ln in text.splitlines() if ln.startswith("PROBE_JSON ")), None)
        demos[kind] = json.loads(payload) if payload else {"error": text}
    row["demos"] = demos
    (mdir / "row.json").write_text(json.dumps(row, indent=2, sort_keys=True), encoding="utf-8", newline="\n")
    return row


def run_control(skip_gates=False):
    mid = CONTROL_ID
    mdir = MUTANTS / mid
    pkg = mdir / "pkg"
    copy_pkg(pkg)
    (mdir / "mutation.diff").write_text("(unmutated copy of monitoring/freecash)\n", encoding="utf-8", newline="\n")
    row = {"id": mid, "rule": "control", "gate_a_rule": "control", "file": "(none)", "reason": "unmutated copy"}
    # prove the copy is byte-identical to the source
    import hashlib

    def tree_hash(root):
        h = hashlib.sha256()
        for p in sorted(root.rglob("*.py")):
            if "__pycache__" in p.parts:
                continue
            h.update(p.relative_to(root).as_posix().encode())
            h.update(hashlib.sha256(p.read_bytes()).hexdigest().encode())
        return h.hexdigest()

    row["source_tree_sha256"] = tree_hash(SRC)
    row["copy_tree_sha256"] = tree_hash(pkg)
    row["copy_matches_source"] = row["source_tree_sha256"] == row["copy_tree_sha256"]

    if not skip_gates:
        code, text = sh([sys.executable, str(GATE_A), "--package", str(pkg)])
        (mdir / "gateA-package.txt").write_text(text, encoding="utf-8", newline="\n")
        (mdir / "gateA-package.exit.txt").write_text(str(code) + "\n", encoding="utf-8", newline="\n")
        summary = [ln.strip() for ln in text.splitlines() if ln.strip().startswith("SUMMARY:")]
        row["gateA_exit"] = code
        row["gateA_summary"] = summary[-1] if summary else ""
        code_b, text_b = sh([sys.executable, str(GATE_B), str(pkg / "run_daily_check.py")])
        (mdir / "gateB-single-file.txt").write_text(text_b, encoding="utf-8", newline="\n")
        (mdir / "gateB-single-file.exit.txt").write_text(str(code_b) + "\n", encoding="utf-8", newline="\n")
        summ_b = [ln.strip() for ln in text_b.splitlines() if ln.strip().startswith("SUMMARY:")]
        row["gateB_exit"] = code_b
        row["gateB_summary"] = summ_b[-1] if summ_b else ""
        code_s, text_s = sh([sys.executable, str(pkg / "verify_readonly.py"), str(pkg)])
        (mdir / "readonly-scan.txt").write_text(text_s, encoding="utf-8", newline="\n")
        (mdir / "readonly-scan.exit.txt").write_text(str(code_s) + "\n", encoding="utf-8", newline="\n")
        row["readonly_scan_exit"] = code_s
        row["readonly_scan_line"] = next((ln.strip() for ln in text_s.splitlines() if "forbidden=" in ln), "")

    demos = {}
    for kind in CONTROL_DEMOS:
        root = assert_scratch(SCRATCH / "mutroots" / mid / kind)
        shutil.rmtree(root, ignore_errors=True)
        env = dict(os.environ)
        env["FREECASH_DATA_ROOT"] = str(root)
        env["PYTHONDONTWRITEBYTECODE"] = "1"
        code, text = sh([sys.executable, str(DEMO), kind, str(pkg), str(root)], env=env)
        (mdir / ("demo-%s.txt" % kind)).write_text(text, encoding="utf-8", newline="\n")
        (mdir / ("demo-%s.exit.txt" % kind)).write_text(str(code) + "\n", encoding="utf-8", newline="\n")
        payload = next((ln[len("PROBE_JSON "):] for ln in text.splitlines() if ln.startswith("PROBE_JSON ")), None)
        demos[kind] = json.loads(payload) if payload else {"error": text}
    row["demos"] = demos
    (mdir / "row.json").write_text(json.dumps(row, indent=2, sort_keys=True), encoding="utf-8", newline="\n")
    return row


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--only")
    parser.add_argument("--skip-gates", action="store_true")
    parser.add_argument("--control-only", action="store_true")
    args = parser.parse_args()
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    MUTANTS.mkdir(parents=True, exist_ok=True)
    SCRATCH.mkdir(parents=True, exist_ok=True)

    rows = []
    if not args.control_only:
        for spec in MUTATIONS:
            if args.only and spec["id"] != args.only:
                continue
            print("=== %s ===" % spec["id"], flush=True)
            row = run_one(spec, skip_gates=args.skip_gates)
            rows.append(row)
            print(json.dumps({k: row[k] for k in row if k != "demos"}, sort_keys=True), flush=True)
    if not args.only:
        print("=== %s ===" % CONTROL_ID, flush=True)
        rows.append(run_control(skip_gates=args.skip_gates))

    (EVIDENCE / "mutation-rows.json").write_text(json.dumps(rows, indent=2, sort_keys=True), encoding="utf-8", newline="\n")

    cols = ["id", "rule", "gate_a_rule", "file", "gateA_exit", "gateA_summary", "gateB_exit", "gateB_summary", "readonly_scan_exit", "readonly_scan_line"]
    lines = ["\t".join(cols)]
    for row in rows:
        lines.append("\t".join(str(row.get(c, "")) for c in cols))
    (EVIDENCE / "MUTATION-MATRIX.tsv").write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")
    print("\n".join(lines))
    return 0


if __name__ == "__main__":
    sys.exit(main())
