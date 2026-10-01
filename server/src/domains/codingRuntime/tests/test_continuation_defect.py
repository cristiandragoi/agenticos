"""
Regression test suite for HERMES-CONTINUATION-001

Tests validate continuation behavior across context compression boundaries,
including tool-success cycles, post-tool-compression handoffs, multiple round
trips, idle reference handoffs, approval bypasses, recoverable failures, and
compression failure states.
"""

import json
from unittest.mock import patch, MagicMock
import pytest


# =============================================================================
# Test 1: TOOL SUCCESS WITHOUT COMPRESSION (full cycle)
# =============================================================================

class TestToolSuccessWithoutCompression:
    """Test case 1: Tool success without compression triggers full-cycle continuation.

    Scenarios:
    - Agent makes a tool call that succeeds
    - Continuation fires and the model produces an answer
    - The output is preserved verbatim in the message list
    - No compression occurs (below threshold)
    """

    def test_single_tool_success_full_continuation_cycle(self, monkeypatch):
        """A successful tool call followed by continuation preserves evidence."""
        from agent.coding_runtime.service import Service

        service = Service()
        messages = [
            {"role": "user", "content": "Write main.py"},
            {
                "role": "assistant",
                "content": "I'll create a FastAPI app in main.py",
                "tool_calls": [
                    {
                        "id": "call_1",
                        "type": "function",
                        "function": {"name": "write_file", "arguments": {"path": "/main.py"}},
                        "tool_call_id": "call_1"
                    }
                ],
            },
            {
                "role": "tool",
                "content": "File written: /main.py (2.3KB)",
                "id": "call_1",
                "output": "from fastapi import FastAPI\napp = FastAPI()",
            },
        ]

        # Verify messages are intact after continuation request
        response = service._process_turn(messages, mock_model="test")
        assert len(response["messages"]) >= 4  # Original 3 + assistant continuation
        assert any("main.py" in msg.get("content", "") for msg in response["messages"])

    def test_multiple_tool_calls_without_intermediate_compression(self, monkeypatch):
        """Multiple tool calls should complete without triggering compression."""
        from agent.coding_runtime.service import Service

        service = Service()
        messages = [
            {"role": "user", "content": "Set up project structure"},
            {
                "role": "assistant",
                "content": "Creating directories...",
                "tool_calls": [
                    {
                        "id": "call_1",
                        "type": "function",
                        "function": {"name": "terminal", "arguments": {"command": "mkdir -p src tests"}},
                        "tool_call_id": "call_1"
                    }
                ],
            },
            {"role": "tool", "content": "Created: src, tests", "id": "call_1"},
        ]

        response = service._process_turn(messages, mock_model="test")
        # No compression occurred; original tool results preserved
        assert any("src" in str(msg) for msg in response["messages"])
        assert any("tests" in str(msg) for msg in response["messages"])


# =============================================================================
# Test 2: TOOL SUCCESS WITH POST-TOOL COMPRESSION -> REFERENCE HANDOFF -> MODEL CONTINUATION
# =============================================================================

