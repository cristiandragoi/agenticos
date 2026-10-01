import os
import glob
import re

ROOT = r"D:/AgenticOS/docs/free-cash-monitor-routine"

def abstract(path, n=260):
    try:
        lines = open(path, encoding="utf-8", errors="replace").read().splitlines()
    except Exception as e:
        return "ERR " + str(e)
    body = []
    for ln in lines:
        s = ln.strip()
        if not s or s.startswith("#") or s.startswith("|") or s.startswith("---") or s.startswith("**Repository"): 
            continue
        body.append(s)
        if sum(len(b) for b in body) >= n:
            break
    out = " ".join(body)
    return re.sub(r"\s+", " ", out)[:n]

files = sorted(glob.glob(os.path.join(ROOT, "*.md")))
for p in files:
    print("### %s" % os.path.basename(p))
    print("    " + abstract(p))
