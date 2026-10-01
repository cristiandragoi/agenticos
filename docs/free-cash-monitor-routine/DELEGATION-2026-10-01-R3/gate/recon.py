#!/usr/bin/env python3
"""recon.py -- read-only reconnaissance over the clean package for the R3 gate build.

Prints: every import (module, name), every call whose callee is itself a call,
every getattr/setattr/eval/exec/__import__/importlib site, and every simple
assignment whose value folds to a string.  Nothing is written anywhere.
"""

import ast
import sys
from pathlib import Path

PACKAGE = Path(sys.argv[1] if len(sys.argv) > 1 else "D:/AgenticOS/monitoring/freecash")


def fold(node, symbols, depth=0):
    if depth > 8:
        return None
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    if isinstance(node, ast.Name):
        return symbols.get(node.id)
    if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Add):
        left = fold(node.left, symbols, depth + 1)
        right = fold(node.right, symbols, depth + 1)
        if left is not None and right is not None:
            return left + right
    return None


for path in sorted(PACKAGE.glob("*.py")):
    text = path.read_text(encoding="utf-8")
    tree = ast.parse(text)
    imports = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                imports.append("import %s" % alias.name)
        elif isinstance(node, ast.ImportFrom):
            imports.append("from %s import %s" % (node.module or ".", ",".join(a.name for a in node.names)))
    callee_calls = []
    dynamic = []
    assigns = []
    symbols = {}
    for node in sorted(ast.walk(tree), key=lambda n: getattr(n, "lineno", 0)):
        if isinstance(node, (ast.Assign, ast.AnnAssign)):
            value = node.value
            target = node.targets[0] if isinstance(node, ast.Assign) and node.targets else node.target
            if isinstance(target, ast.Name) and isinstance(value, ast.Constant) and isinstance(value.value, str):
                symbols[target.id] = value.value
                assigns.append("%d: %s = %r" % (node.lineno, target.id, value.value))
    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            if isinstance(node.func, ast.Call):
                callee_calls.append("%d: <call>(...)(...)" % node.lineno)
            func = node.func
            name = None
            if isinstance(func, ast.Name):
                name = func.id
            elif isinstance(func, ast.Attribute):
                name = func.attr
            if name in {"getattr", "setattr", "eval", "exec", "compile", "__import__", "import_module"}:
                dynamic.append("%d: %s(%s)" % (node.lineno, name, ", ".join(ast.dump(a) for a in node.args)[:120]))
    print("=== %s ===" % path.name)
    print("  imports: %s" % (imports or "<none>"))
    print("  call-callee-is-call: %s" % (callee_calls or "<none>"))
    print("  dynamic-name sites : %s" % (dynamic or "<none>"))
    print("  str assignments    : %d" % len(assigns))
