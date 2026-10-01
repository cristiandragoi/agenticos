"""build_variants.py -- builds the negative-control (mutant) and repaired copies
used for the acceptance-bar RED/GREEN evidence.  Reads the shipped module
read-only; writes ONLY inside this stream dir."""

import io
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
SHIPPED = Path("D:/AgenticOS/monitoring/freecash/readonly_client.py")
text = io.open(SHIPPED, encoding="utf-8").read()

MUT = HERE / "mutants"
REP = HERE / "repaired"
MUT.mkdir(exist_ok=True)
REP.mkdir(exist_ok=True)

# --- mutant 1: widen the host allowlist to a real provider host -------------
old_hosts = 'ALLOWED_HOSTS = frozenset({"localhost", "127.0.0.1", "::1", "[::1]"})'
new_hosts = 'ALLOWED_HOSTS = frozenset({"localhost", "127.0.0.1", "::1", "[::1]", "api.freecash.com"})'
assert old_hosts in text, "host allowlist literal not found"
mutant = text.replace(old_hosts, new_hosts)

# --- and add an earning-shaped path regex ----------------------------------
old_paths = '    re.compile(r"^/api/v1/status$"),\n'
new_paths = '    re.compile(r"^/api/v1/status$"),\n    re.compile(r"^/api/v1/withdraw$"),\n'
assert old_paths in mutant, "status path literal not found"
mutant = mutant.replace(old_paths, new_paths)
(MUT / "allowlist_widened.py").write_text(mutant, encoding="utf-8")

# --- repaired: teach the audit hook the documented getaddrinfo shape -------
old_hook = """    if isinstance(first, tuple):
        address = first
    elif len(args) > 1 and isinstance(args[1], tuple):
        address = args[1]
    else:
        address = None
"""
new_hook = """    if isinstance(first, tuple):
        address = first
    elif len(args) > 1 and isinstance(args[1], tuple):
        address = args[1]
    elif isinstance(first, str):
        address = (first,)
    else:
        address = None
"""
assert old_hook in text, "audit hook block not found"
(REP / "readonly_client_hook_fixed.py").write_text(text.replace(old_hook, new_hook), encoding="utf-8")

print("wrote:", MUT / "allowlist_widened.py")
print("wrote:", REP / "readonly_client_hook_fixed.py")
