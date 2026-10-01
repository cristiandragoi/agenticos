"""verify_readonly.py -- R2 layer C: the static check, as a CI-runnable program.

This is a faithful Python port of the shipped shell checker
``docs/free-cash-monitor-routine/verify-readonly.sh``: the same six forbidden
token classes, the same case-insensitive matching, the same per-line exemption
rule, and the same exit codes.

    exit 0  no unexempted forbidden token found
    exit 1  at least one forbidden token found (the build must fail)
    exit 2  a scan target did not exist (absence of evidence is not a pass)

A line is exempt only when it carries the inline marker
``readonly-exempt: <reason>``.  The pattern table below is the one place that
must name the forbidden tokens, so its own lines carry the marker.

Usage::

    py -3 monitoring/freecash/verify_readonly.py [TARGET ...]
    py -3 monitoring/freecash/verify_readonly.py --target <dir> --quiet

The design is deliberately blunt: prose in comments and docstrings is scanned as
well, because a fail-closed scanner that skips comments is eventually defeated by
generated code.  Naming a forbidden verb in prose therefore requires the inline
marker, which keeps the exemption count an honest metric instead of a blind spot.
"""

import argparse
import os
import re
import sys
from pathlib import Path

EXEMPT_MARKER = "readonly-exempt:"

DEFAULT_REPO_ROOT = "D:/AgenticOS"
DEFAULT_TARGET = "monitoring/freecash"

# The six forbidden token classes.  Each entry is (label, compiled pattern).
# Every line of this tuple carries the exemption marker on purpose -- it is the
# scanner's own pattern table, and scanning it would be self-referential.
FORBIDDEN_PATTERNS = (
    ("http-verb", re.compile(r"\b(POST|PUT|PATCH|DELETE)\b", re.IGNORECASE)),  # readonly-exempt: scanner pattern table
    (
        "write-call-shape",
        re.compile(
            r"\.post\(|\.put\(|\.patch\(|\.delete\("  # readonly-exempt: scanner pattern table
            r"|requests\.post|requests\.put|requests\.patch|requests\.delete"  # readonly-exempt: scanner pattern table
            r"|axios\.post|axios\.put|axios\.patch|axios\.delete"  # readonly-exempt: scanner pattern table
            r"|fetch\([^)]*method:\s*[\"'](POST|PUT|PATCH|DELETE)"  # readonly-exempt: scanner pattern table
            r"|http\.client|urllib\.request\.urlopen|urlopen\(|socket\.socket\("  # readonly-exempt: scanner pattern table
            r"|curl\s+[^|]*-X\s*(POST|PUT|DELETE)"  # readonly-exempt: scanner pattern table
            r"|curl\s+[^|]*(-d|--data|--upload-file)",  # readonly-exempt: scanner pattern table
            re.IGNORECASE,
        ),
    ),
    (
        "earning-verb",
        re.compile(
            r"\b(claim|withdraw|withdrawal|cashout|cash_out|cash-out|redeem|payout"  # readonly-exempt: scanner pattern table
            r"|pay_out|transfer|wager|bet|spin|deposit|purchase|checkout)\b",  # readonly-exempt: scanner pattern table
            re.IGNORECASE,
        ),
    ),
    (
        "earning-action",
        re.compile(
            r"(submit_offer|complete_survey|complete_task|start_task|accept_offer"  # readonly-exempt: scanner pattern table
            r"|claim_reward|redeem_reward|request_payout)",  # readonly-exempt: scanner pattern table
            re.IGNORECASE,
        ),
    ),
    (
        "write-endpoint-path",
        re.compile(
            r"/(claim|withdraw|withdrawal|cashout|redeem|payout|transfer|bet|spin|deposit|checkout)\b"  # readonly-exempt: scanner pattern table
            r"|/offers/[^/]+/claim|/surveys/[^/]+/complete"  # readonly-exempt: scanner pattern table
            r"|/tasks/[^/]+/complete|/rewards/claim",  # readonly-exempt: scanner pattern table
            re.IGNORECASE,
        ),
    ),
    (
        "account-mutation",
        re.compile(
            r"(update_balance|set_balance|credit_account|debit_account)",  # readonly-exempt: scanner pattern table
            re.IGNORECASE,
        ),
    ),
)

SKIP_DIRS = {"__pycache__", ".git"}
SKIP_SUFFIXES = {".pyc", ".pyo", ".png", ".jpg", ".jpeg", ".gif", ".zip", ".exe", ".log"}


def iter_files(target: Path):
    if target.is_file():
        yield target
        return
    for root, dirs, names in os.walk(target):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for name in sorted(names):
            path = Path(root) / name
            if path.suffix.lower() in SKIP_SUFFIXES:
                continue
            yield path


def scan(target) -> dict:
    """Scan one target.  Returns counts plus every finding."""
    path = Path(target)
    result = {
        "target": str(path),
        "exists": path.exists(),
        "hits": 0,
        "exempt": 0,
        "findings": [],
        "exemptions": [],
    }
    if not path.exists():
        return result
    for file in iter_files(path):
        try:
            text = file.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        for lineno, line in enumerate(text.splitlines(), start=1):
            for label, pattern in FORBIDDEN_PATTERNS:
                if not pattern.search(line):
                    continue
                entry = {"label": label, "file": str(file), "line": lineno, "text": line.strip()}
                if EXEMPT_MARKER in line:
                    result["exempt"] += 1
                    result["exemptions"].append(entry)
                else:
                    result["hits"] += 1
                    result["findings"].append(entry)
    return result


def run(targets=None, stream=None) -> tuple:
    out = stream or sys.stdout
    err = sys.stderr
    targets = list(targets) if targets else [Path(default_root()) / DEFAULT_TARGET]
    results = [scan(t) for t in targets]
    hits = sum(r["hits"] for r in results)
    exempt = sum(r["exempt"] for r in results)
    missing = sum(1 for r in results if not r["exists"])
    for result in results:
        print("[verify_readonly] scanning: %s" % result["target"], file=out)
        if not result["exists"]:
            print(
                "[verify_readonly] TARGET MISSING: %s (nothing to scan - NOT a pass)" % result["target"],
                file=err,
            )
            continue
        for entry in result["findings"]:
            print(
                "  FORBIDDEN [%s] %s:%s: %s"
                % (entry["label"], entry["file"], entry["line"], entry["text"]),
                file=err,
            )
        for entry in result["exemptions"]:
            print(
                "  EXEMPT    [%s] %s:%s" % (entry["label"], entry["file"], entry["line"]),
                file=out,
            )
    print(
        "[verify_readonly] forbidden=%d exempt=%d missing_targets=%d" % (hits, exempt, missing),
        file=out,
    )
    if missing:
        print(
            "[verify_readonly] FAIL - target path did not exist; absence of evidence is "
            "not evidence of a read-only routine.",
            file=err,
        )
        return 2, results
    if hits:
        print(
            "[verify_readonly] FAIL - R2 violation: an earning/write action path exists in "
            "a read-only routine.",
            file=err,
        )
        return 1, results
    print("[verify_readonly] PASS - no unexempted write/earning token found.", file=out)
    return 0, results


def default_root() -> str:
    return os.environ.get("FREECASH_REPO_ROOT") or DEFAULT_REPO_ROOT


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(
        prog="verify_readonly.py",
        description="R2 static check: no earning action may exist in the routine source tree.",
    )
    parser.add_argument("targets", nargs="*", help="directories or files to scan")
    args = parser.parse_args(sys.argv[1:] if argv is None else argv)
    code, _results = run(args.targets)
    return code


if __name__ == "__main__":
    sys.exit(main())
