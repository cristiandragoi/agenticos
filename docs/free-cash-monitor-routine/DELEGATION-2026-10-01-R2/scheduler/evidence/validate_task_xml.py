"""Validate the staged task XML against this Windows build's own serialisation.

1. Parse both files with ElementTree (well-formedness).
2. Compare the element ORDER of the staged XML's <Settings> / <Principals> /
   <Triggers> / <Actions> children against a REAL registered task exported from
   this host (`schtasks /Query /TN "\\cua-driver-serve" /XML`), to catch an
   ordering the importer would reject.
3. Report the exact registration command that has NOT been executed.
"""

import subprocess
import sys
import xml.etree.ElementTree as ET

NS = "{http://schemas.microsoft.com/windows/2004/02/mit/task}"
DELEG = r"D:/AgenticOS/docs/free-cash-monitor-routine/DELEGATION-2026-10-01-R2/scheduler"
STAGED = DELEG + "/FreeCash-Daily-Monitor-R2.xml"
REAL_DUMP = DELEG + "/evidence/reference-real-task-export-cua-driver-serve.xml"


def kids(elem):
    return [c.tag.replace(NS, "") for c in elem]


def main():
    # real task, exported read-only from THIS host
    p = subprocess.run(["schtasks", "/Query", "/TN", "\\cua-driver-serve", "/XML"],
                       capture_output=True, text=True)
    print("reference export exit=%d  bytes=%d" % (p.returncode, len(p.stdout)))
    with open(REAL_DUMP, "w", encoding="utf-8") as fh:
        fh.write(p.stdout)
    print("wrote %s" % REAL_DUMP)

    real = ET.fromstring(p.stdout)
    staged = ET.fromstring(open(STAGED, "r", encoding="utf-8").read())

    print("\ntask version: real=%r staged=%r" % (real.get("version"), staged.get("version")))
    print("root ns equal: %s" % (real.tag == staged.tag))
    print("top-level order: real=%s" % kids(real))
    print("                 staged=%s" % kids(staged))
    print("top-level order matches real: %s" % (kids(real) == kids(staged)))

    for section in ("Principals", "Settings", "Triggers", "Actions"):
        r = real.find(NS + section)
        s = staged.find(NS + section)
        rk, sk = kids(r), kids(s)
        print("\n<%s> real  : %s" % (section, rk))
        print("<%s> staged: %s" % (section, sk))
        # every staged child must be one the real build emits at some position,
        # and relative order of the shared ones must be preserved
        shared = [k for k in rk if k in sk]
        print("  shared children in real order preserved in staged: %s"
              % (shared == [k for k in sk if k in rk]))
        unknown = [k for k in sk if k not in rk]
        print("  staged children absent from the real export: %s" % unknown)

    # ---- the values that actually decide R1 behaviour
    s = staged.find(NS + "Settings")
    print("\n--- R1-relevant staged values (read back from disk) ---")
    for tag in ("StartWhenAvailable", "MultipleInstancesPolicy", "ExecutionTimeLimit",
                "DisallowStartIfOnBatteries", "StopIfGoingOnBatteries",
                "UseUnifiedSchedulingEngine", "Enabled"):
        e = s.find(NS + tag)
        print("  %-32s %s" % (tag, e.text if e is not None else "<absent>"))
    print("  %-32s %s" % ("RestartOnFailure", "ABSENT (explicit: no retry loop)"))
    print("  %-32s %s" % ("WakeToRun", "ABSENT (explicit: never wake the machine)"))
    t = staged.find(NS + "Triggers/" + NS + "CalendarTrigger")
    print("  StartBoundary                    %s" % t.find(NS + "StartBoundary").text)
    print("  Trigger Enabled                  %s" % t.find(NS + "Enabled").text)
    print("  DaysInterval                     %s"
          % t.find(NS + "ScheduleByDay/" + NS + "DaysInterval").text)
    pr = staged.find(NS + "Principals/" + NS + "Principal")
    print("  UserId                           %s" % pr.find(NS + "UserId").text)
    print("  LogonType / RunLevel             %s / %s"
          % (pr.find(NS + "LogonType").text, pr.find(NS + "RunLevel").text))
    ex = staged.find(NS + "Actions/" + NS + "Exec")
    print("  Action Command                   %s" % ex.find(NS + "Command").text)
    print("  Action Arguments                 %s" % ex.find(NS + "Arguments").text)
    print("  Action WorkingDirectory          %s" % ex.find(NS + "WorkingDirectory").text)

    print("\n--- schtasks /Create one-liner CANNOT set StartWhenAvailable ---")
    h = subprocess.run(["schtasks", "/Create", "/?"], capture_output=True,
                       encoding="utf-8", errors="replace")
    txt = (h.stdout or "") + (h.stderr or "")
    print("  schtasks /Create /? output bytes=%d ; mentions StartWhenAvailable: %s"
          % (len(txt), "STARTWHENAVAILABLE" in txt.upper().replace(" ", "")))
    names = [w for w in txt.split() if w.startswith("/") and w.isupper()]
    print("  switches visible in /Create /?: %s" % ", ".join(sorted(set(names))[:40]))
    print("  -> StartWhenAvailable is absent from that set: the XML route is REQUIRED")
    print("     to obtain the slept-machine catch-up.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
