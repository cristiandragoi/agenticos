"""R3 Stream S probe: exercise the routine's real transport (readonly_client)
against the live host. READ-ONLY: GET only, loopback only, no bodies, no credential.
Writes nothing outside stdout. Data root is irrelevant to readonly_client.
"""
import sys

sys.path.insert(0, r"D:/AgenticOS/monitoring/freecash")
import readonly_client as rc

CASES = [
    ("W1 read_metrics base=4600 (allowlisted path, live server)", lambda: rc.read_metrics(base="http://localhost:4600")),
    ("W1 read_metrics base=3001 (default base, nothing listening)", lambda: rc.read_metrics(base="http://localhost:3001")),
    ("W2 probe_status base=4600", lambda: rc.probe_status(base="http://localhost:4600")),
    ("GET /api/health on 4600 (NOT allowlisted)", lambda: rc.request("GET", "http://localhost:4600/api/health")),
    ("GET /api/projects/proj-free-cash/freecash/auth on 4600 (NOT allowlisted)",
     lambda: rc.request("GET", "http://localhost:4600/api/projects/proj-free-cash/freecash/auth")),
    ("GET /api/v1/status/metrics on 3001 (allowlisted, conn refused)",
     lambda: rc.request("GET", "http://localhost:3001/api/v1/status/metrics")),
]

print("ALLOWED_METHODS =", sorted(rc.ALLOWED_METHODS))
print("ALLOWED_HOSTS   =", sorted(rc.ALLOWED_HOSTS))
print("ALLOWED_PATHS   =", [p.pattern for p in rc.ALLOWED_PATHS])
print("DEFAULT_BASE_URL=", rc.DEFAULT_BASE_URL)
print("METRICS_PATH    =", rc.METRICS_PATH)
print("STATUS_PATH     =", rc.STATUS_PATH)
print("-" * 70)
for label, fn in CASES:
    try:
        resp = fn()
        status = resp.get("status") if isinstance(resp, dict) else resp
        print("OK   | %-70s -> HTTP %s" % (label, status))
    except rc.ForbiddenWriteError as exc:
        print("BLOCK| %-70s -> ForbiddenWriteError: %s" % (label, exc))
    except rc.ReadError as exc:
        print("READERR| %-70s -> ReadError: %s" % (label, exc))
    except Exception as exc:  # noqa: BLE001
        print("ERR  | %-70s -> %s: %s" % (label, type(exc).__name__, exc))
