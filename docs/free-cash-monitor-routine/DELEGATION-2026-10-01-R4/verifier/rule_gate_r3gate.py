#!/usr/bin/env python3
"""rule_gate.py -- the Free Cash monitor rule gate, and its own falsification.

The four rules are the OPERATOR's, numbered as the operator states them:

    RULE 1  no automated earning action, ever.
    RULE 2  exactly one status check per operator-local calendar day.
    RULE 3  notify on earnings / account-status change.
    RULE 4  human approval before any external action, never auto-executed.

(The older design docs numbered the same four invariants differently --
read-only R2, once-a-day R1, notify R3, approval R4.  Every rule this gate
reports carries the operator's number; the legacy label is printed beside it so
no reader has to guess.)

Two independent layers per rule, and a rule only passes when both pass:

  * a STATIC layer -- AST checks over the whole package (not a single file, which
    is what made the previous attempt unprovable).  AST, not regex, so a comment
    or a docstring can never satisfy a check and a `readonly-exempt:` marker can
    never hide a real call site.
  * a RUNTIME layer -- detectors/ that import the package and drive it against a
    throwaway data root: two same-day runs, a four-day change sequence, a live
    loopback stub that records every byte of wire traffic, and the approval
    surface attacked with machine identities.

Fail-closed: an unparseable file, a missing detector, a detector that errors, or
a rule that produced too few checks all read as FAIL.  The gate cannot print a
green verdict for code that does not parse -- that is the whole point.

R3 PROVENANCE.  The four detectors' runtime layer, the AST check bodies and the
rule vocabulary are ported byte-for-byte from
``DELEGATION-2026-09-30/verifier/rule_gate.py`` (sha256 fca9b4a6...), which is
package-scoped and passes the unmutated package.  What R3 adds is closure of the
three adversarial mutants that survived that gate -- each one a *shape* the
literal scan could not see:

  * ``adv3-r4-getattr-exec`` -- an effect reached by ``getattr(os, "sys"+"tem")``.
    Closed by the dynamic-dispatch check (rule 1 and rule 4).
  * ``adv4-r1-conditional-backdoor`` -- ``"PO"+"ST"`` and ``"/"+"cash"+"out"``
    assembled at runtime behind an env flag.  Closed by constant folding over
    ``+`` / f-strings / ``"".join([...])`` / zero-arg helper returns (rule 1).
  * ``adv6-r1-new-socket-file`` -- a NEW module importing ``http.client``.  The
    old import scan only *rejected* a denylist, so an unpinned socket client was
    invisible.  Closed by transport confinement: every network-capable import in
    the package must be one of PINNED_IMPORTS (rule 1).

Every added check is a *shape* check, not a string match on the mutant: the fold
is over arbitrary expression trees, and the confinement check is over a module
vocabulary.  See CHECK-MAP.md for which layer closes which mutant.

Usage::

    py -3 rule_gate.py --package D:/AgenticOS/monitoring/freecash
    py -3 rule_gate.py --package <copy> --workdir <dir>     # gate any copy
    py -3 rule_gate.py --self-test                           # falsify the gate

`--self-test` copies the package once as a pristine control, then once per seeded
violation (a byte-exact edit of ONE anchored line in the copy), runs this same
gate against each copy with an identical command line, and requires:

    control  -> exit 0  (the unmutated copy passes)
    mutant N -> exit != 0 and rule N reports FAIL  (the gate PROVABLY fails)

Exit codes: 0 all four rules pass, 1 rule violation(s), 2 not verifiable
(unparseable target, missing detector, detector error, self-test failure).

Nothing here registers a scheduler, opens a non-loopback socket, sends a message,
touches a credential, or writes to the production state root; every routine run
uses a throwaway FREECASH_DATA_ROOT under the work directory.
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
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
DETECTOR_DIR = HERE / "detectors"
REPO_ROOT = HERE.parents[3]
DEFAULT_PACKAGE = REPO_ROOT / "monitoring" / "freecash"
PRODUCTION_ROOT = "D:/AgenticOS/data/freecash-monitor"

DETECTORS = {
    1: "detector_r1_earn.py",
    2: "detector_r2_daily.py",
    3: "detector_r3_notify.py",
    4: "detector_r4_approval.py",
}

RULE_TITLES = {
    1: "no automated earning action, ever",
    2: "exactly one status check per operator-local calendar day",
    3: "notify on earnings / account-status change",
    4: "human approval before any external action, never auto-executed",
}

LEGACY_LABEL = {1: "R2", 2: "R1", 3: "R3", 4: "R4"}

MIN_CHECKS_PER_RULE = 4

# --------------------------------------------------------------------------- rule 1 vocabulary

WRITE_VERBS = {"POST", "PUT", "PATCH", "DELETE"}
WRITE_CALL_NAMES = {"post", "put", "patch", "delete", "urlopen"}
EARNING_ACTION_CALLS = {
    "submit_offer",
    "complete_survey",
    "complete_task",
    "start_task",
    "accept_offer",
    "claim_reward",
    "redeem_reward",
    "request_payout",
    "claim",
    "withdraw",
    "cashout",
    "redeem",
    "payout",
    "deposit",
    "wager",
    "bet",
    "spin",
    "purchase",
    "checkout",
    "transfer",
}
FORBIDDEN_PATH_RE = re.compile(
    r"/(cashout|claim|withdraw|withdrawal|redeem|payout|deposit|checkout|transfer|wager|spin)(?![A-Za-z0-9_])",
    re.IGNORECASE,
)
FORBIDDEN_IMPORTS = {
    "requests",
    "httpx",
    "aiohttp",
    "socket",
    "paramiko",
    "ftplib",
    "smtplib",
    "urllib.request",
    "urllib.error",
    "pycurl",
}
PINNED_IMPORTS = {
    ("readonly_client.py", "http.client"): "the single socket library, used only inside _transport(); guarded by request()",
}
#: A file whose own job is to NAME forbidden tokens.  Its string constants are
#: the scanner's pattern table, so the string-literal path scan skips it -- by
#: name, in the open, and it is the only file ever skipped.
STRING_SCAN_SKIP = {"verify_readonly.py"}

#: Every external-effect call site in the routine, pinned by hand and reviewed.
#: A new one (or a moved one) fails Rule 4 until a human adds it here on purpose.
PINNED_EFFECTS = (
    ("readonly_client.py", "_transport", "HTTPConnection", "the routine's single socket site"),
    ("readonly_client.py", "_transport", "request", "conn.request() -- the one place a byte is sent"),
    ("notify.py", "_toast_send", "run", "Windows toast delivery (subprocess.run); a delivery path, not an action"),
    ("changedetect.py", "prune_old_artifacts", "unlink", "retention prune of snapshots / run logs (90d, 30d)"),
)
EFFECT_ATTRS = {
    "system",
    "popen",
    "execv",
    "execve",
    "execl",
    "execlp",
    "spawnv",
    "run",
    "call",
    "check_call",
    "check_output",
    "urlopen",
    "rmtree",
    "unlink",
    "remove",
    "rmdir",
    "move",
    "copy",
    "copy2",
    "request",
    "connect",
}
EFFECT_NAMES = {"HTTPConnection", "HTTPSConnection", "urlopen", "socket"}


# --------------------------------------------------------------------------- source model


class Source:
    """One parsed python file, with its raw text and a line lookup."""

    def __init__(self, path: Path, rel: str):
        self.path = path
        self.rel = rel
        self.text = path.read_text(encoding="utf-8", errors="replace")
        self.lines = self.text.splitlines()
        self.sha256 = hashlib.sha256(self.text.encode("utf-8")).hexdigest()
        self.tree = None
        self.parse_error = None
        try:
            self.tree = ast.parse(self.text, filename=str(path))
        except SyntaxError as exc:
            self.parse_error = exc

    def line(self, lineno: int) -> str:
        if 1 <= lineno <= len(self.lines):
            return self.lines[lineno - 1].strip()
        return ""

    def enclosing(self) -> dict:
        """Map every node id to the name of the function that contains it."""
        mapping = {}

        def visit(node, current):
            for child in ast.iter_child_nodes(node):
                name = current
                if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    name = child.name
                mapping[id(child)] = name
                visit(child, name)

        mapping[id(self.tree)] = "<module>"
        visit(self.tree, "<module>")
        return mapping


def load_package(package: Path):
    modules = []
    for path in sorted(package.glob("*.py")):
        modules.append(Source(path, path.name))
    return modules


def calls(tree):
    return [node for node in ast.walk(tree) if isinstance(node, ast.Call)]


def call_name(node):
    if not isinstance(node, ast.Call):
        return None
    func = node.func
    if isinstance(func, ast.Attribute):
        return func.attr
    if isinstance(func, ast.Name):
        return func.id
    return None


def iter_constants(node):
    for child in ast.walk(node):
        if isinstance(child, ast.Constant):
            yield child


def assigned_names(tree):
    """Yield (name, value_node, lineno) for simple and annotated assignments."""
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name):
                    yield target.id, node.value, node.lineno
        elif isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
            yield node.target.id, node.value, node.lineno


# --------------------------------------------------------------------------- constant folding
#
# R3 addition.  A literal scan can be defeated by assembling the string at
# runtime ("PO" + "ST", "".join(["PO","ST"]), a helper that only returns a
# fragment).  These helpers best-effort fold a *string expression* to its value
# so the rule checks see the assembled result, not the fragments.
#
# The word "best-effort" is load-bearing: a None return means "cannot be proven
# constant", never "safe".  Every check that uses folding also keeps its literal
# counterpart, so an unfolded evasion still has to get past the literal scan.

MAX_FOLD_DEPTH = 8


def fold_string(node, symbols=None, funcs=None, depth=0):
    """Fold a string expression.  Returns str, or None when it cannot be proven constant."""
    symbols = symbols or {}
    funcs = funcs or {}
    if node is None or depth > MAX_FOLD_DEPTH:
        return None
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    if isinstance(node, ast.Name):
        return symbols.get(node.id)
    if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Add):
        left = fold_string(node.left, symbols, funcs, depth + 1)
        right = fold_string(node.right, symbols, funcs, depth + 1)
        if left is None or right is None:
            return None
        return left + right
    if isinstance(node, ast.JoinedStr):  # f-string with only literal parts
        parts = []
        for value in node.values:
            if isinstance(value, ast.Constant) and isinstance(value.value, str):
                parts.append(value.value)
            else:
                return None
        return "".join(parts)
    if isinstance(node, ast.Call):
        func = node.func
        # a zero-argument function in this module whose single return folds
        if isinstance(func, ast.Name) and not node.args and not node.keywords and func.id in funcs:
            return fold_string(funcs[func.id], symbols, funcs, depth + 1)
        # "sep".join([...]) over foldable elements
        if isinstance(func, ast.Attribute) and func.attr == "join" and len(node.args) == 1:
            separator = fold_string(func.value, symbols, funcs, depth + 1)
            container = node.args[0]
            if separator is not None and isinstance(container, (ast.List, ast.Tuple)):
                parts = [fold_string(element, symbols, funcs, depth + 1) for element in container.elts]
                if all(part is not None for part in parts):
                    return separator.join(parts)
        return None
    return None


def build_symbols(tree):
    """Name -> folded string, for simple assignments, in source order."""
    symbols = {}
    ordered = [node for node in ast.walk(tree) if isinstance(node, (ast.Assign, ast.AnnAssign))]
    ordered.sort(key=lambda node: (node.lineno, node.col_offset))
    for node in ordered:
        value = fold_string(node.value, symbols, {}, 0)
        if value is None:
            continue
        targets = node.targets if isinstance(node, ast.Assign) else [node.target]
        for target in targets:
            if isinstance(target, ast.Name):
                symbols[target.id] = value
    return symbols


def build_function_returns(tree):
    """Zero-argument function name -> its single return-value node."""
    out = {}
    for node in ast.walk(tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        spec = node.args
        if spec.args or spec.posonlyargs or spec.kwonlyargs or spec.vararg or spec.kwarg:
            continue
        returns = [child for child in ast.walk(node) if isinstance(child, ast.Return)]
        if len(returns) == 1 and returns[0].value is not None:
            out[node.name] = returns[0].value
    return out


def folded_call_arguments(source):
    """(write-verb hits, assembled-forbidden-path hits) for one parsed module.

    A hit is recorded when an argument to *any* call folds to a write verb or to
    a forbidden earning path -- including a folded variable that is not the whole
    argument (``prefix + _p``) -- so obfuscation with a variable does not hide it.
    """
    tree = source.tree
    symbols = build_symbols(tree)
    funcs = build_function_returns(tree)
    write_hits = []
    path_hits = []
    for node in calls(tree):
        label = call_name(node) or "<expr>"
        for argument in list(node.args) + [keyword.value for keyword in node.keywords]:
            value = fold_string(argument, symbols, funcs)
            if value is not None:
                if value.strip().upper() in WRITE_VERBS:
                    write_hits.append(
                        "%s:%d: %s(%r) -- assembled write verb" % (source.rel, node.lineno, label, value)
                    )
                if FORBIDDEN_PATH_RE.search(value):
                    path_hits.append(
                        "%s:%d: %s(%r) -- assembled earning path" % (source.rel, node.lineno, label, value[:60])
                    )
            for inner in ast.walk(argument):
                if isinstance(inner, ast.Name) and inner.id in symbols and FORBIDDEN_PATH_RE.search(symbols[inner.id]):
                    path_hits.append(
                        "%s:%d: %r assembled into an argument of %s(...)"
                        % (source.rel, node.lineno, symbols[inner.id], label)
                    )
    return sorted(set(write_hits)), sorted(set(path_hits))


def dynamic_dispatch_sites(source):
    """Call sites that resolve their target at runtime.

    Covers a computed/effect-shaped ``getattr``/``setattr``, a bare builtin
    ``eval``/``exec``/``compile``/``__import__``, and a callee that is itself a
    call (``f(x)(y)``).  None of these can be pinned by name, so the gate treats
    them as unpinned external effects.  A plain ``getattr(obj, "constant")`` whose
    constant is not an effect name is *not* a site.
    """
    tree = source.tree
    symbols = build_symbols(tree)
    funcs = build_function_returns(tree)
    out = []
    for node in calls(tree):
        func = node.func
        if isinstance(func, ast.Call):
            out.append("%s:%d: dynamic callee -- %s" % (source.rel, node.lineno, source.line(node.lineno)))
            continue
        name = call_name(node)
        if isinstance(func, ast.Name) and name in {"eval", "exec", "compile", "__import__", "import_module"}:
            out.append("%s:%d: builtin %s() -- dynamic code / dynamic import" % (source.rel, node.lineno, name))
        if isinstance(func, ast.Name) and name in {"getattr", "setattr", "delattr"} and len(node.args) >= 2:
            attribute = node.args[1]
            resolved = fold_string(attribute, symbols, funcs)
            literal = isinstance(attribute, ast.Constant) and isinstance(attribute.value, str)
            if resolved is not None and (resolved in EFFECT_ATTRS or resolved in EFFECT_NAMES):
                out.append(
                    "%s:%d: %s() resolves external-effect name %r -- %s"
                    % (source.rel, node.lineno, name, resolved, source.line(node.lineno))
                )
            elif not literal:
                out.append(
                    "%s:%d: %s() with a computed attribute name -- %s"
                    % (source.rel, node.lineno, name, source.line(node.lineno))
                )
    return sorted(set(out))


#: Modules that can open a socket or send a byte.  The routine is allowed exactly
#: one such import, and PINNED_IMPORTS says where.  urllib.parse is deliberately
#: absent: it parses, it does not transport.
NETWORK_CLIENT_TOP = {
    "http",
    "socket",
    "socketserver",
    "ssl",
    "asyncio",
    "httplib",
    "requests",
    "httpx",
    "httpcore",
    "urllib3",
    "aiohttp",
    "websockets",
    "pycurl",
    "ftplib",
    "smtplib",
    "telnetlib",
    "xmlrpc",
}
NETWORK_CLIENT_FULL = {"urllib.request", "urllib.error"}


def is_network_client_module(module: str) -> bool:
    if module in NETWORK_CLIENT_FULL:
        return True
    return module.split(".")[0] in NETWORK_CLIENT_TOP


def network_imports(source):
    """Every import of a network-capable module: (rel, module, lineno, description)."""
    out = []
    for node in ast.walk(source.tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                if is_network_client_module(alias.name):
                    out.append((source.rel, alias.name, node.lineno, "import %s" % alias.name))
        elif isinstance(node, ast.ImportFrom):
            module = node.module or ""
            if is_network_client_module(module):
                out.append(
                    (
                        source.rel,
                        module,
                        node.lineno,
                        "from %s import %s" % (module, ",".join(alias.name for alias in node.names)),
                    )
                )
    return out


# --------------------------------------------------------------------------- check plumbing


class RuleReport:
    def __init__(self, number: int):
        self.number = number
        self.checks = []          # (name, ok, evidence)

    def add(self, name, ok, evidence):
        self.checks.append((name, bool(ok), str(evidence)))

    @property
    def ok(self):
        return bool(self.checks) and all(ok for _n, ok, _e in self.checks)

    @property
    def failed(self):
        return [name for name, ok, _e in self.checks if not ok]


# =========================================================================== G0


def gate_parse(report_lines, modules, all_files):
    """The gate can only report on code that parses.  Fail closed."""
    bad = []
    for source in all_files:
        if source.parse_error is not None:
            bad.append(source)
    if not bad:
        report_lines.append("  PASS  every .py file in the package parses (ast.parse)")
        report_lines.append(
            "        evidence: %d files parsed: %s"
            % (len(all_files), ", ".join(sorted(source.rel for source in all_files)))
        )
        return True
    for source in bad:
        err = source.parse_error
        report_lines.append("  FAIL  %s does not parse" % source.rel)
        report_lines.append(
            "        evidence: %s at line %s: %s | %r"
            % (type(err).__name__, err.lineno, err.msg, source.line(err.lineno or 1))
        )
    report_lines.append(
        "  FAIL  a green rule report for code that cannot run is not possible in this gate"
    )
    report_lines.append(
        "        evidence: %d of %d files failed to parse; no rule can be certified"
        % (len(bad), len(all_files))
    )
    return False


# =========================================================================== rule 1


def check_rule1_static(report: RuleReport, modules):
    write_verbs = []
    write_calls = []
    for source in modules:
        if source.tree is None:
            continue
        for node in calls(source.tree):
            name = call_name(node)
            if name in WRITE_CALL_NAMES:
                write_calls.append("%s:%d: %s(...)" % (source.rel, node.lineno, name))
            for arg in list(node.args) + [kw.value for kw in node.keywords]:
                for const in iter_constants(arg):
                    if isinstance(const.value, str) and const.value.strip().upper() in WRITE_VERBS:
                        write_verbs.append("%s:%d: %r" % (source.rel, node.lineno, const.value))
    report.add(
        "no HTTP write verb literal reaches any call",
        not write_verbs,
        "write-verb literals in call arguments: %s" % (write_verbs or "none"),
    )
    report.add(
        "no .post/.put/.patch/.delete/urlopen call site exists",
        not write_calls,
        "write-shaped call sites: %s" % (write_calls or "none"),
    )

    forbidden_paths = []
    for source in modules:
        if source.rel in STRING_SCAN_SKIP or source.tree is None:
            continue
        for const in iter_constants(source.tree):
            if isinstance(const.value, str) and FORBIDDEN_PATH_RE.search(const.value):
                forbidden_paths.append("%s:%d: %r" % (source.rel, const.lineno, const.value[:60]))
    report.add(
        "no earning/write endpoint path appears as a string literal",
        not forbidden_paths,
        "forbidden paths: %s (skipped, self-referential pattern table: %s)"
        % (forbidden_paths or "none", ", ".join(sorted(STRING_SCAN_SKIP))),
    )

    earning_calls = []
    for source in modules:
        if source.tree is None:
            continue
        for node in calls(source.tree):
            name = call_name(node)
            if name and name.lower() in EARNING_ACTION_CALLS:
                earning_calls.append("%s:%d: %s(...)" % (source.rel, node.lineno, name))
    report.add(
        "no earning-action call site exists",
        not earning_calls,
        "earning-action call sites: %s" % (earning_calls or "none"),
    )

    method_files = {}
    host_files = {}
    guard_sites = []
    for source in modules:
        if source.tree is None:
            continue
        for name, value, lineno in assigned_names(source.tree):
            if name == "ALLOWED_METHODS":
                method_files[source.rel] = (value, lineno)
            if name == "ALLOWED_HOSTS":
                host_files[source.rel] = (value, lineno)
        for node in ast.walk(source.tree):
            if isinstance(node, ast.Compare) and any(isinstance(op, ast.NotIn) for op in node.ops):
                for operand in [node.left] + list(node.comparators):
                    if isinstance(operand, ast.Name) and operand.id == "ALLOWED_METHODS":
                        guard_sites.append("%s:%d: %s" % (source.rel, node.lineno, source.line(node.lineno)))

    methods = set()
    method_evidence = "ALLOWED_METHODS not found"
    for rel, (value, lineno) in method_files.items():
        for const in iter_constants(value):
            if isinstance(const.value, str):
                methods.add(const.value.strip().upper())
        method_evidence = "%s:%d: %s" % (rel, lineno, "ALLOWED_METHODS = %s" % sorted(methods))
    report.add(
        "the method allowlist is exactly {GET, HEAD}",
        methods == {"GET", "HEAD"},
        method_evidence,
    )

    hosts = set()
    host_evidence = "ALLOWED_HOSTS not found"
    for rel, (value, lineno) in host_files.items():
        for const in iter_constants(value):
            if isinstance(const.value, str):
                hosts.add(const.value.strip().lower())
        host_evidence = "%s:%d: ALLOWED_HOSTS = %s" % (rel, lineno, sorted(hosts))
    report.add(
        "the host allowlist is loopback-only",
        bool(hosts) and hosts <= {"localhost", "127.0.0.1", "::1", "[::1]"},
        host_evidence,
    )
    report.add(
        "the allowlist is actually enforced by a guard (NotIn ALLOWED_METHODS -> raise)",
        bool(guard_sites),
        "guard sites: %s" % (guard_sites or "no method-allowlist guard found"),
    )

    forbidden_imports = []
    pinned_seen = []
    for source in modules:
        if source.tree is None:
            continue
        for node in ast.walk(source.tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    if alias.name in FORBIDDEN_IMPORTS:
                        forbidden_imports.append("%s:%d: import %s" % (source.rel, node.lineno, alias.name))
            elif isinstance(node, ast.ImportFrom):
                module = node.module or ""
                if module in FORBIDDEN_IMPORTS:
                    forbidden_imports.append("%s:%d: from %s import ..." % (source.rel, node.lineno, module))
                elif (source.rel, module) in PINNED_IMPORTS:
                    pinned_seen.append(
                        "%s:%d: from %s import ... -- pinned: %s"
                        % (source.rel, node.lineno, module, PINNED_IMPORTS[(source.rel, module)])
                    )
    report.add(
        "no un-pinned network client is imported",
        not forbidden_imports,
        "forbidden imports: %s | pinned: %s" % (forbidden_imports or "none", pinned_seen or "none"),
    )

    # ---- R3 additions: assembled fragments, transport confinement, dynamic dispatch
    assembled_verbs = []
    assembled_paths = []
    for source in modules:
        if source.tree is None:
            continue
        verb_hits, path_hits = folded_call_arguments(source)
        assembled_verbs.extend(verb_hits)
        # verify_readonly.py is the scanner's own pattern table; its regex literals
        # legitimately name earning paths, so only this string-shaped check skips it.
        if source.rel not in STRING_SCAN_SKIP:
            assembled_paths.extend(path_hits)
    report.add(
        "no write verb is assembled from fragments and passed to a call",
        not assembled_verbs,
        "assembled write verbs reaching a call: %s" % (sorted(assembled_verbs) or "none"),
    )
    report.add(
        "no earning/write endpoint path is assembled from fragments",
        not assembled_paths,
        "assembled forbidden paths reaching a call: %s" % (sorted(assembled_paths) or "none"),
    )

    # A superset of the two checks above: an effect-shaped string that is
    # *assembled anywhere* is suspicious whatever call shape finally carries it
    # (a method return, a default argument, a dict value).  Read-only code has no
    # legitimate reason to build a write verb or an earning path, so the shape is
    # a finding on its own.
    folded_effects = []
    for source in modules:
        if source.tree is None:
            continue
        symbols = build_symbols(source.tree)
        funcs = build_function_returns(source.tree)
        seen = set()
        for node in ast.walk(source.tree):
            if not isinstance(node, ast.expr):
                continue
            value = fold_string(node, symbols, funcs)
            if value is None:
                continue
            if value.strip().upper() in WRITE_VERBS:
                entry = "%s:%d: write verb %r" % (source.rel, node.lineno, value)
                if entry not in seen:
                    seen.add(entry)
                    folded_effects.append(entry)
            if source.rel not in STRING_SCAN_SKIP and FORBIDDEN_PATH_RE.search(value):
                entry = "%s:%d: earning path %r" % (source.rel, node.lineno, value[:60])
                if entry not in seen:
                    seen.add(entry)
                    folded_effects.append(entry)
    report.add(
        "no expression anywhere in the package folds to a write verb or an earning path",
        not folded_effects,
        "effect-shaped folded expressions: %s" % (sorted(folded_effects) or "none"),
    )

    imports = []
    for source in modules:
        if source.tree is None:
            continue
        imports.extend(network_imports(source))
    pinned_modules = set(PINNED_IMPORTS)
    unpinned_imports = [entry for entry in imports if (entry[0], entry[1]) not in pinned_modules]
    report.add(
        "the pinned transport is the only network-capable import in the package",
        bool(imports) and not unpinned_imports,
        "network imports: %s | pinned: %s | UNPINNED: %s"
        % (
            ["%s:%d %s" % (rel, line, text) for rel, _mod, line, text in imports] or "none",
            ["%s:%s" % pair for pair in sorted(pinned_modules)],
            ["%s:%d %s" % (rel, line, text) for rel, _mod, line, text in unpinned_imports] or "none",
        ),
    )
    report.add(
        "the transport is imported in exactly one module",
        len(imports) == 1,
        "network import sites: %d -- %s"
        % (len(imports), ["%s:%s" % (rel, mod) for rel, mod, _line, _text in imports] or "none"),
    )

    dynamic = []
    for source in modules:
        if source.tree is None:
            continue
        dynamic.extend(dynamic_dispatch_sites(source))
    report.add(
        "no dynamic dispatch site (eval/exec/__import__/computed getattr) exists",
        not dynamic,
        "dynamic dispatch sites: %s" % (sorted(dynamic) or "none"),
    )


# =========================================================================== rule 2


def check_rule2_static(report: RuleReport, modules):
    atomic = []
    day_key = []
    rolling = []
    for source in modules:
        if source.tree is None:
            continue
        for node in calls(source.tree):
            name = call_name(node)
            if name == "open":
                for arg in list(node.args) + [kw.value for kw in node.keywords]:
                    if isinstance(arg, ast.Constant) and arg.value == "x":
                        atomic.append("%s:%d: %s" % (source.rel, node.lineno, source.line(node.lineno)))
            if name == "mkdir":
                for kw in node.keywords:
                    if kw.arg == "exist_ok" and isinstance(kw.value, ast.Constant) and kw.value.value is False:
                        atomic.append("%s:%d: %s" % (source.rel, node.lineno, source.line(node.lineno)))
            flags_text = ast.dump(node)
            if name == "open" and "O_EXCL" in flags_text and "O_CREAT" in flags_text:
                atomic.append("%s:%d: %s" % (source.rel, node.lineno, source.line(node.lineno)))
            if name == "isoformat":
                inner = ast.dump(node.func)
                if "date" in inner:
                    day_key.append("%s:%d: %s" % (source.rel, node.lineno, source.line(node.lineno)))
            if name == "strftime":
                for arg in node.args:
                    if isinstance(arg, ast.Constant) and arg.value == "%Y-%m-%d":
                        day_key.append("%s:%d: %s" % (source.rel, node.lineno, source.line(node.lineno)))
        for node in ast.walk(source.tree):
            if isinstance(node, ast.Compare):
                operands = [node.left] + list(node.comparators)
                for operand in operands:
                    dump = ast.dump(operand)
                    if "timedelta" in dump or "'86400'" in dump or "86400" in dump:
                        rolling.append(
                            "%s:%d: %s" % (source.rel, node.lineno, source.line(node.lineno))
                        )
    report.add(
        "an atomic exclusive-create barrier exists in the package",
        bool(atomic),
        "atomic create sites: %s" % (atomic or "no O_CREAT|O_EXCL / 'x' mode / mkdir(exist_ok=False) found"),
    )
    report.add(
        "the day key is a calendar date (not a timestamp or a window)",
        bool(day_key),
        "calendar-day key sites: %s" % (day_key or "no date().isoformat() / strftime('%Y-%m-%d') found"),
    )
    report.add(
        "no rolling 24h window is used as the daily gate",
        not rolling,
        "rolling-window comparisons: %s" % (rolling or "none"),
    )

    entry = next((s for s in modules if s.tree is not None and _has_call(s.tree, "acquire_day_lock")), None)
    if entry is None:
        report.add("the entry point acquires a day lock", False, "no call to acquire_day_lock in the package")
    else:
        entry_fn = _enclosing_function(entry.tree, "acquire_day_lock")
        acquire_line = _call_line(entry.tree, "acquire_day_lock")
        read_line = _call_line(entry_fn, "read_source", bare_only=True) if entry_fn is not None else None
        report.add(
            "the day lock is acquired before the status read",
            acquire_line is not None and read_line is not None and acquire_line < read_line,
            "%s: acquire_day_lock at line %s, the entry point's own read_source call at line %s"
            % (entry.rel, acquire_line, read_line),
        )
        skip_body = _branch_without_call(entry.tree, "acquired", "read_source")
        report.add(
            "the duplicate-day branch performs no status read",
            skip_body is True,
            "%s: the `if not acquired:` branch %s"
            % (entry.rel, "contains no read_source call" if skip_body else "CONTAINS a read_source call"),
        )
        swallowed = _swallows_lock(entry.tree)
        report.add(
            "no exception handler turns a lock failure into a run",
            not swallowed,
            "handlers swallowing acquire_day_lock: %s" % (swallowed or "none"),
        )


def _has_call(tree, name):
    return any(call_name(node) == name for node in calls(tree))


def _call_line(tree, name, bare_only=False):
    lines = [
        node.lineno
        for node in calls(tree)
        if call_name(node) == name and (not bare_only or isinstance(node.func, ast.Name))
    ]
    return min(lines) if lines else None


def _enclosing_function(tree, call):
    """The FunctionDef that directly contains a call to *call*, or None."""
    for node in ast.walk(tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for child in node.body:
            if _has_call(child, call):
                return node
    return None


def _branch_without_call(tree, test_name, call):
    """True when the `if not <test_name>:` branch contains no <call>."""
    for node in ast.walk(tree):
        if not isinstance(node, ast.If):
            continue
        test = node.test
        if not (isinstance(test, ast.UnaryOp) and isinstance(test.op, ast.Not)):
            continue
        operand = test.operand
        if not (isinstance(operand, ast.Name) and operand.id == test_name):
            continue
        for child in node.body:
            if _has_call(child, call):
                return False
        return True
    return None


def _swallows_lock(tree):
    out = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Try):
            continue
        body_dump = "".join(ast.dump(child) for child in node.body)
        if "acquire_day_lock" not in body_dump:
            continue
        for handler in node.handlers:
            for child in ast.walk(handler):
                if isinstance(child, ast.Return) and isinstance(child.value, ast.Constant) and child.value.value in (0, True):
                    out.append("line %d returns %r" % (child.lineno, child.value.value))
                if isinstance(child, ast.Assign):
                    for target in child.targets:
                        if isinstance(target, ast.Name) and target.id == "acquired":
                            out.append("line %d sets acquired" % child.lineno)
    return out


# =========================================================================== rule 3


def check_rule3_static(report: RuleReport, modules):
    entry = next((s for s in modules if s.tree is not None and _has_call(s.tree, "load_prior_snapshot")), None)
    if entry is None:
        report.add("the prior snapshot is loaded before the new one is written", False, "no load_prior_snapshot call")
    else:
        load_line = _call_line(entry.tree, "load_prior_snapshot")
        save_line = _call_line(entry.tree, "save_snapshot")
        report.add(
            "the prior snapshot is loaded before the new one is written",
            load_line is not None and save_line is not None and load_line < save_line,
            "%s: load_prior_snapshot at line %s, save_snapshot at line %s" % (entry.rel, load_line, save_line),
        )

    compare_module = next((s for s in modules if s.tree is not None and any(
        isinstance(node, ast.FunctionDef) and node.name == "compare" for node in ast.walk(s.tree))), None)
    if compare_module is None:
        report.add("the comparison is exact (no threshold can swallow a change)", False, "no compare() function")
    else:
        exact = []
        floats = []
        for node in ast.walk(compare_module.tree):
            if isinstance(node, ast.Compare):
                for operand in [node.left] + list(node.comparators):
                    if isinstance(operand, ast.Constant) and isinstance(operand.value, float):
                        floats.append("%s:%d: %s" % (compare_module.rel, node.lineno, compare_module.line(node.lineno)))
                if any(isinstance(op, (ast.Eq, ast.NotEq)) for op in node.ops):
                    exact.append(node.lineno)
        report.add(
            "the comparison is exact equality, with no numeric threshold",
            bool(exact) and not floats,
            "%s: %d equality comparison sites (lines %s); float-threshold comparisons: %s"
            % (compare_module.rel, len(exact), exact[:6], floats or "none"),
        )

    key_module = next((s for s in modules if s.tree is not None and any(
        isinstance(node, ast.FunctionDef) and "dedupe" in node.name for node in ast.walk(s.tree))), None)
    if key_module is None:
        report.add("a per-change dedupe key exists", False, "no function with 'dedupe' in its name")
    else:
        sha = any(
            isinstance(node, (ast.Attribute, ast.Name)) and getattr(node, "attr", getattr(node, "id", "")) == "sha256"
            for node in ast.walk(key_module.tree)
        )
        report.add(
            "the dedupe key is a content hash of the change",
            sha,
            "%s: sha256 used inside the dedupe-key function" % key_module.rel,
        )

    dispatch_module = next((s for s in modules if s.tree is not None and any(
        isinstance(node, ast.FunctionDef) and node.name == "dispatch" for node in ast.walk(s.tree))), None)
    if dispatch_module is None:
        report.add("the dedupe key is persisted before the message is dispatched", False, "no dispatch() function")
    else:
        record_line = _call_line(dispatch_module.tree, "record_notified_key")
        send_line = min(
            [node.lineno for node in calls(dispatch_module.tree) if call_name(node) == "sender"]
            or [None]
        )
        report.add(
            "the dedupe key is persisted before the message is dispatched",
            record_line is not None and send_line is not None and record_line < send_line,
            "%s: record_notified_key at line %s, sender(...) at line %s"
            % (dispatch_module.rel, record_line, send_line),
        )


# =========================================================================== rule 4


def check_rule4_static(report: RuleReport, modules):
    queue = next(
        (
            s
            for s in modules
            if s.tree is not None
            and any(
                isinstance(node, ast.FunctionDef) and node.name == "decide" for node in ast.walk(s.tree)
            )
        ),
        None,
    )
    if queue is None:
        report.add("an approval queue with a human-only decide() exists", False, "no decide() function found")
    else:
        constants = {}
        for name, value, _lineno in assigned_names(queue.tree):
            if isinstance(value, ast.Constant):
                constants[name] = value.value
        has_states = {"PENDING", "APPROVED"} <= {
            str(v).upper() for k, v in constants.items() if k.startswith("STATUS")
        }
        non_human = constants.get("NON_HUMAN_DECIDERS")
        non_human_size = None
        for name, value, _lineno in assigned_names(queue.tree):
            if name == "NON_HUMAN_DECIDERS":
                non_human_size = len([c for c in iter_constants(value) if isinstance(c.value, str)])
        decide_fn = next(
            node for node in ast.walk(queue.tree) if isinstance(node, ast.FunctionDef) and node.name == "decide"
        )
        args = [a.arg for a in decide_fn.args.args]
        refusal_functions = {
            node.name
            for node in ast.walk(queue.tree)
            if isinstance(node, ast.FunctionDef)
            and any(
                isinstance(child, ast.Raise) and "NotHuman" in ast.dump(child.exc or child)
                for child in ast.walk(node)
            )
        }
        decide_calls = {call_name(child) for child in ast.walk(decide_fn)}
        reached = sorted(name for name in refusal_functions if name in decide_calls)
        report.add(
            "the approval queue defines a human decision path that can refuse",
            has_states and "by" in args and bool(non_human_size) and bool(reached),
            "%s: status constants=%s, decide() params=%s, NON_HUMAN_DECIDERS entries=%s, "
            "functions that raise NotHumanError=%s, decide() reaches=%s"
            % (queue.rel, sorted(k for k in constants if k.startswith("STATUS")), args, non_human_size,
               sorted(refusal_functions), reached),
        )

    frozen_state = []
    frozen_allowed = []
    allowed_fields = []
    frozen_expiry = []
    for source in modules:
        if source.tree is None:
            continue
        for name, value, lineno in assigned_names(source.tree):
            if "EXECUTION_STATE" in name and isinstance(value, ast.Constant):
                frozen_state.append((source.rel, lineno, value.value))
            if "EXECUTION_ALLOWED" in name.upper() and isinstance(value, ast.Constant):
                frozen_allowed.append((source.rel, lineno, value.value))
        for node in ast.walk(source.tree):
            if isinstance(node, ast.Dict):
                for key, value in zip(node.keys, node.values):
                    if isinstance(key, ast.Constant) and key.value == "expires_at_utc":
                        ok = (isinstance(value, ast.Constant) and value.value is None) or (
                            isinstance(value, ast.Name)
                            and any(
                                name == value.id and isinstance(v, ast.Constant) and v.value is None
                                for name, v, _l in assigned_names(source.tree)
                            )
                        )
                        frozen_expiry.append((source.rel, node.lineno, ok))
                    if isinstance(key, ast.Constant) and key.value == "execution_allowed_by_this_routine":
                        allowed = isinstance(value, ast.Constant) and value.value is False
                        if not allowed and isinstance(value, ast.Name):
                            allowed = any(
                                name == value.id and isinstance(v, ast.Constant) and v.value is False
                                for name, v, _l in assigned_names(source.tree)
                            )
                        allowed_fields.append((source.rel, node.lineno, allowed))
    report.add(
        "the only execution state the queue writes is NOT_EXECUTED",
        [v for _r, _l, v in frozen_state] == ["NOT_EXECUTED"],
        "EXECUTION_STATE constants: %s" % ([(r, l, v) for r, l, v in frozen_state] or "none"),
    )
    report.add(
        "execution is hard-coded as not allowed (constant False and every queue field false)",
        [v for _r, _l, v in frozen_allowed] == [False]
        and bool(allowed_fields)
        and all(ok for _r, _l, ok in allowed_fields),
        "execution-allowed constants: %s | queue fields: %s"
        % ([(r, l, v) for r, l, v in frozen_allowed] or "none",
           [(r, l, ok) for r, l, ok in allowed_fields] or "none"),
    )
    report.add(
        "every expires_at_utc field is null (no item can expire into a go-ahead)",
        bool(frozen_expiry) and all(ok for _r, _l, ok in frozen_expiry),
        "expires_at_utc fields: %s" % ([(r, l, ok) for r, l, ok in frozen_expiry] or "none"),
    )

    pinned = {(f, fn, name) for f, fn, name, _why in PINNED_EFFECTS}
    discovered = []
    for source in modules:
        if source.tree is None:
            continue
        for node in calls(source.tree):
            func = node.func
            name = None
            if isinstance(func, ast.Attribute) and func.attr in EFFECT_ATTRS:
                name = func.attr
            elif isinstance(func, ast.Name) and func.id in EFFECT_NAMES:
                name = func.id
            if name is None:
                continue
            enclosing = source.enclosing_map.get(id(node), "<module>") if hasattr(source, "enclosing_map") else None
            if enclosing is None:
                source.enclosing_map = source.enclosing()
                enclosing = source.enclosing_map.get(id(node), "<module>")
            discovered.append((source.rel, enclosing, name, node.lineno))
    unpinned = [entry for entry in discovered if (entry[0], entry[1], entry[2]) not in pinned]
    matched = sorted({"%s:%s:%s" % (e[0], e[1], e[2]) for e in discovered})
    report.add(
        "every external-effect call site in the package is pinned and reviewed",
        not unpinned,
        "pinned sites matched: %s | UNPINNED: %s"
        % (matched, ["%s:%d %s.%s" % (e[0], e[3], e[1], e[2]) for e in unpinned] or "none"),
    )

    # ---- R3 addition: an effect reached through dynamic dispatch cannot be pinned
    dynamic = []
    for source in modules:
        if source.tree is None:
            continue
        dynamic.extend(dynamic_dispatch_sites(source))
    report.add(
        "no external effect is reachable through dynamic dispatch",
        not dynamic,
        "dynamic dispatch sites: %s" % (sorted(dynamic) or "none"),
    )


# =========================================================================== runtime layer


def run_detector(number, package: Path, workdir: Path) -> tuple:
    """Run one detector in a child process.  Returns (ok, output)."""
    name = DETECTORS[number]
    path = DETECTOR_DIR / name
    if not path.exists():
        return False, "  FAIL  detector missing\n        evidence: %s does not exist" % path
    root = workdir / "runtime-roots" / ("rule%d" % number)
    if root.exists():
        shutil.rmtree(root, ignore_errors=True)
    root.mkdir(parents=True, exist_ok=True)
    if str(root).replace("\\", "/").lower() == PRODUCTION_ROOT.lower():
        return False, "  FAIL  refusing to run a detector against the production state root"
    env = dict(os.environ)
    env["FREECASH_DATA_ROOT"] = str(root)
    env["FREECASH_TZ"] = "Europe/Berlin"
    env["FREECASH_TOAST_STUB"] = "1"
    env["FREECASH_TOAST_RETRY_SLEEP_SECONDS"] = "0"
    env.pop("FREECASH_READ_BASE_URL", None)
    env.pop("FREECASH_READ_SOURCE", None)
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    try:
        process = subprocess.run(
            [sys.executable, str(path), "--package", str(package), "--root", str(root)],
            capture_output=True,
            text=True,
            env=env,
            cwd=str(workdir),
            timeout=600,
        )
    except subprocess.TimeoutExpired:
        return False, "  FAIL  %s timed out after 600s\n        evidence: fail closed" % name
    output = (process.stdout or "") + (process.stderr or "")
    printed = [line for line in output.splitlines() if line.startswith("DETECTOR-RESULT:")]
    expect = re.compile(r"rule=%d\s+PASS\b" % number)
    if process.returncode == 0 and printed and expect.search(printed[-1]):
        return True, output
    if not printed:
        output += "\n  FAIL  the detector did not report a result\n        evidence: exit=%d" % process.returncode
    elif process.returncode == 0:
        output += "\n  FAIL  the detector's reported result contradicts its exit code"
    elif process.returncode not in (1, 2):
        output += "\n  FAIL  the detector crashed (exit %d) -- fail closed" % process.returncode
    return False, output


def indented(text, prefix="  "):
    return "\n".join(prefix + line if line.strip() else line for line in text.splitlines())


# =========================================================================== the gate


def verify(package: Path, workdir: Path, runtime: bool = True) -> tuple:
    lines = []
    all_files = sorted(
        [Source(path, str(path.relative_to(package)).replace("\\", "/"))
         for path in package.rglob("*.py")
         if "__pycache__" not in path.parts],
        key=lambda s: (s.rel.count("/"), s.rel),
    )
    modules = [source for source in all_files if "/" not in source.rel]

    lines.append("-" * 78)
    lines.append("G0: the target can actually run (parse gate, whole package)")
    lines.append("-" * 78)
    parsed = gate_parse(lines, modules, all_files)
    if not parsed:
        lines.append("")
        lines.append("=" * 78)
        lines.append("SUMMARY: R1=NOT_VERIFIABLE  R2=NOT_VERIFIABLE  R3=NOT_VERIFIABLE  R4=NOT_VERIFIABLE")
        lines.append(
            "VERDICT: NOT VERIFIABLE -- the target does not parse; no rule can be certified"
        )
        lines.append("=" * 78)
        return 2, lines

    reports = {number: RuleReport(number) for number in (1, 2, 3, 4)}
    static_checks = {
        1: check_rule1_static,
        2: check_rule2_static,
        3: check_rule3_static,
        4: check_rule4_static,
    }
    for number in (1, 2, 3, 4):
        static_checks[number](reports[number], modules)

    for number in (1, 2, 3, 4):
        report = reports[number]
        lines.append("")
        lines.append("-" * 78)
        lines.append("RULE %d: %s   (legacy label %s)" % (number, RULE_TITLES[number], LEGACY_LABEL[number]))
        lines.append("-" * 78)
        lines.append("[static, AST over %d runtime module(s)]" % len(modules))
        for name, ok, evidence in report.checks:
            lines.append("  %s  %s" % ("PASS" if ok else "FAIL", name))
            lines.append("        evidence: %s" % evidence)
        if runtime:
            lines.append("[runtime, detectors/%s]" % DETECTORS[number])
            ok, output = run_detector(number, package, workdir)
            lines.append(indented(output))
            report.add(
                "the runtime detector passes",
                ok,
                "detectors/%s vs %s" % (DETECTORS[number], package),
            )
        if len(report.checks) < MIN_CHECKS_PER_RULE:
            report.add(
                "the rule produced enough independent checks to be meaningful",
                False,
                "only %d checks ran (minimum %d)" % (len(report.checks), MIN_CHECKS_PER_RULE),
            )
        lines.append("  >>> RULE %d RESULT: %s" % (number, "PASS" if report.ok else "FAIL"))

    summary = "  ".join(
        "R%d=%s" % (number, "PASS" if reports[number].ok else "FAIL") for number in (1, 2, 3, 4)
    )
    violated = [number for number in (1, 2, 3, 4) if not reports[number].ok]
    lines.append("")
    lines.append("=" * 78)
    lines.append("SUMMARY: %s" % summary)
    if violated:
        lines.append(
            "VERDICT: NOT COMPLIANT -- %d/4 operator rule(s) violated: %s"
            % (len(violated), ", ".join("R%d" % n for n in violated))
        )
        lines.append("=" * 78)
        return 1, lines
    lines.append(
        "VERDICT: COMPLIANT -- 4/4 operator rules enforced by %s"
        % ("an AST layer and a runtime layer" if runtime else "the AST layer only (--static-only: NOT a full certification)")
    )
    lines.append("=" * 78)
    return 0, lines


def production_audit(started: datetime) -> str:
    """Report the production root's newest write, and whether it predates this run."""
    root = Path(PRODUCTION_ROOT)
    if not root.exists():
        return "%s does not exist (nothing to audit)" % PRODUCTION_ROOT
    newest = None
    for base, _dirs, names in os.walk(root):
        for name in names:
            path = Path(base) / name
            try:
                stamp = datetime.fromtimestamp(path.stat().st_mtime, timezone.utc)
            except OSError:
                continue
            if newest is None or stamp > newest[0]:
                newest = (stamp, path)
    if newest is None:
        return "%s contains no files" % PRODUCTION_ROOT
    stamp, path = newest
    verdict = "PREDATES this run -- production state untouched by this verification" if stamp < started else "NEWER THAN THIS RUN -- investigate"
    return "%s newest file %s at %s ; %s" % (
        PRODUCTION_ROOT,
        path.relative_to(root),
        stamp.strftime("%Y-%m-%dT%H:%M:%SZ"),
        verdict,
    )