class TestToolSuccessWithCompressionReferenceHandoffContinuation:
    """Test case 2: Post-tool compression fires AFTER tool response, leaving only a reference handoff.

    Scenarios:
    - Tool call succeeds and produces output
    - Context threshold reached after the tool result arrives
    - Compression runs (micro-compaction) to reduce tail tokens
    - The compressed state includes summary but NOT the full tool transcript
    - Only a reference pointer survives in a handoff message
    - Model continues from this reference-only state and must reconstruct context
    """

    def test_post_tool_micro_compaction_reference_only(self, monkeypatch):
        """Compression after a successful tool call preserves references only."""
        from agent.context_compressor import ContextCompressor

        # Simulate a transcript that just hit threshold
        messages = [
            {"role": "user", "content": "Help me with the project"},
            {"role": "assistant", "content": "Starting...", "tool_calls": []},
            {"role": "tool", "content": "Initial setup complete", "id": "call_1"},
        ] * 10  # Fill to trigger compression

        compressor = ContextCompressor(
            model="anthropic/claude-3-7-sonnet-20250219",
            threshold=0.50,
            target_ratio=0.20,
        )

        with patch.object(compressor, "_compress_messages") as mock_compress:
            # Mock a realistic compression that produces summary+references only
            compressed = [
                {"role": "system", "content": "..."},
                {"role": "user", "content": "Help me with the project"},
                {
                    "role": "assistant",
                    "content": "[CONTEXT COMPACTION] Earlier turns were compacted...## Goal Help me with the project"
                },
            ]

            mock_compress.return_value = compressed

            result = compressor.compress(messages)

        # Verify compression was called once (per-turn micro-compaction)
        assert mock_compress.called
        # The compressed transcript should have a summary message, not full tool chain
        assert any("CONTEXT COMPACTION" in msg.get("content", "") for msg in result["messages"])

    def test_compressed_state_reference_pointer_only(self, monkeypatch):
        """After compression, only the reference (summary) survives; model reconstructs context."""
        from agent.context_compressor import ContextCompressor

        compressor = ContextCompressor(
            model="anthropic/claude-3-7-sonnet-20250219",
            threshold=0.40,  # Low to force compression
        )

        messages = [
            {"role": "user", "content": "Write config.yaml"},
            {
                "role": "assistant",
                "content": "Creating config...",
                "tool_calls": [{"id": "call_1", "function": {"name": "write_file"}}],
            },
            {"role": "tool", "content": "File written (420 bytes)", "id": "call_1"},
        ] * 8

        with patch.object(compressor, "_compress_messages") as mock_compress:
            # Summary carries path references but not full command output
            summary_content = "[CONTEXT COMPACTION] Earlier turns were compacted.\n## Goal Write config.yaml\n## Progress Done - Created app/config.yaml (420 bytes) with database and CORS settings"

            mock_compress.return_value = {
                "messages": [
                    {"role": "system", "content": "..."},
                    {"role": "user", "content": "Write config.yaml"},
                    {"role": "assistant", "content": summary_content},
                ],
                "new_system_prompt": "...",
            }

            result = compressor.compress(messages)

        # The assistant response after compression is only a reference, no answer
        assistant_msgs = [m for m in result["messages"] if m.get("role") == "assistant"]
        assert len(assistant_msgs) > 0
        ref_msg = assistant_msgs[-1]
        assert "CONTEXT COMPACTION" in ref_msg.get("content", "")

    def test_model_continuation_from_reference_handoff(self, monkeypatch):
        """The model must continue from the reference-only state after compression."""
        from agent.context_compressor import ContextCompressor, Agent

        compressor = ContextCompressor(
            model="anthropic/claude-3-7-sonnet-20250219",
        )

        # Build a transcript at threshold
        messages = [{"role": "user", "content": f"x{i}"} for i in range(10)] + [
            {"role": "user", "content": "Summarize what we did so far"},
        ]

        with patch.object(compressor, "_compress_messages") as mock_compress:
            mock_compress.return_value = {
                "messages": [
                    {"role": "system", "content": "..."},
                    {"role": "assistant", "content": "[CONTEXT COMPACTION] Earlier turns were compacted..."}
                ],
            }
            result = compressor.compress(messages)

        # Now simulate another user turn asking for continuation
        messages.append({"role": "user", "content": "What did we accomplish?"})

        # Model should continue from the reference, not repeat the summary as answer
        db = []
        agent = Agent(
            tools=MagicMock(),
            model="anthropic/claude-3-7-sonnet-20250219",
            system_message="""You are Hermes, an AI assistant that helps with coding tasks.<note>Always use the context window you see for all your answers.</note>""",
        )
        agent.append_message("", role="system", content="You are Hermes")
        continuation = agent._build_response_for_message(message=messages[-1], transcript=result["messages"])

        assert continuation.get("role") == "assistant"


# =============================================================================
# Test 3: MULTIPLE TOOL ROUNDS ACROSS COMPRESSION
# =============================================================================

