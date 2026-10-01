#!/usr/bin/env python
"""xml_gate.py -- observe-only gate for the FreeCash scheduled-task definition.

Stream S5 (scheduler), delegation R4, 2026-10-01.

WHAT IT CERTIFIES
  The task XML handed to this gate defines an OBSERVE-ONLY task:

  R1 NO EARNING ACTION ............ the single action runs one script and carries
                                    no earning/withdraw/claim verb
  R2 ONCE PER DAY ................. one daily CalendarTrigger, DaysInterval 1,
                                    IgnoreNew so triggers can never stack
  R3 NOTIFY ON CHANGE ............. not asserted here (it is a property of the
                                    routine, not of the schedule); this gate only
                                    refuses to allow a schedule that would
                                    suppress or multiply the reading
  R4 APPROVAL BEFORE EXTERNAL ..... the file registers nothing by itself and
      ACTION                        contains no self-registration/self-approval
                                    directive

  Exit 0 only when every check passes. On violation it exits non-zero and names
  the rule TITLE plus the offending evidence, never a bare R-number: the shipped
  code inverts R1/R2 (gate.py:1 calls once-per-day "R1").

USAGE
  python xml_gate.py <task.xml> [--today YYYY-MM-DD]
"""
import argparse
import datetime
import os
import re
import sys
import xml.etree.ElementTree as ET

NS = "{http://schemas.microsoft.com/windows/2004/02/mit/task}"

PINNED_PYTHON = r"C:\Users\cd-pr\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe"
ALLOWED_COMMAND = r"C:\Windows\System32\cmd.exe"
ALLOWED_SCRIPT = r"D:\AgenticOS\monitoring\freecash\run_daily_check.py"
ALLOWED_WORKDIR = r"D:\AgenticOS"

# Verbs that would mean the schedule can reach a write/earning/approval path.
FORBIDDEN_TOKENS = [
    "post", "put", "patch", "delete", "withdraw", "withdrawal", "cashout",
    "cash_out", "cash-out", "redeem", "payout", "deposit", "claim",
    "os.system", "subprocess", "curl", "wget", "invoke-webrequest",
]
FORBIDDEN_LITERALS = ["--force-recheck", "http://", "https://"]
# Shell chaining that would let one Exec become several commands.
CHAIN_OPERATORS = ["&&", "||", ";", "^", "\n", "`"]
REDIRECTION = "2>&1"  # the single tolerated ampersand, from the stderr redirect


class Violation(Exception):
    pass


def q(text, rule):
    raise Violation("%s :: %s" % (rule, text))


def _flat_text(root):
    """Every text node and attribute value in the document."""
    out = []
    for node in root.iter():
        if node.text:
            out.append(node.text)
        if node.tail:
            out.append(node.tail)
        for value in node.attrib.values():
            out.append(value)
    return "\n".join(out)


