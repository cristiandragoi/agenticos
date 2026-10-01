"""check_audit_hook.py -- S4 layer-B detector.

The shipped readonly_client.py docstring claims the audit hook "aborts a
connect/getaddrinfo aimed anywhere but the loopback allowlist".  This detector
calls ``_audit_hook`` with the CPython-documented argument shape of BOTH events
and requires BOTH to raise ForbiddenWriteError.

    exit 0  both socket.connect and socket.getaddrinfo are aborted
    exit 1  at least one documented event shape is NOT aborted (defect)
    exit 2  target missing / not importable

Usage:
    python check_audit_hook.py <path-to-readonly_client.py>
"""

import importlib.util
import sys
from pathlib import Path

RULE = "R1 (NO EARNING ACTION) -- the routine performs no write/earning action"

CONNECT_NONLOOPBACK = ("socket.connect", (None, ("provider.invalid", 443)))
CONNECT_LOOPBACK = ("socket.connect", (None, ("127.0.0.1", 3001)))
GETADDRINFO_NONLOOPBACK = ("socket.getaddrinfo", ("provider.invalid", 443, 0, 1, 0))
GETADDRINFO_LOOPBACK = ("socket.getaddrinfo", ("127.0.0.1", 3001, 0, 1, 0))


def load(path):
    spec = importlib.util.spec_from_file_location("target_readonly_client", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def raises(module, event, args):
    try:
        module._audit_hook(event, args)
    except module.ForbiddenWriteError:
        return True
    except Exception:  # noqa: BLE001
        return False
    return False


def ignores(module, event, args):
    try:
        module._audit_hook(event, args)
    except Exception:  # noqa: BLE001
        return False
    return True


def main(argv):
    if len(argv) != 2:
        print("usage: check_audit_hook.py <path-to-readonly_client.py>", file=sys.stderr)
        return 2
    target = Path(argv[1])
    if not target.is_file():
        print("[hook] TARGET MISSING: %s (NOT a pass)" % target, file=sys.stderr)
        return 2
    module = load(target)

    findings = []
    if not raises(module, *CONNECT_NONLOOPBACK):
        findings.append("socket.connect to non-loopback host is NOT aborted")
    if not raises(module, *GETADDRINFO_NONLOOPBACK):
        findings.append("socket.getaddrinfo for non-loopback host is NOT aborted "
                        "(args[0] is a str; the hook only accepts a tuple)")
    if not ignores(module, *CONNECT_LOOPBACK):
        findings.append("socket.connect to loopback is aborted (false positive)")
    if not ignores(module, *GETADDRINFO_LOOPBACK):
        findings.append("socket.getaddrinfo for loopback is aborted (false positive)")

    print("[hook] target: %s" % target)
    print("[hook] rule  : %s" % RULE)
    print("[hook] connect(nonloopback)    raises ForbiddenWriteError: %s" % raises(module, *CONNECT_NONLOOPBACK))
    print("[hook] getaddrinfo(nonloopback) raises ForbiddenWriteError: %s" % raises(module, *GETADDRINFO_NONLOOPBACK))
    print("[hook] connect(loopback)        ignored: %s" % ignores(module, *CONNECT_LOOPBACK))
    print("[hook] getaddrinfo(loopback)    ignored: %s" % ignores(module, *GETADDRINFO_LOOPBACK))
    if findings:
        for finding in findings:
            print("  DEFECT [%s] %s" % (RULE, finding), file=sys.stderr)
        print("[hook] FAIL: %d layer-B defect(s)" % len(findings), file=sys.stderr)
        return 1
    print("[hook] PASS: both documented connect/getaddrinfo shapes are aborted")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