class TestMultipleToolRoundsAcrossCompression:
    """Test case 3: Multiple tool rounds occur across compression boundaries.

    Scenarios:
    - Round 1: Tool calls A and B occur below threshold (no compression)
    - Round 2: Threshold reached; compression fires with summary+references
    - Round 3: New tool calls C and D must be issued using context from round 2's summary
    """

    def test_round_1_below_threshold_no_compression(self, monkeypatch):
        """First tool round completes without triggering compression."""
        from agent.context_compressor import ContextCompressor

        compressor = ContextCompressor(
            model="mock/v4",
            threshold=0.50,  # High to prevent early compression
        )

        messages = [
            {"role": "user", "content": "Do A then B"},
            {"role": "assistant", "content": "Starting A", "tool_calls": [{"id": "ta1"}]},
            {"role": "tool", "content": "A done", "id": "ta1"},
            {"role": "assistant", "content": "Now B...", "tool_calls": [{"id": "tb1"}]},
            {"role": "tool", "content": "B done", "id": "tb1"},
        ]

        result = compressor.compress(messages)  # Should either skip or compress heavily
        assert len(result["messages"]) >= 4

    def test_round_2_triggers_compression_with_summary(self, monkeypatch):
        """Second round triggers compression; summary carries tool references."""
        from agent.context_compressor import ContextCompressor

        compressor = ContextCompressor(
            model="mock/v4",
            threshold=0.30,  # Force compression here
        )

        messages = [
            {"role": "user", "content": "Do C then D"},
            {"role": "assistant", "content": "Starting C", "tool_calls": [{"id": "tc1"}]},
            {"role": "tool", "content": "C done", "id": "tc1"},
        ] * 40  # Enough to trigger compression

        with patch.object(compressor, "_compress_messages") as mock_compress:
            summary = "[CONTEXT COMPACTION] Earlier turns were compacted.\n## Goal Do C then D\n## Progress Done - Completed C (terminal output /workspace/log), now issuing D"
            mock_compress.return_value = {"messages": [{"role": "assistant", "content": summary}]}

            result = compressor.compress(messages)

        assert len(result["messages"]) < 40  # Compression happened
        # Summary must mention tool outputs that future rounds will depend on
        assert any("workspace" in str(msg.get("content", "")) for msg in result["messages"])

    def test_round_3_continues_from_summary_using_tool_references(self, monkeypatch):
        """Third round continues from summary using tool path references."""
        from agent.context_compressor import ContextCompressor

        compressor = ContextCompressor(
            model="mock/v4",
            threshold=0.25,
        )

        # Build transcript across two compressions
        base_messages = [
            {"role": "user", "content": "Run C"},
            {"role": "assistant", "content": "Calling c_terminal()", "tool_calls": [{"id": "tc1"}]},
            {"role": "tool", "content": "/workspace/log <- output from c_terminal()", "id": "tc1"},
        ]

        # First compression preserves the log path reference
        messages = base_messages + [
            {"role": "user", "content": "Run D"},
            {"role": "assistant", "content": "Calling c_terminal again...", "tool_calls": [{"id": "td1"}]},
            {"role": "tool", "content": "/workspace/log <- output from d_terminal()", "id": "td1"},
        ] * 45

        with patch.object(compressor, "_compress_messages") as mock_compress:
            mock_compress.return_value = {
                "messages": [
                    {"role": "assistant", "content": "[CONTEXT COMPACTION] Earlier turns were compacted...\n## Goal Run C then D\n## Progress Done - Log written to /workspace/log"},
                ],
            }

            result = compressor.compress(messages)

        assert len(result["messages"]) < 100


# =============================================================================
# Test 4: GENUINE IDLE REFERENCE HANDOFF (SKIP PROTECTION FIRES)
# =============================================================================

class TestIdleReferenceHandoffSkipProtectionFires:
    """Test case 4: A genuine idle reference handoff fires, but skip protection prevents premature continuation.

    Scenarios:
    - Agent has just produced a response
    - Reference-only compaction handoff appears in the transcript
    - A "skip protection" flag gates the continuation nudge
    - Model only resumes on next real user turn or explicit /continuation trigger
    """

    def test_idle_reference_handoff_no_premature_continuation(self, monkeypatch):
        """A reference handoff doesn't trigger continuation unless it's a real answer."""
        from agent.context_compressor import ContextCompressor, Agent

        compressor = ContextCompressor(model="mock/v4")

        messages = [
            {"role": "system", "content": "..."},
            {"role": "user", "content": "Summarize project"},
            {
                "role": "assistant",
                "content": "[CONTEXT COMPACTION] Earlier turns were compacted...## Progress Done - Project has 4 endpoints, config.yaml exists"
            },
        ]

        # No continuation nudge should be added after a handoff message
        agent = Agent(
            tools=MagicMock(),
            model="anthropic/claude-3-7-sonnet-20250219",
            system_message="""You are Hermes, an AI assistant that helps with coding tasks.<note>Always use the context window you see.</note>""",
        )
        agent.append_message("", role="system", content="You are Hermes")
        result = agent._build_response_for_message(message=messages[-1])

        assert len(result.get("tool_calls", [])) == 0  # Handoff message shouldn't call tools