def check(path, today):
    """Return the loaded root. Raise Violation on the first breach."""
    raw = open(path, "rb").read()
    raw_text = raw.decode("utf-8", "replace")
    raw_lower = raw_text.lower()

    # 0. XML forbids a double hyphen inside a comment, and expat reports it only as
    #    "invalid token". Name the trap instead: this exact defect was found in the
    #    first draft of the artifact this gate certifies.
    for match in re.finditer(rb"<!--(.*?)-->", raw, re.S):
        if b"--" in match.group(1):
            q("illegal '--' inside an XML comment (byte offset %d): expat rejects a "
              "double hyphen inside a comment" % match.start(),
              "R4 APPROVAL BEFORE EXTERNAL ACTION")

    # 1. well-formed, and the expected schema namespace
    try:
        root = ET.fromstring(raw)
    except ET.ParseError as exc:
        q("not well-formed XML: %s" % exc, "R4 APPROVAL BEFORE EXTERNAL ACTION")
    if root.tag != NS + "Task":
        q("root element is %r, expected the Task Scheduler Task namespace" % root.tag,
          "R4 APPROVAL BEFORE EXTERNAL ACTION")
    if root.get("version") is None:
        q("<Task> carries no version attribute", "R4 APPROVAL BEFORE EXTERNAL ACTION")

    # 2. forbidden verbs anywhere in the document (text + attributes)
    haystack = _flat_text(root).lower()
    for token in FORBIDDEN_TOKENS:
        if re.search(r"(?<![a-z0-9_.])%s(?![a-z0-9_])" % re.escape(token), haystack):
            q("forbidden token %r present in the task definition" % token,
              "R1 NO EARNING ACTION")
    for literal in FORBIDDEN_LITERALS:
        if literal.lower() in haystack:
            q("forbidden literal %r present in the task definition" % literal,
              "R1 NO EARNING ACTION")

    # 2b. the same scan over the RAW file text, so a token hidden in a comment
    #     (which ElementTree drops from the tree) is still refused. The schema
    #     namespace URI is removed first: it is a declaration, not a fetch.
    raw_scan = raw_lower.replace("http://schemas.microsoft.com/windows/2004/02/mit/task", "")
    for token in FORBIDDEN_TOKENS:
        if re.search(r"(?<![a-z0-9_.])%s(?![a-z0-9_])" % re.escape(token), raw_scan):
            q("forbidden token %r present in the raw file text, including comments"
              % token, "R1 NO EARNING ACTION")
    for literal in FORBIDDEN_LITERALS:
        if literal.lower() in raw_scan:
            q("forbidden literal %r present in the raw file text, including comments"
              % literal, "R1 NO EARNING ACTION")

    # 3. exactly one Exec, and no other kind of action
    actions = root.find(NS + "Actions")
    if actions is None:
        q("<Actions> missing", "R2 ONCE PER DAY")
    execs = actions.findall(NS + "Exec")
    if len(execs) != 1:
        q("found %d <Exec> actions, exactly 1 permitted (the day read must not be "
          "multiplied or joined by a second command)" % len(execs), "R2 ONCE PER DAY")
    if len(list(actions)) != 1:
        q("<Actions> carries %d child elements, only the single <Exec> is permitted"
          % len(list(actions)), "R2 ONCE PER DAY")

    exe = execs[0]
    command = (exe.findtext(NS + "Command") or "").strip()
    arguments = (exe.findtext(NS + "Arguments") or "").strip()
    workdir = (exe.findtext(NS + "WorkingDirectory") or "").strip()

    # 4. the launcher is cmd.exe and nothing else
    if command != ALLOWED_COMMAND:
        q("<Command> is %r, expected the pinned %r" % (command, ALLOWED_COMMAND),
          "R1 NO EARNING ACTION")

    # 5. the interpreter is the tzdata-capable venv python, never python3/py
    if PINNED_PYTHON not in arguments:
        q("<Arguments> does not name the pinned interpreter %r" % PINNED_PYTHON,
          "R2 ONCE PER DAY")
    for forbidden_interp in ("python3", "pythonw", "py -3", " py "):
        if forbidden_interp in arguments.lower().replace(PINNED_PYTHON.lower(), ""):
            q("<Arguments> also names the non-tzdata interpreter %r"
              % forbidden_interp, "R2 ONCE PER DAY")

    # 6. no shell chaining beyond the single stderr redirect
    stripped = arguments.replace(REDIRECTION, "")
    for op in CHAIN_OPERATORS:
        if op in stripped:
            q("shell chaining operator %r in <Arguments>: %s"
              % (op, arguments), "R2 ONCE PER DAY")
    if "&" in stripped:
        q("unescaped/extra ampersand in <Arguments>: %s" % arguments,
          "R2 ONCE PER DAY")

    # 7. exactly one script, and it is the canonical entry point
    scripts = re.findall(r"[A-Za-z]:\\[^\s]+\.py", arguments)
    if scripts != [ALLOWED_SCRIPT]:
        q("<Arguments> names scripts %r, exactly [%r] permitted" % (scripts, ALLOWED_SCRIPT),
          "R1 NO EARNING ACTION")

    # 8. working directory is the repo root
    if workdir != ALLOWED_WORKDIR:
        q("<WorkingDirectory> is %r, expected %r" % (workdir, ALLOWED_WORKDIR),
          "R2 ONCE PER DAY")

    # 9. one daily calendar trigger
    triggers = root.find(NS + "Triggers")
    if triggers is None or len(list(triggers)) != 1:
        q("expected exactly 1 trigger", "R2 ONCE PER DAY")
    trig = list(triggers)[0]
    if trig.tag != NS + "CalendarTrigger":
        q("trigger is %r, expected CalendarTrigger" % trig.tag, "R2 ONCE PER DAY")
    byday = trig.find(NS + "ScheduleByDay")
    if byday is None or (byday.findtext(NS + "DaysInterval") or "").strip() != "1":
        q("<ScheduleByDay><DaysInterval> is %r, expected 1 so every day is covered"
          % (byday is not None and byday.findtext(NS + "DaysInterval")),
          "R2 ONCE PER DAY")

    # 10. start boundary must not be in the past: a past boundary plus
    #     StartWhenAvailable=true fires a catch-up run at registration, and the
    #     entry point takes the day lock (run_daily_check.py:309) before it reads
    #     the source (:372), so that catch-up burns the day having read nothing.
    boundary = (trig.findtext(NS + "StartBoundary") or "").strip()
    try:
        boundary_day = datetime.date.fromisoformat(boundary[:10])
    except ValueError:
        q("<StartBoundary> %r is not an ISO date" % boundary, "R2 ONCE PER DAY")
    if boundary_day <= today:
        q("<StartBoundary> %s is not after %s: registering now would fire a "
          "catch-up run that consumes the day without a reading"
          % (boundary, today.isoformat()), "R2 ONCE PER DAY")

    # 11. scheduling settings
    settings = root.find(NS + "Settings")
    if settings is None:
        q("<Settings> missing", "R2 ONCE PER DAY")
    if (settings.findtext(NS + "MultipleInstancesPolicy") or "").strip() != "IgnoreNew":
        q("<MultipleInstancesPolicy> is %r, expected IgnoreNew so a slow run is "
          "never stacked" % settings.findtext(NS + "MultipleInstancesPolicy"),
          "R2 ONCE PER DAY")
    if (settings.findtext(NS + "StartWhenAvailable") or "").strip().lower() != "true":
        q("<StartWhenAvailable> is %r, expected true so a missed day is fired once "
          "instead of being lost" % settings.findtext(NS + "StartWhenAvailable"),
          "R2 ONCE PER DAY")

    # 12. never elevate
    principal = root.find(NS + "Principals/" + NS + "Principal")
    if principal is None:
        q("<Principal> missing", "R4 APPROVAL BEFORE EXTERNAL ACTION")
    runlevel = (principal.findtext(NS + "RunLevel") or "").strip()
    if runlevel in ("HighestAvailable", ""):
        q("<RunLevel> is %r, expected LeastPrivilege (nothing here needs elevation)"
          % runlevel, "R1 NO EARNING ACTION")

    return root


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("task_xml")
    parser.add_argument("--today", default=None,
                        help="override today's date (YYYY-MM-DD) for the boundary check")
    args = parser.parse_args(argv)

    today = (datetime.date.fromisoformat(args.today) if args.today
             else datetime.date.today())
    try:
        check(args.task_xml, today)
    except Violation as exc:
        print("VIOLATION: %s" % exc)
        print("VERDICT: NOT OBSERVE-ONLY (gate exit 1)")
        return 1
    print("OK: %s is observe-only (single daily read of the canonical entry point, "
          "pinned tzdata interpreter, no write verb, boundary in the future)" % os.path.basename(args.task_xml))
    print("VERDICT: OBSERVE-ONLY (gate exit 0)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
