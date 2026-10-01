"""gate_allowlists.py -- S4 acceptance-bar gate.

Asserts that a given readonly_client.py carries EXACTLY the loopback-only,
read-only allowlists.  Exits non-zero, naming the rule TITLE, on any drift.

    exit 0  allowlists are exactly the loopback-only read allowlists
    exit 1  a violation was found (message names the rule title + the offending value)
    exit 2  target missing or not importable (absence of evidence is not a pass)

Usage:
    python gate_allowlists.py <path-to-readonly_client.py>

The gate is deliberately blunt: widening ALLOWED_HOSTS or ALLOWED_PATHS by one
entry is enough to fail it.
"""

import importlib.util
import sys
from pathlib import Path

RULE = "R1 (NO EARNING ACTION) -- the routine performs no write/earning action"

EXPECTED_METHODS = {"GET", "HEAD"}
EXPECTED_HOSTS = {"localhost", "127.0.0.1", "::1", "[::1]"}
EXPECTED_PATHS = (r"^/api/v1/status/metrics$", r"^/api/v1/status$")

LOOPBACK_OK = {"localhost", "127.0.0.1", "::1", "[::1]", "0000:0000:0000:0000:0000:0000:0000:0001"}
FORBIDDEN_HOST_TOKENS = ("freecash", "provider", "api.", ".com", ".io", ".net", ".org")


def load(path):
    spec = importlib.util.spec_from_file_location("target_readonly_client", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main(argv):
    if len(argv) != 2:
        print("usage: gate_allowlists.py <path-to-readonly_client.py>", file=sys.stderr)
        return 2
    target = Path(argv[1])
    if not target.is_file():
        print("[gate] TARGET MISSING: %s (NOT a pass)" % target, file=sys.stderr)
        return 2
    try:
        module = load(target)
    except Exception as exc:  # noqa: BLE001
        print("[gate] TARGET NOT IMPORTABLE: %s: %s (NOT a pass)" % (target, exc), file=sys.stderr)
        return 2

    findings = []

    methods = set(module.ALLOWED_METHODS)
    if methods != EXPECTED_METHODS:
        findings.append("methods drifted: %r (expected %r)" % (sorted(methods), sorted(EXPECTED_METHODS)))
    for bad in sorted(methods - EXPECTED_METHODS):
        findings.append("non-read method allowlisted: %r" % bad)

    hosts = set(module.ALLOWED_HOSTS)
    if hosts != EXPECTED_HOSTS:
        findings.append("hosts drifted: %r (expected %r)" % (sorted(hosts), sorted(EXPECTED_HOSTS)))
    for host in sorted(hosts):
        lowered = host.lower()
        if lowered not in LOOPBACK_OK:
            findings.append("non-loopback host allowlisted: %r" % host)
        if any(tok in lowered for tok in FORBIDDEN_HOST_TOKENS):
            findings.append("provider-looking host allowlisted: %r" % host)

    paths = tuple(p.pattern for p in module.ALLOWED_PATHS)
    if paths != EXPECTED_PATHS:
        findings.append("path allowlist drifted: %r (expected %r)" % (list(paths), list(EXPECTED_PATHS)))
    for pattern in paths:
        if pattern not in EXPECTED_PATHS:
            findings.append("unexpected path regex allowlisted: %r" % pattern)

    if getattr(module, "PROVIDER_ENDPOINT_UNKNOWN", None) is None:
        findings.append("PROVIDER_ENDPOINT_UNKNOWN literal was removed (the gap must stay greppable)")

    print("[gate] target: %s" % target)
    print("[gate] rule  : %s" % RULE)
    print("[gate] methods=%r hosts=%r paths=%r" % (sorted(methods), sorted(hosts), list(paths)))
    if findings:
        for finding in findings:
            print("  VIOLATION [%s] %s" % (RULE, finding), file=sys.stderr)
        print("[gate] FAIL: %d violation(s) against %s" % (len(findings), RULE), file=sys.stderr)
        return 1
    print("[gate] PASS: allowlists are exactly the loopback-only read allowlists for %s" % RULE)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