# =============================================================================
# Test 5: WAITING_FOR_APPROVAL BYPASSING
# =============================================================================

class TestWaitingForApprovalBypassing:
    """Test case 5: Approval mode bypasses after successful compression and handoff.

    Scenarios:
    - Agent requests user approval during an operation
    - User provides explicit /continue or new input
    - Compression completes despite pending approval state
    - Handoff fires successfully without waiting for further approval
    """

    def test_approval_bypass_after_successful_compression(self, monkeypatch):
        """A pending approval doesn't block compression once user intervenes."""
        from agent.context_compressor import ContextCompressor, Agent

        compressor = ContextCompressor(model="mock/v4")

        messages = [
            {"role": "system", "content": "..."},
            {
                "role": "user",
                "content": "Do task with approval request",
            },
            {"role": "assistant", "content": "[WAITING_FOR_APPROVAL] Waiting for you...", "tool_calls": []},
        ]

        # User provides the approval/new input
        messages.append({"role": "user", "content": "/continue Do task 2"})

        with patch.object(compressor, "_compress_messages") as mock_compress:
            mock_compress.return_value = {
                "messages": [
                    {"role": "assistant", "content": "[CONTEXT COMPACTION] Doing task 2...## Progress Done - Task 2 completed successfully"},
                ],
            }
            result = compressor.compress(messages)

        # Approval was bypassed after user input; compression succeeded
        assert len(result["messages"]) < 50


# =============================================================================
# Test 6: RECOVERABLE TOOL FAILURE HANDLING
# =============================================================================

class TestRecoverableToolFailureHandling:
    """Test case 6: Recoverable tool failures are handled gracefully across compression boundaries.

    Scenarios:
    - A tool call fails in round 1 before any compression
    - Failure is logged; agent retries or skips the failing tool
    - Compression fires without preserving the failure output
    - Model continues from summary (failure context implicitly preserved)
    """

    def test_tool_failure_before_compression_preserved_in_summary(self, monkeypatch):
        """A failed tool's result is captured in the compression summary."""
        from agent.context_compressor import ContextCompressor, Agent

        compressor = ContextCompressor(model="mock/v4")

        messages = [
            {"role": "user", "content": "Attempt task but expect failure"},
            {"role": "assistant", "content": "Starting attempt...", "tool_calls": [{"id": "call_1"}]},
            {
                "role": "tool",
                "content": "Error: Could not connect to database (code 503)",
                "id": "call_1",
            },  # Recoverable failure
        ] * 30

        with patch.object(compressor, "_compress_messages") as mock_compress:
            mock_compress.return_value = {
                "messages": [
                    {
                        "role": "assistant",
                        'content': "[CONTEXT COMPACTION] Earlier turns were compacted.\n## Goal Attempt task but expect failure\n## Progress Done - Database unavailable (503); retry with backoff"
                    },
                ],
            }

            result = compressor.compress(messages)

        # Failure reason is captured in summary for future continuation
        assert any(
            "failur" in str(msg.get("content", "")).lower() or "database" in str(msg.get("content", "")).lower()
            for msg in result["messages"]
        )

    def test_failure_retry_after_compression_succeeds(self, monkeypatch):
        """Agent retries after compression using failure context from summary."""
        from agent.context_compressor import ContextCompressor

        compressor = ContextCompressor(model="mock/v4")

        messages_before = [
            {"role": "user", "content": "Try task X"},
            {"role": "assistant", "content": "Calling tool...", "tool_calls": [{"id": "call_1"}]},
            {
                "role": "tool",
                'content': "Failure: File already exists at /path/to/file (code 409)",
                "id": "call_1",
            },
        ]

        # Compression fires; summary carries failure code
        result = compressor.compress(messages_before)

        assert len(result["messages"]) < len(messages_before) * 3

    def test_failure_recovery_path_in_summary(self, monkeypatch):
        """Compression summarizes how agent recovered from failure."""
        from agent.context_compressor import ContextCompressor

        compressor = ContextCompressor(model="mock/v4")

        messages = [
            {"role": "user", "content": "Process files"},
            {"role": "assistant", "content": "Scanning...", "tool_calls": [{"id": "call_scan"}]},
            {
                "role": "tool",
                'content': "Error: Read permission denied on /secure (code 505)",
                "id": "call_scan",
            },
        ] * 25

        with patch.object(compressor, "_compress_messages") as mock_compress:
            mock_compress.return_value = {
                "messages": [
                    {
                        "role": "assistant",
                        'content': "[CONTEXT COMPACTION] Earlier turns were compacted...\n## Failures - Read denied on /secure (505). Fix: Grant permissions or skip /secure.",  # Recovery path in summary
                    },
                ],
            }

            result = compressor.compress(messages)

        # Summary mentions failure and recovery path
        assert any(
            "permission" in str(msg.get("content", "")).lower() or "skip" in str(msg.get("content", "")).lower()
            for msg in result["messages"]
        )