def header(package: Path, workdir: Path, runtime: bool) -> list:
    started = datetime.now(timezone.utc)
    lines = []
    lines.append("=" * 78)
    lines.append("freecash rule-gate  ::  AST layer + runtime layer, per operator rule 1-4")
    lines.append("=" * 78)
    lines.append("gate      : %s" % Path(__file__).resolve())
    lines.append("gate sha  : %s" % hashlib.sha256(Path(__file__).read_bytes()).hexdigest())
    lines.append("package   : %s" % package)
    lines.append("python    : %s (%s)" % (sys.executable, sys.version.split()[0]))
    lines.append("utc now   : %s" % started.strftime("%Y-%m-%dT%H:%M:%SZ"))
    lines.append("workdir   : %s" % workdir)
    lines.append("data roots: throwaway roots under <workdir>/runtime-roots, one per rule")
    lines.append("prod root : %s" % production_audit(started))
    lines.append("runtime   : %s" % ("on (detectors are executed)" if runtime else "OFF (static checks only)"))
    return lines


def print_hashes(package: Path, lines):
    lines.append("target sha256 (what this report is about):")
    for path in sorted(package.glob("*.py")):
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        lines.append("  %-22s %s" % (path.name, digest))


# =========================================================================== self-test

MUTATIONS = (
    {
        "id": "m0-syntax-annotation",
        "rule": 0,
        "file": "gate.py",
        "find": 'def tz_name() -> str:\n    return os.environ.get("FREECASH_TZ") or DEFAULT_TZ',
        "replace": 'def tz_name() str:  # MUTATION: TypeScript-style annotation in a .py file\n    return os.environ.get("FREECASH_TZ") or DEFAULT_TZ',
        "why": "the exact defect that made the shipped .mjs monitor certifiable: it does not parse",
    },
    {
        "id": "m1a-cashout-post-on-read-path",
        "rule": 1,
        "file": "readonly_client.py",
        "find": "    return (transport or _transport)(verb, url, timeout=timeout, headers=headers)",
        "replace": (
            '    if verb == "GET":  # MUTATION: an automated earning action next to the read\n'
            '        _transport("POST", url.rsplit("/", 1)[0] + "/cashout", timeout=timeout)\n'
            "    return (transport or _transport)(verb, url, timeout=timeout, headers=headers)"
        ),
        "why": "an automated earning action (POST /cashout) fired from the read path, bypassing the guard",
    },
    {
        "id": "m1b-method-allowlist-widened",
        "rule": 1,
        "file": "readonly_client.py",
        "find": 'ALLOWED_METHODS = frozenset({"GET", "HEAD"})',
        "replace": 'ALLOWED_METHODS = frozenset({"GET", "HEAD", "POST"})  # MUTATION: deny-by-default broken',
        "why": "deny-by-default transport widened to permit a write verb",
    },
    {
        "id": "m2a-day-lock-disabled",
        "rule": 2,
        "file": "run_daily_check.py",
        "find": "    acquired, lock = gate.acquire_day_lock(day)\n    if not acquired:",
        "replace": (
            '    lock = paths.day_locks_dir() / ("%s.lock" % day)\n'
            "    lock.parent.mkdir(parents=True, exist_ok=True)\n"
            "    acquired = True  # MUTATION: the day lock no longer denies anything\n"
            "    if not acquired:"
        ),
        "why": "two runs on the same operator-local day both perform the status read",
    },
    {
        "id": "m2b-lock-name-not-the-day",
        "rule": 2,
        "file": "gate.py",
        "find": "    lock = lock_path(day)\n    lock.parent.mkdir(parents=True, exist_ok=True)",
        "replace": (
            '    lock = lock_path(day + "-" + datetime.now(timezone.utc).strftime("%H%M%S%f"))'
            "  # MUTATION: the barrier is no longer derived from the day\n"
            "    lock.parent.mkdir(parents=True, exist_ok=True)"
        ),
        "why": "the exclusive-create barrier keys on a per-run nonce instead of the calendar day",
    },
    {
        "id": "m3a-notify-always",
        "rule": 3,
        "file": "notify.py",
        "find": '"""The log-only no-change line.  Never dispatches, whatever else happens."""\n    return alert(\n        "OK_NO_CHANGE",\n        day,\n        zero_notifications_message(prior_day, source_note),\n        severity=SEVERITY_INFO,\n        observed=observed,\n    )',
        "replace": (
            '"""The log-only no-change line.  Never dispatches, whatever else happens."""\n'
            "    _record = alert(\n"
            '        "OK_NO_CHANGE",\n'
            "        day,\n"
            "        zero_notifications_message(prior_day, source_note),\n"
            "        severity=SEVERITY_INFO,\n"
            "        observed=observed,\n"
            "    )\n"
            "    dispatch(  # MUTATION: notify the operator on a no-change day\n"
            "        zero_notifications_message(prior_day, source_note),\n"
            '        "nochange:%s" % day,\n'
            "        day,\n"
            '        "OK_NO_CHANGE",\n'
            "        sender=sender,\n"
            "    )\n"
            "    return _record"
        ),
        "why": "the routine notifies on a day where nothing changed (alarm fatigue; the rule is 'on change')",
    },
    {
        "id": "m3b-change-never-notified",
        "rule": 3,
        "file": "run_daily_check.py",
        "find": "    result = notify.notify_change(\n        day, change, message, key, sender=sender, sleep_seconds=sleep_seconds\n    )\n    return result",
        "replace": (
            "    notify.alert(  # MUTATION: the change is logged, the operator is never told\n"
            '        change["change_type"],\n'
            "        day,\n"
            "        message,\n"
            "        severity=notify.SEVERITY_INFO,\n"
            "        dedupe_key=key,\n"
            "        observed={\"suppressed\": True},\n"
            "    )\n"
            '    return "DEDUPED"'
        ),
        "why": "the earnings/status change is detected and logged but no notification is ever dispatched",
    },
    {
        "id": "m4a-queue-arms-itself",
        "rule": 4,
        "file": "approval_queue.py",
        "find": 'EXECUTION_STATE_NOT_EXECUTED = "NOT_EXECUTED"\nEXECUTION_ALLOWED_BY_THIS_ROUTINE = False',
        "replace": (
            'EXECUTION_STATE_NOT_EXECUTED = "EXECUTED"  # MUTATION: the queue claims execution\n'
            "EXECUTION_ALLOWED_BY_THIS_ROUTINE = True  # MUTATION: the routine may act"
        ),
        "why": "an approval item is armed: execution allowed and the state no longer NOT_EXECUTED",
    },
    {
        "id": "m4b-non-human-decider",
        "rule": 4,
        "file": "approval_queue.py",
        "find": 'NON_HUMAN_DECIDERS = frozenset(\n    {"system", "routine", "automation", "agent", "cron", "scheduler", "monitor", "bot", "script", "machine"}\n)',
        "replace": "NON_HUMAN_DECIDERS = frozenset()  # MUTATION: a machine identity may sign a decision",
        "why": "any string (including 'system') can sign an approval, so no human approval is required",
    },
    {
        "id": "m4c-approval-executes",
        "rule": 4,
        "file": "approval_queue.py",
        "find": "    save_document(doc, now=now)\n    paths.append_jsonl(",
        "replace": (
            "    save_document(doc, now=now)\n"
            "    if item[\"status\"] == STATUS_APPROVED:  # MUTATION: an approval becomes an action\n"
            "        import subprocess as _sp\n"
            "\n"
            "        _sp.run(\"echo EXECUTED-APPROVAL\", shell=True)\n"
            "    paths.append_jsonl("
        ),
        "why": "an approved item is auto-executed (a shell call reachable only through an approval)",
    },
)


