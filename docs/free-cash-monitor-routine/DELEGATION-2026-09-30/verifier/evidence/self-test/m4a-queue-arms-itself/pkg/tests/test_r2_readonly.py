"""R2 -- zero automated earning actions (T2.1 - T2.3, plus the offline read-only capture).

The static checker is shown to **fail** on a deliberately injected violation
before its pass on the routine tree is trusted.
"""

import json
import re
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

import _support
from _support import ROUTINE_DIR, SHELL_CHECKER, StubSource, TempDataRoot

import paths
import readonly_client
import verify_readonly

METRICS_URL = "http://localhost:3001/api/v1/status/metrics"
STATUS_URL = "http://localhost:3001/api/v1/status"
PROVIDER_UNKNOWN = "PROVIDER_ENDPOINT_UNKNOWN - resolve in research phase"

#: The deliberate violation injected into a scratch copy of the tree.
INJECTED_VIOLATION = "requests.post('http://localhost:3001/api/v1/status/claim', json={})"  # readonly-exempt: negative-control payload for the checker (R2)

MODULE_FILES = (
    "paths.py",
    "gate.py",
    "readonly_client.py",
    "changedetect.py",
    "notify.py",
    "approval_queue.py",
    "watchdog.py",
    "verify_readonly.py",
    "run_daily_check.py",
    "operator_state.py",
)


def _inject(scratch, name="injected_probe.py"):
    target = Path(scratch) / name
    target.write_text(
        "# deliberate R2 violation injected by the negative-control test\n" + INJECTED_VIOLATION + "\n",
        encoding="utf-8",
    )
    return target


class StaticCheckerTests(unittest.TestCase):
    """T2.1 -- the CI check passes on the routine and fails on a planted violation."""

    def setUp(self):
        self._scratch = tempfile.mkdtemp(prefix="freecash-scratch-")
        self.addCleanup(shutil.rmtree, self._scratch, True)

    def _scratch_copy(self, name):
        scratch = Path(self._scratch) / name
        _support.copy_routine(scratch)
        probe = _inject(scratch)
        return scratch, probe

    def test_shipped_shell_checker_passes_on_the_routine_tree(self):
        if not shutil.which("bash"):
            self.skipTest("bash is not available")
        process = subprocess.run(
            ["bash", str(SHELL_CHECKER), str(ROUTINE_DIR)],
            capture_output=True,
            text=True,
        )
        self.assertEqual(process.returncode, 0, process.stdout + process.stderr)
        self.assertIn("forbidden=0", process.stdout)
        self.assertIn("PASS", process.stdout)

    def test_shipped_shell_checker_fails_on_a_planted_violation(self):
        if not shutil.which("bash"):
            self.skipTest("bash is not available")
        scratch, probe = self._scratch_copy("scratch-routine")
        process = subprocess.run(
            ["bash", str(SHELL_CHECKER), str(scratch)],
            capture_output=True,
            text=True,
        )
        self.assertNotEqual(process.returncode, 0, "a checker that cannot fail certifies nothing")
        self.assertIn("FORBIDDEN", process.stderr)
        self.assertIn("injected_probe.py", process.stderr)
        self.assertIn("%s:2" % probe.name, process.stderr.replace("\\", "/"))
        self.assertIn("forbidden=", process.stdout)

    def test_python_port_agrees_with_the_shell_checker(self):
        code, results = verify_readonly.run([ROUTINE_DIR])
        self.assertEqual(code, 0, results)
        scratch, _probe = self._scratch_copy("scratch-python")
        code, results = verify_readonly.run([scratch])
        self.assertEqual(code, 1)
        findings = results[0]["findings"]
        self.assertGreaterEqual(len(findings), 1)
        self.assertTrue(any("injected_probe.py" in f["file"] for f in findings), findings)
        self.assertGreaterEqual(len({f["label"] for f in findings}), 2, findings)
        self.assertEqual(findings[0]["line"], 2)

    def test_missing_target_is_not_a_pass(self):
        code, _results = verify_readonly.run([Path(self._scratch) / "does-not-exist"])
        self.assertEqual(code, 2)

    def test_no_provider_host_is_hardcoded_anywhere(self):
        pattern = re.compile(r"https?://([A-Za-z0-9._\-]+)")
        hosts = set()
        for name in MODULE_FILES:
            text = (ROUTINE_DIR / name).read_text(encoding="utf-8")
            hosts |= {match.group(1) for match in pattern.finditer(text)}
        self.assertTrue(hosts, "expected at least the loopback base URL")
        for host in hosts:
            self.assertIn(host, {"localhost", "127.0.0.1"}, "unexpected host hardcoded in the routine")
        for name in MODULE_FILES:
            text = (ROUTINE_DIR / name).read_text(encoding="utf-8")
            self.assertNotIn("freecash.com", text)

    def test_unresolved_provider_contract_keeps_its_literal(self):
        self.assertEqual(readonly_client.PROVIDER_ENDPOINT_UNKNOWN, PROVIDER_UNKNOWN)
        source = (ROUTINE_DIR / "readonly_client.py").read_text(encoding="utf-8")
        self.assertIn(PROVIDER_UNKNOWN, source)
        # The allowlist must not contain a provider path: only the two local read ops.
        allowlisted = [pattern.pattern for pattern in readonly_client.ALLOWED_PATHS]
        self.assertEqual(allowlisted, [r"^/api/v1/status/metrics$", r"^/api/v1/status$"])

    def _tmp(self):
        return Path(self._scratch)