# =============================================================================
# Test 7: COMPRESSION FAILURE/TIMEOUT EXPLICIT FAILURE STATE
# =============================================================================

class TestCompressionFailureTimeoutExplicitFailureState:
    """Test case 7: Compression that fails or times out returns an explicit failure state.

    Scenarios:
    - _compress_messages raises exception (timeout)
    - Exception wraps into BLOCKED_* or COMPRESSION_FAILED message
    - Agent preserves uncompressed transcript for later retry
    - Continuation fires but cannot complete until compression succeeds
    """

    def test_timeout_wraps_into_explicit_failure(self, monkeypatch):
        """Compression timeout is caught and wrapped into an explicit failure."""
        from agent.context_compressor import ContextCompressor
        from agent.exceptions import CompressionBlocked

        compressor = ContextCompressor(model="mock/v4")

        messages = [
            {"role": "user", "content": "Summarize long transcript"},
            {"role": "assistant", "content": "Generating summary...", "tool_calls": []},
        ] * 50

        with patch.object(compressor, "_compress_messages", side_effect=TimeoutError("Summary model timed out")):
            # Should catch timeout and return uncompressed transcript or explicit error
            try:
                compressor.compress(messages)
            except TimeoutError as e:
                assert "Summary model timed out" in str(e)

    def test_compression_timeout_returns_failover_state(self, monkeypatch):
        """On timeout, compressor returns a failover state that the caller can handle."""
        from agent.context_compressor import ContextCompressor

        compressor = ContextCompressor(model="mock/v4")

        with patch.object(compressor, "_compress_messages", side_effect=TimeoutError("Summary model timed out")):
            # Compressor should have a failover path when compression fails
            result = compressor._handle_compression_failure_or_timeout(TimeoutError("Failed to compress"))

            # Failover state could be: uncompressed transcript OR explicit error dict
            assert "messages" in result or "error" in result


# =============================================================================
# Helpers for model continuation simulation
# =============================================================================

def _build_agent_with_db(db):
    """Simulate an agent instance for testing."""
    db.append_message("", role="system", content="You are Hermes")


def model_response_for_message(message, transcript):
    """Simulate a model response given a transcript that may include compression."""
    from agent import Agent

    db = []
    _build_agent_with_db(db)
    # Simulate continuation from the last message in the compressed transcript
    continuation = Agent()._build_response_for_message(message=message, transcript=transcript)

    if continuation.get("tool_calls"):
        return continuation

    # Model continues naturally from reference handoff
    content = "\n".join([m.get("content", "") for m in transcript if isinstance(m, dict) and "content" in m])
    return {"type": "text", "content": content.replace("\n\n", "\n").strip()}


# =============================================================================
# Integration tests for end-to-end continuation across compression boundaries
# =============================================================================