def apply_mutation(package: Path, mutation: dict, target: Path) -> Path:
    """Copy *package* to *target* and apply ONE anchored replacement."""
    if target.exists():
        shutil.rmtree(target, ignore_errors=True)
    shutil.copytree(package, target, ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
    path = target / mutation["file"]
    text = path.read_text(encoding="utf-8")
    occurrences = text.count(mutation["find"])
    if occurrences != 1:
        raise SystemExit(
            "mutation %s: anchor matched %d times in %s (expected exactly 1)"
            % (mutation["id"], occurrences, mutation["file"])
        )
    path.write_text(text.replace(mutation["find"], mutation["replace"]), encoding="utf-8", newline="")
    return target


def run_gate_on(package: Path, workdir: Path, runtime=True):
    """Run THIS gate as a child process against *package*.  Returns (exit, output)."""
    process = subprocess.run(
        [sys.executable, str(Path(__file__).resolve()), "--package", str(package), "--workdir", str(workdir)]
        + ([] if runtime else ["--static-only"]),
        capture_output=True,
        text=True,
        timeout=1800,
    )
    return process.returncode, (process.stdout or "") + (process.stderr or "")


def rule_result(output, rule):
    pattern = re.compile(r">>> RULE %d RESULT: (\w+)" % rule)
    match = pattern.search(output)
    return match.group(1) if match else "MISSING"


def self_test(package: Path, workdir: Path):
    lines = []
    base = workdir / "self-test"
    base.mkdir(parents=True, exist_ok=True)
    lines.append("=" * 78)
    lines.append("freecash rule-gate SELF-TEST  ::  the gate must refuse to certify a seeded violation")
    lines.append("=" * 78)
    lines.append("package : %s" % package)
    lines.append("copies  : %s" % base)
    lines.append("python  : %s (%s)" % (sys.executable, sys.version.split()[0]))
    lines.append("")

    control_package = base / "control" / "pkg"
    if control_package.exists():
        shutil.rmtree(control_package, ignore_errors=True)
    control_package.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(package, control_package, ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
    control_exit, control_output = run_gate_on(control_package, base / "control" / "work")
    (base / "control").mkdir(parents=True, exist_ok=True)
    (base / "control" / "gate-output.txt").write_text(control_output, encoding="utf-8")
    lines.append("-" * 78)
    lines.append("CONTROL (unmutated copy -- the identical command the mutants get)")
    lines.append("-" * 78)
    lines.append("  copy      : %s" % control_package)
    lines.append("  exit      : %d" % control_exit)
    for rule in (1, 2, 3, 4):
        lines.append("  RULE %d    : %s" % (rule, rule_result(control_output, rule)))
    lines.append("  verdict   : %s" % next(
        (line for line in control_output.splitlines() if line.startswith("VERDICT:")), "<none>"))
    lines.append("")

    rows = []
    all_ok = control_exit == 0
    for mutation in MUTATIONS:
        target = base / mutation["id"] / "pkg"
        try:
            apply_mutation(package, mutation, target)
        except SystemExit as exc:
            lines.append("  ANCHOR ERROR for %s: %s" % (mutation["id"], exc))
            all_ok = False
            continue
        exit_code, output = run_gate_on(target, base / mutation["id"] / "work")
        (base / mutation["id"]).mkdir(parents=True, exist_ok=True)
        (base / mutation["id"] / "gate-output.txt").write_text(output, encoding="utf-8")
        rule = mutation["rule"]
        first_fail = next(
            (line.strip() for line in output.splitlines() if line.strip().startswith("FAIL")), "<none>"
        )
        if rule == 0:
            flagged = exit_code != 0 and "NOT VERIFIABLE" in output
            result = "NOT_VERIFIABLE" if "NOT VERIFIABLE" in output else "MISSING"
        else:
            result = rule_result(output, rule)
            flagged = exit_code != 0 and result == "FAIL"
        rows.append(
            {
                "id": mutation["id"],
                "rule": rule,
                "exit": exit_code,
                "result": result,
                "flagged": flagged,
                "first_fail": first_fail,
                "why": mutation["why"],
            }
        )
        lines.append("-" * 78)
        lines.append(
            "MUTANT %s  (rule %s: %s)" % (mutation["id"], rule or "G0", mutation["why"])
        )
        lines.append("-" * 78)
        lines.append("  copy      : %s" % target)
        lines.append("  mutation  : %s" % mutation["file"])
        lines.append("  exit      : %d   rule result: %s   flagged: %s" % (exit_code, result, flagged))
        lines.append("  first FAIL line: %s" % first_fail)
        lines.append("")
        if not flagged:
            all_ok = False

    lines.append("=" * 78)
    lines.append("SELF-TEST TABLE  (control exit %d, rule results %s)"
                 % (control_exit, [rule_result(control_output, r) for r in (1, 2, 3, 4)]))
    lines.append("=" * 78)
    lines.append("  %-32s %-5s %-5s %-14s %s" % ("mutation", "rule", "exit", "rule result", "flagged"))
    for row in rows:
        lines.append(
            "  %-32s %-5s %-5d %-14s %s"
            % (row["id"], row["rule"] or "G0", row["exit"], row["result"], "yes" if row["flagged"] else "NO")
        )
    covered = {row["rule"] for row in rows if row["flagged"]}
    lines.append("")
    missing = [rule for rule in (1, 2, 3, 4) if rule not in covered]
    if missing:
        lines.append("  INCOMPLETE: no flagged violation for rule(s) %s" % missing)
        all_ok = False
    else:
        lines.append("  PROVEN: every one of the 4 operator rules has >= 1 seeded violation the gate flags with a non-zero exit")
    if not any(row["flagged"] for row in rows if row["rule"] == 0):
        lines.append("  NOTE: no syntax mutant was flagged")
        all_ok = False
    lines.append("  control: unmutated copy exits %d with R1..R4 = %s"
                 % (control_exit, [rule_result(control_output, r) for r in (1, 2, 3, 4)]))
    lines.append("")
    lines.append("SELF-TEST VERDICT: %s" % ("PASS" if all_ok else "FAIL"))
    lines.append("=" * 78)
    return (0 if all_ok else 2), lines


# =========================================================================== main


def main(argv=None):
    parser = argparse.ArgumentParser(
        prog="rule_gate.py",
        description="Free Cash monitor rule gate (operator rules 1-4) with its own mutation self-test.",
    )
    parser.add_argument("--package", default=str(DEFAULT_PACKAGE), help="package directory to certify")
    parser.add_argument("--workdir", default=None, help="writable scratch dir (default: a temp dir)")
    parser.add_argument("--static-only", action="store_true", help="skip the runtime detectors")
    parser.add_argument("--self-test", action="store_true", help="falsify the gate with seeded violations")
    parser.add_argument("--keep-workdir", action="store_true", help="do not delete a temp workdir")
    args = parser.parse_args(sys.argv[1:] if argv is None else argv)

    package = Path(args.package).resolve()
    if not package.is_dir():
        print("FATAL: package directory not found: %s" % package)
        return 2

    created_temp = False
    if args.workdir:
        workdir = Path(args.workdir).resolve()
        workdir.mkdir(parents=True, exist_ok=True)
    else:
        workdir = Path(tempfile.mkdtemp(prefix="freecash-rule-gate-"))
        created_temp = True

    try:
        if args.self_test:
            code, lines = self_test(package, workdir)
        else:
            code, lines = verify(package, workdir, runtime=not args.static_only)
            lines = header(package, workdir, not args.static_only) + [""] + lines
            body = []
            print_hashes(package, body)
            # hash block goes right after the header
            insert_at = next((i for i, line in enumerate(lines) if line.startswith("---")), len(lines))
            lines = lines[:insert_at] + body + [""] + lines[insert_at:]
        print("\n".join(lines))
        return code
    finally:
        if created_temp and not args.keep_workdir:
            shutil.rmtree(workdir, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
