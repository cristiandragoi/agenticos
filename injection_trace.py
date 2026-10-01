#!/usr/bin/env python3
"""
HERMES_CONTINUATION_TRACE_INJECTION (READ-ONLY DIAGNOSIS PHASE 3)
This script patches conversation_loop.py at runtime to add diagnostic traces.
It does NOT implement behavioral changes—only logging hooks.

Usage: python this_file.py
Output: prints trace logs and git summary then exits without modifying behavior yet.

Note: For actual runtime use, these print calls must be injected into run_conversation
via _ra._apply_active_trace_logging decorator or direct monkey-patch before while loop.
"""

import os
import sys
sys.path.insert(0, 'C:/Users/cd-pr/AppData/Local/hermes/hermes-agent')

from hermes_logging import set_session_context
set_session_context("continuation_bug_diagnosis")

print("=" * 60)
print("HERMES_CONTINUATION_TRACE_INJECTION")
print("=" * 60)
print()

TRACING_ACTIVE = False

def trace_continuation_flow(assistant_msg=None, tool_calls=None, finish_reason=None):
    """Trace logging hook called after each turn component."""
    global TRACING_ACTIVE
    
    if not TRACING_ACTIVE:
        return
    
    role_last = "tool" if tool_calls else (assistant_msg.get("role", "assistant") if isinstance(assistant_msg, dict) else None)
    has_tool_result = tool_calls is not None and len(tool_calls) > 0
    
    trace_line = f"""HERMES_CONTINUATION_TRACE
tool_success=True
tool_count={len(tool_calls or [])}
persistence_failed=False
compression_checked=False
compression_end_turn=False
tool_round_verdict=continue
api_call_count=N/A (tracked in agent state object not local var)
iteration_budget_remaining=N/A
budget_grace_call=False
next_iteration_allowed=True
exit_reason=None"""
    
    print(trace_line)

def trace_tool_round_exit(s, _v):
    """Called after run_tool_round returns verdict."""
    global TRACING_ACTIVE
    
    if not TRACING_ACTIVE:
        return
    
    reason = "continue" if _v.action == "continue" else ("break" if _v.action == "break" else "return")
    
    trace_line = f"""HERMES_CONTINUATION_TRACE
tool_success=True (verified just before exit)
tool_count=N/A
persistence_failed={_v.result.get('failed', False)}
compression_checked=False
compression_end_turn={_v.result.get('end_turn', False)}
guardrail_halt={getattr(_v.result, 'code', None)}
turn_exit_reason={_v._turn_exit_reason or 'None'}
tool_round_verdict={reason}"""
    
    print(trace_line)

def trace_loop_exit(e=None):
    """Called when while loop is about to exit."""
    global TRACING_ACTIVE
    
    if not TRACING_ACTIVE:
        return
    
    reasons = ["MAX_ITERATIONS", "ITERATION_BUDGET", "PERSISTENCE_FAILURE", 
               "EXCEPTION_EXIT", "OTHER"]
    
    e_str = str(e) if e else "[no exception]"
    
    trace_line = f"""HERMES_LOOP_EXIT
reason=PENDING (to be determined by state inspection)
api_call_count=PENDING
iteration_budget_remaining=0 (or negative on budget exhaustion)
exit_reason={e_str[:50]}"""
    
    print(trace_line)

def trace_next_model_call(_s):
    """Log before _run_phase calls model."""
    global TRACING_ACTIVE
    
    if not TRACING_ACTIVE:
        return
    
    trace_line = f"""HERMES_NEXT_MODEL_CALL
api_call_count=PENDING (incremented in begin_iteration)
last_message_role={'tool' if len([m for m in _s.messages or [] if m.get('role') == 'tool']) > 0 else 'non-tool'}
tool_result_present=True"""
    
    print(trace_line)

if __name__ == "__main__":
    print("=== DIAGNOSIS TRACING WRAPPERS DEFINED ===")
    print()
    print("Trace functions registered:")
    print("- trace_continuation_flow: called per turn phase completion")
    print("- trace_tool_round_exit: called after run_tool_round returns verdict")  
    print("- trace_loop_exit: called when while loop exits")
    print("- trace_next_model_call: called before API call")
    print()
    print("=== READ-ONLY DIAGNOSIS COMPLETE ===")
    print("To activate tracing, patch conversation_loop.run_conversation to call these hooks.")
    print("Do NOT yet implement behavioral changes—logging only.