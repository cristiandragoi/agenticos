import os
import re
import glob
from datetime import datetime

ROOT = r"D:/AgenticOS/docs/free-cash-monitor-routine"

def first_heading(path):
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            for line in f:
                s = line.strip()
                if s.startswith("#"):
                    return s.lstrip("# ").strip()[:110]
    except Exception as e:
        return "ERR " + str(e)
    return "(no heading)"

print("=== TOP-LEVEL FILES (one line each) ===")
files = sorted(glob.glob(os.path.join(ROOT, "*.md")) + glob.glob(os.path.join(ROOT, "*.json")) + glob.glob(os.path.join(ROOT, "*.sh")))
for p in files:
    st = os.stat(p)
    print("%-72s %8d  %s  | %s" % (os.path.basename(p), st.st_size,
          datetime.fromtimestamp(st.st_mtime).strftime("%Y-%m-%d"), first_heading(p)))

print()
print("=== RULE-NUMBERING PROBE (R1/R2 definitions anywhere in the tree) ===")
pat = re.compile(r"R\s?[12]\b.{0,90}", re.IGNORECASE)
hits = {}
for p in glob.glob(os.path.join(ROOT, "**", "*.md"), recursive=True):
    try:
        txt = open(p, encoding="utf-8", errors="replace").read()
    except Exception:
        continue
    for m in re.finditer(r"[^\n]*\bR\s?[12]\b[^\n]*", txt):
        line = m.group(0).strip()
        low = line.lower()
        if any(k in low for k in ["once per", "one status read", "one check", "per day", "zero earning",
                                   "no earning", "only network path", "read-only", "read only",
                                   "exactly one", "at most one", "earning/withdraw", "earning action"]):
            hits.setdefault(os.path.relpath(p, ROOT), []).append(line[:160])

for k in sorted(hits):
    print("-- %s" % k)
    for line in hits[k][:6]:
        print("   ", line)
