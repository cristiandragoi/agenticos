---
name: agenticos-autonomous-repair
description: >-
  Directs autonomous problem-solving and recovery through tool and runtime failures.
  Use when encountering execution errors, tool failures, terminal command issues,
  or debugging roadblocks without unnecessarily deferring to the user.
---

# AgenticOS Autonomous Repair Protocol

This skill enforces persistent, resilient problem-solving. Antigravity must exhaust all automated recovery options before requesting user intervention.

## Core Rule: TOOL FAILURE != TASK BLOCKER

A failed tool call, terminal error, or PowerShell parsing issue is an operational signal, not a reason to stop or ask the user to do the work.

### Recovery Workflow

When a tool or command fails:

1. **Classify the Failure**:
   - *Syntax / Quoting*: PowerShell parsing error, string escaping, unclosed quotation mark, parameter mismatch.
   - *Process / Resource Lock*: Port in use (EADDRINUSE), file locked by Windows (sharing violation), background daemon hanging.
   - *Missing Dependency / Binary*: CLI tool not in PATH, node module not built, missing python package.
   - *Permission / Sandbox*: Elevation required, sandboxed filesystem boundary.
   - *Network / Endpoint*: Connection refused (ECONNREFUSED), timeout, upstream provider 429/500.

2. **Identify Alternative Authorized Tools**:
   - PowerShell quoting failed? -> Run a one-line Node.js script (`node -e "..."`) or a temporary script file in scratch space.
   - Ripgrep shell command failed or truncated? -> Use native `grep_search` or Node fs search.
   - File edit failed to match chunk? -> Use `view_file` to re-read line numbers, or write a dedicated script.
   - Port locked? -> Inspect the owning PID using `Get-NetTCPConnection` and assess if it is an orphaned test process.
   - Endpoint down? -> Verify if the service needs a rebuild (`npm run build`) or process restart.

3. **Execute the Alternative**:
   - Immediately switch to the alternative mechanism without asking permission to try a different syntax or script.
   - Verify the outcome.

4. **Continue the Task**:
   - Seamlessly resume execution toward the overall objective.

---

## When to Stop for User Input

Do NOT ask the user to execute terminal commands, edit files, check git status, or perform tasks that Antigravity has tools to execute.

**ONLY** stop and request user intervention when an item genuinely requires physical human agency:
1. **Physical Interaction**:
   - Speaking physically into the room microphone to test barge-in or STT.
   - Listening to hear if audio actually emanates clearly from speakers.
   - Clicking an external hardware switch or physical peripheral.
2. **Missing Secrets / External Credentials**:
   - An API key or token that does not exist in `.env`, environment variables, or workspace secrets.
3. **Irreversible Business / Architecture Decisions**:
   - Deleting permanent production databases, altering core business rules, or choosing between competing external commercial services.
4. **Explicit Approval Requirements**:
   - Required user sign-off on destructive operations specified by policy.
5. **External Information**:
   - Requirements or credentials inaccessible to any available tool.

---

## Execution Discipline

- **Maintain a Compact Todo List**: Keep track of unfinished acceptance criteria and check off items as evidence is gathered.
- **No Early Finish**: Never conclude an investigation or repair merely because "substantial progress" was made or because a single build passed. Ensure all criteria are demonstrated.
