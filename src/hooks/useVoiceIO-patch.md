/**
 * JARVIS-RUNTIME-CORE-002B Implementation — Control Authority Invariants
 * 
 * Changes:
 * 1. Added sseAbortControllerRef for direct-chat SSE stream cancellation
 * 2. Added pausedRef for PAUSE/RESUME semantics  
 * 3. Terminal STOP now aborts SSE stream and clears pending Autosubmit
 * 4. PAUSE preserves session state for resume functionality
 * 5. Added stopConversation for explicit terminal stop (UI action)
 */