class TransportGuardTests(unittest.TestCase):
    """T2.2 / T2.3 -- refusals happen before the only socket site is reached."""

    def setUp(self):
        self.calls = []

        def spy(method, url, timeout=None, headers=None):
            self.calls.append((method, url))
            return {"method": method, "url": url, "status": 200, "headers": {}, "body": b"{}"}

        self.spy = spy

    def test_write_method_is_refused_before_any_socket_opens(self):
        with TempDataRoot() as env:
            with self.assertRaises(readonly_client.ForbiddenWriteError):
                readonly_client.request("POST", METRICS_URL, transport=self.spy)  # readonly-exempt: negative control; the assertion is the refusal
            with self.assertRaises(readonly_client.ForbiddenWriteError):
                readonly_client.request("POST", METRICS_URL, json={}, transport=self.spy)  # readonly-exempt: negative control; body-carrying request must also be refused
            self.assertEqual(self.calls, [], "the transport was reached: a socket could have opened")
            self.assertFalse(paths.alerts_path().exists())

    def test_every_non_read_method_is_refused(self):
        with TempDataRoot():
            for method in ("PUT", "PATCH", "DELETE", "TRACE", "OPTIONS", "CONNECT"):  # readonly-exempt: negative controls, all must be refused
                with self.assertRaises(readonly_client.ForbiddenWriteError, msg=method):
                    readonly_client.request(method, METRICS_URL, transport=self.spy)
            self.assertEqual(self.calls, [])

    def test_non_allowlisted_path_is_refused(self):
        with TempDataRoot():
            for url in (
                "http://localhost:3001/api/v1/status/other",
                "http://localhost:3001/api/v1/status/metrics/extra",
                "http://localhost:3001/api/v1/status/claim",  # readonly-exempt: negative control path
                "http://localhost:3001/admin",
            ):
                with self.assertRaises(readonly_client.ForbiddenWriteError, msg=url):
                    readonly_client.request("GET", url, transport=self.spy)
            self.assertEqual(self.calls, [])

    def test_body_carrying_get_is_refused(self):
        with TempDataRoot():
            with self.assertRaises(readonly_client.ForbiddenWriteError):
                readonly_client.request("GET", METRICS_URL, data=b"x", transport=self.spy)
            with self.assertRaises(readonly_client.ForbiddenWriteError):
                readonly_client.request("GET", METRICS_URL, files={"f": b"x"}, transport=self.spy)
            with self.assertRaises(readonly_client.ForbiddenWriteError):
                readonly_client.request("GET", METRICS_URL, stream=b"x", transport=self.spy)
            self.assertEqual(self.calls, [])

    def test_non_loopback_host_is_refused(self):
        with TempDataRoot():
            with self.assertRaises(readonly_client.ForbiddenWriteError):
                readonly_client.request("GET", "http://provider.invalid/api/v1/status/metrics", transport=self.spy)
            with self.assertRaises(readonly_client.ForbiddenWriteError):
                readonly_client.request("GET", "file:///etc/passwd", transport=self.spy)
            self.assertEqual(self.calls, [])

    def test_allowlisted_get_is_allowed_through(self):
        with TempDataRoot():
            response = readonly_client.request("GET", METRICS_URL, transport=self.spy)
            self.assertEqual(response["status"], 200)
            self.assertEqual(self.calls, [("GET", METRICS_URL)])

    def test_audit_guard_refuses_a_non_loopback_connect(self):
        with self.assertRaises(readonly_client.ForbiddenWriteError):
            readonly_client._audit_hook("socket.connect", (None, ("provider.invalid", 443)))
        # Loopback and unrelated audit events must be left alone.
        readonly_client._audit_hook("socket.connect", (None, ("127.0.0.1", 3001)))
        readonly_client._audit_hook("open", ("C:/tmp/x", "r", 0))

    def test_bare_get_reaches_the_loopback_stub(self):
        with StubSource() as stub:
            response = readonly_client.request("GET", stub.base_url + "/api/v1/status/metrics")
            self.assertEqual(response["status"], 200)
            payload = json.loads(response["body"].decode("utf-8"))
            self.assertEqual(payload["earnings_total_cents"], 1025)
            self.assertEqual(stub.methods, ["GET"])