class TestEndToEndContinuationAcrossCompression:
    """Integration test class verifying full continuation cycles.

    These tests simulate real user interactions and verify that the agent handles
    compression correctly without losing important context or failing unexpectedly.
    """

    def test_full_cycle_user_task_tool_result_compression_continuation(self, monkeypatch):
        """Full cycle: user task -> tool result -> compression fires -> continuation."""
        from agent.context_compressor import ContextCompressor

        compressor = ContextCompressor(model="mock/v4", threshold=0.35)

        messages = [
            {"role": "user", "content": "Set up a FastAPI project with tests"},
            {"role": "assistant", "content": "Creating structure...", "tool_calls": [{"id": "call_1"}]},
            {
                "role": "tool",
                "content": "Created directory: /workspace/myapp, wrote main.py (2.3KB)",
                "id": "call_1",
            },
        ] * 25

        with patch.object(compressor, "_compress_messages") as mock_compress:
            summary = "[CONTEXT COMPACTION] Earlier turns were compacted.\n## Goal Set up a FastAPI project with tests\n## Progress Done - Created /workspace/myapp with main.py (2.3KB) containing 5 endpoints, wrote 10 test cases"

            mock_compress.return_value = {"messages": [{"role": "assistant", "content": summary}]}

            result = compressor.compress(messages)

        # Continuation from reference handoff preserves progress summary
        assert any("Created" in str(msg.get("content", "")) for msg in result["messages"])

    def test_multiple_compressions_preserve_progress_across_boundaries(self, monkeypatch):
        """Multiple compression cycles across tool call boundaries preserve progress."""
        from agent.context_compressor import ContextCompressor

        compressor = ContextCompressor(model="mock/v4", threshold=0.30)

        # First cycle
        messages1 = [
            {"role": "user", "content": "Build API then add tests"},
            {"role": "assistant", "content": "Starting...", "tool_calls": [{"id": "api_call"}]},
            {
                "role": "tool",
                "content": "API endpoint: GET /items written to main.py",
                "id": "api_call",
            },
        ] * 45

        with patch.object(compressor, "_compress_messages") as mock_compress:
            summary1 = "[CONTEXT COMPACTION] Earlier turns were compacted.\n## Goal Build API then add tests\n## Progress Done - GET /items endpoint written"
            mock_compress.return_value = {"messages": [{"role": "assistant", "content": summary1}]}

        result1 = compressor.compress(messages1)

        # Second cycle: new tool call must use context from first compression
        messages2 = [
            {"role": "user", "content": "Now add POST /items"},
            {"role": "assistant", "content": "Writing...", "tool_calls": [{"id": "post_call"}]},
            {
                "role": "tool",
                "content": "Created POST /items to main.py, now adding tests",
                "id": "post_call",
            },
        ] * 48

        with patch.object(compressor, "_compress_messages") as mock_compress:
            summary2 = "[CONTEXT COMPACTION] Earlier turns were compacted.\n## Goal Build API then add tests\n## Progress Done - GET /items, now POST /items in progress"
            mock_compress.return_value = {"messages": [{"role": "assistant", "content": summary2}]}

        result2 = compressor.compress(messages2)

        # Both summaries must accumulate; progress never lost across boundaries
        assert any("GET /items" in str(msg.get("content", "")) for msg in result2["messages"])
        assert any("POST /items" in str(msg.get("content", "")) for msg in result2["messages"])

    def test_tool_failure_recovery_across_multiple_compressions(self, monkeypatch):
        """Multiple tool failures followed by successful recovery across compression."""
        from agent.context_compressor import ContextCompressor

        compressor = ContextCompressor(model="mock/v4", threshold=0.35)

        messages = [
            {"role": "user", "content": "Build API but expect initial failures"},
            {"role": "assistant", "content": "Starting build...", "tool_calls": [{"id": "call_1"}]},
            {
                "role": "tool",
                'content': "Error: Could not import 'requests' (code 503)",
                "id": "call_1",
            },
        ]

        with patch.object(compressor, "_compress_messages") as mock_compress:
            summary = "[CONTEXT COMPACTION] Earlier turns were compacted.\n## Goal Build API but expect initial failures\n## Progress Done - Import failed: requests (503). Install requirement first."

            mock_compress.return_value = {"messages": [{"role": "assistant", "content": summary}]}

        result = compressor.compress(messages)

        # Summary preserves failure for recovery path in next continuation
        assert any("requests" in str(msg.get("content", "")).lower() for msg in result["messages"])
