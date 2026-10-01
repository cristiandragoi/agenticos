/**
 * CODING AGENT MVP — Architecture Inspection Report
 * 
 * INSPECTED ASSETS FOR REUSE:
 * ===========================
 */

/// ROUTES & HANDLERS (D:/AgenticOS/server/src/)
//   - src/routers/voice.ts        ← Voice routing logic (reuse request handling)
//   - src/routers/*               ← General route patterns
//   - src/handlers/*              ← HTTP handler reuse

/// SERVICES (D:/AgenticOS/server/src/services/)
//   - src/services/voice/piperTts.ts  ← Service layer pattern
//   - src/services/voice/localTts.ts  ← Service layer pattern  
//   - src/services/voice/edgeTts.ts   ← Edge fallback service
//   Pattern: services/{feature}/{engine}.ts

/// UTILITIES (D:/AgenticOS/server/src/)
//   - src/utils/*                 ← Helper functions (validation, async)
//   - src/common/*                ← Shared types/constants

/// TYPES / CONSTANTS
//   Need to define: State machine types, approval gates, permission scopes


/// CANVAS FOR CODING RUN
// The coding agent will create its own isolated workspace:
// 1. Create .codec-agent directory under server/
// 2. Each task gets its own subdirectory (task-id/) 
// 3. Git worktree isolation via bare checkout of starter repo or sandbox mode

/// MODEL INFRASTRUCTURE
// Reuse existing AgenticOS LLM provider config:
//   - src/models/*                 ← Existing model router if exists
//   Or create minimal ModelGateway using hermes mcp tools delegation


/// UI INTEGRATION POINTS
// Existing Hermes Desktop app preview pane provides:
//   - desktop_preview(action='open', url='file://...')   ← Preview rendering
//   - tour()                                             ← Guided walkthroughs
//   - tip()                                              ← Element annotations