class ReadOnlyIntegrationTests(unittest.TestCase):
    """The whole cycle over the wire, with the server recording every verb it saw."""

    def test_entry_point_only_ever_sends_reads(self):
        with StubSource() as stub, TempDataRoot() as env:
            result = _support.run_entry_point(
                env=env.env(FREECASH_READ_SOURCE="metrics_http", FREECASH_READ_BASE_URL=stub.base_url)
            )
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertEqual(stub.methods, ["GET", "HEAD"], stub.records)
            self.assertEqual(sorted(stub.records), [("GET", "/api/v1/status/metrics"), ("HEAD", "/api/v1/status")])
            snapshot = json.loads((paths.snapshots_dir() / ("%s.json" % _support.ledger(env.root)["last_success_day"])).read_text(encoding="utf-8"))
            self.assertEqual(snapshot["source"]["kind"], "agenticos_local_metrics")
            self.assertEqual(snapshot["source"]["read_ops"], ["W1", "W2"])
            self.assertTrue(snapshot["degraded"])
            self.assertEqual(snapshot["earnings_total_cents"], 1025)

    def test_read_failure_is_loud_consumes_the_day_and_never_retries(self):
        with StubSource(metrics_status=500) as stub, TempDataRoot() as env:
            result = _support.run_entry_point(
                env=env.env(FREECASH_READ_SOURCE="metrics_http", FREECASH_READ_BASE_URL=stub.base_url)
            )
            self.assertEqual(result.returncode, 5, result.stdout + result.stderr)
            self.assertIn("RUN_FAILED", result.stdout)
            self.assertEqual(_support.snapshot_files(env.root), [])
            self.assertEqual(len(_support.day_locks(env.root)), 1)
            self.assertEqual(_support.ledger(env.root)["last_outcome"], "READ_FAILED")
            failure_lines = _support.events(env.root, "READ_FAILED") + _support.events(env.root, "RUN_FAILED")
            self.assertEqual(len(failure_lines), 1, [line["message"] for line in failure_lines])

            second = _support.run_entry_point(
                env=env.env(FREECASH_READ_SOURCE="metrics_http", FREECASH_READ_BASE_URL=stub.base_url)
            )
            self.assertEqual(second.returncode, 0)
            self.assertIn("SKIP_DUPLICATE_DAY", second.stdout)
            self.assertEqual(len(_support.events(env.root, "SKIP_DUPLICATE_DAY")), 1)

    def test_missing_field_in_the_payload_is_a_read_failure(self):
        payload = {"account_status": "ACTIVE", "earnings_total_cents": 1025, "balance_cents": 1025}
        with StubSource(payload=payload) as stub, TempDataRoot() as env:
            result = _support.run_entry_point(
                env=env.env(FREECASH_READ_SOURCE="metrics_http", FREECASH_READ_BASE_URL=stub.base_url)
            )
            self.assertEqual(result.returncode, 5, result.stdout + result.stderr)
            self.assertIn("pending_cents", result.stdout)


if __name__ == "__main__":
    unittest.main(verbosity=2)
