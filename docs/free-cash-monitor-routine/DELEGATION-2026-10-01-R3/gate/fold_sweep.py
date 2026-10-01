#!/usr/bin/env python3
"""fold_sweep.py -- reconnaissance: every expression in a package that folds to a
write verb or to a forbidden earning path.  Read-only; used to size the global
"no expression folds to an effect-shaped string" check before adding it.
"""

import ast
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import rule_gate as rg  # noqa: E402


def sweep(package):
    findings = []
    for path in sorted(Path(package).glob("*.py")):
        text = path.read_text(encoding="utf-8", errors="replace")
        try:
            tree = ast.parse(text)
        except SyntaxError as exc:
            findings.append((path.name, 0, "PARSE ERROR %s" % exc))
            continue
        symbols = rg.build_symbols(tree)
        funcs = rg.build_function_returns(tree)
        seen = set()
        for node in ast.walk(tree):
            if not isinstance(node, ast.expr):
                continue
            value = rg.fold_string(node, symbols, funcs)
            if value is None:
                continue
            if value.strip().upper() in rg.WRITE_VERBS:
                key = ("verb", value)
                if key not in seen:
                    seen.add(key)
                    findings.append((path.name, node.lineno, "WRITE VERB %r" % value))
            if rg.FORBIDDEN_PATH_RE.search(value):
                key = ("path", value[:40])
                if key not in seen:
                    seen.add(key)
                    findings.append((path.name, node.lineno, "EARNING PATH %r" % value[:70]))
    return findings


if __name__ == "__main__":
    for package in sys.argv[1:]:
        print("=== %s ===" % package)
        rows = sweep(package)
        for rel, lineno, what in rows:
            print("  %s:%d %s" % (rel, lineno, what))
        if not rows:
            print("  <nothing folds to a write verb or an earning path>")
