# AGENTICOS — PROJECT WORKSPACES + KNOWLEDGE FOUNDATION + JARVIS HOLOGRAPHIC RUNTIME UI

The Jarvis direct-conversation, provider truth, voice playback, layout and scrolling repairs are complete.

This specification defines the next AgenticOS architecture layer.

The goal is to build the foundation for:

1. Project Workspaces
2. Knowledge structure
3. Project-aware Mission Control
4. Jarvis as the command/coordination layer
5. Jarvis Live Work visibility
6. A holographic Jarvis runtime visualization whose colors and motion represent real AgenticOS state

Do not replace working AgenticOS systems with parallel implementations. Inspect and extend the existing architecture.

---

# 1. CORE ARCHITECTURE

AgenticOS should separate four primary responsibilities.

## JARVIS — COMMAND & COORDINATION

Jarvis is the primary user interface.

The user talks to Jarvis and gives objectives.

Jarvis should understand:

* active project
* current objective/task
* current run
* delegated agent
* relevant workspace
* system/runtime state
* relevant project context

Jarvis is NOT the permanent storage location for all project information.

The long-term goal is:

User → Jarvis → appropriate agents/tools → verified result.

The user should eventually not need to manually copy prompts between Jarvis, Hermes, Codex, Antigravity or other agents.

## LIVE WORK — CURRENT EXECUTION

The Jarvis page should provide a collapsible Live Work area showing operational activity when Jarvis is actually doing something.

Examples:

Jarvis
→ task started
→ delegated to Hermes
→ Hermes inspecting files
→ Codex editing
→ browser opened
→ build running
→ tests passed
→ completed

Do NOT expose hidden chain-of-thought.

Only show operational events and useful execution status.

When Jarvis is only having a normal conversation, Live Work should remain quiet/minimal.

## MISSION CONTROL — ACTIVE OPERATIONS

Mission Control is the cross-project operational layer.

It should ultimately represent:

* projects
* tasks
* runs
* active agents
* queued work
* blockers
* failures
* approvals
* completed work
* current stages

Mission Control should be project-aware.

Do not redesign existing Mission Control from scratch if working functionality already exists. Extend it.

## PROJECTS / KNOWLEDGE — PERSISTENT WORK

Projects are where persistent work lives.

Examples of future projects could include:

* AgenticOS
* ACCEPTIT
* Recruiting
* Lead Generation

These are examples only. Do not hard-code them unless they already exist.

Conversation is interaction.

Project workspaces are persistent operational knowledge.

---

# 2. PROJECT MODEL

Implement Projects as durable first-class AgenticOS entities.

A project should minimally support:

* id
* name
* description
* status
* createdAt
* updatedAt
* active/inactive state
* tags
* optional default workspace/repository

A project must be able to contain or reference:

* notes
* tasks
* decisions
* research
* files/references
* runs
* agents
* activity

Use the existing AgenticOS persistence architecture where appropriate.

Do NOT introduce an unnecessary second database.

---

# 3. ACTIVE PROJECT CONTEXT

Introduce a reliable concept of:

activeProjectId

Jarvis must know which project is currently active.

Example:

Active project: Recruiting

The user can switch to:

Active project: AgenticOS

The active-project identity and basic metadata must become available to Jarvis context assembly.

Project switching must NOT corrupt conversation history.

Do not implement advanced long-term memory retrieval yet.

This phase establishes project boundaries so future memory has somewhere meaningful to live.

---

# 4. PROJECT WORKSPACE UI

Add a PROJECTS area to AgenticOS navigation.

Conceptually:

JARVIS

MISSION CONTROL

PROJECTS
AgenticOS
ACCEPTIT
Recruiting
Lead Generation

* New Project

AGENTS
Hermes
Codex
Antigravity
...

KNOWLEDGE

Again: do not hard-code example projects.

Implement:

* project list
* create project
* select/switch project
* project overview
* project status
* basic project workspace

Suggested initial project sections:

Overview
Tasks
Knowledge
Files
Activity

Keep the architecture generic.

Do not introduce Recruiting-specific, CRM-specific or sales-specific schemas yet.

---

# 5. KNOWLEDGE FOUNDATION

Implement an Obsidian-inspired knowledge structure within projects.

Do NOT clone Obsidian.

Take the useful concepts:

* human-readable notes
* Markdown-friendly content
* tags
* links
* project organization
* search-ready structure
* future backlinks/relationships

A knowledge item should minimally support:

* id
* projectId
* title
* body/content
* type
* tags
* createdAt
* updatedAt

Initial types may include:

* note
* decision
* research
* reference
* meeting
* result

Prepare the data model so relationships/backlinks can be expanded later.

Do not build a full graph database or visual knowledge graph in this phase.

---

# 6. RELATIONSHIP FOUNDATION

Provide a minimal extensible relationship/linking model or metadata approach.

Future relationships may include:

note → project
task → project
run → project
decision → task
research → company
candidate → recruiting project

Do not implement every future entity now.

Build the generic foundation.

---

# 7. PROJECT-AWARE MISSION CONTROL

Extend existing Mission Control so tasks/runs can reference and display project context.

At minimum, Mission Control should be capable of representing:

Project: AgenticOS
Task: Fix Jarvis runtime
Agent: Hermes
Status: Completed

or:

Project: Recruiting
Task: Source IAM candidates
Agent: Researcher
Status: Running

Add project filtering/context where appropriate.

Preserve existing Mission Control behavior.

---

# 8. JARVIS LIVE WORK FOUNDATION

Prepare the current Jarvis page for structured execution visibility.

The Live Work panel should support events such as:

* task started
* delegated
* agent working
* tool running
* browser/page opened
* file changed
* build running
* test running
* test passed
* blocked
* failed
* completed

The user should be able to see what Jarvis is doing without constantly navigating to Hermes/Codex/other agent pages.

Detailed agent pages may still exist for deep inspection.

The default experience should remain:

User talks to Jarvis → Jarvis shows current work.

Do not build a fake activity feed.

Use existing runtime/task/event information wherever possible.

---

# 9. JARVIS HOLOGRAPHIC RUNTIME VISUALIZATION

Evolve the existing Jarvis orb/head area into a functional holographic/neural runtime visualization.

This is NOT merely decorative.

The inside of Jarvis should visually represent actual AgenticOS runtime state.

The visual concept may include a holographic head/neural map with conceptual capability nodes such as:

* JARVIS
* RESEARCHER
* MEMORY
* HEMISPHERE
* VISION
* ORACLE

Only present modules as active when runtime state supports that.

Do not pretend inactive/unimplemented systems are running.

The visualization should feel like a living representation of AgenticOS activity rather than a copied social-media interface.

---

# 10. SEMANTIC COLOR SYSTEM

Color has operational meaning.

Use these meanings consistently:

## GREY / LOW CYAN

Idle / neutral / waiting

## BLUE

Listening / calm input / receiving user input

## CYAN / WHITE

Reasoning / processing / internal computation

## GREEN

Healthy / stable / successful / completed

## PURPLE

Repairing / fixing / corrective work / recovery

Purple specifically represents active repair/correction.

## YELLOW

Internal component attention / diagnostics / subsystem requiring attention or repair

## RED

Failure / blocked / unavailable / runtime error

## PINK

Delegated agent / secondary-agent collaboration / external worker activity

Do not use these colors arbitrarily for decoration where doing so would contradict their runtime meaning.

---

# 11. RUNTIME VISUAL BEHAVIOR

The holographic visualization should respond to actual state.

## IDLE

* low-energy neutral/cyan glow
* minimal movement

## LISTENING

* blue activity
* input waves / hemisphere response

## REASONING

* cyan/white neural pulses
* denser internal activity

## EXECUTING

* stronger network flow
* relevant operational nodes active

## DELEGATED

* pink secondary-agent activity
* visible relationship between Jarvis and active worker

## REPAIRING

* purple corrective/repair activity

## DIAGNOSTIC / INTERNAL ATTENTION

* yellow localized illumination

## FAILURE / BLOCKED

* red alert region/pulse

## COMPLETED

* green stabilization/completion pulse
* then return toward idle

## SPEAKING

* visible output/pulse synchronized to speaking state where practical

---

# 12. RUNTIME STATE SOURCE OF TRUTH

Do NOT drive the visualization using fake random state timers.

Use real AgenticOS runtime/events wherever possible.

Normalize a small runtime-state model if needed.

Suggested states:

* idle
* listening
* reasoning
* executing
* speaking
* completed
* warning
* error
* repairing
* delegated

Optional metadata:

* activeAgent
* activeProject
* activeTask
* activeTool
* provider
* model

The visualization consumes operational state.

The visualization must NOT become the source of operational truth.

---

# 13. PERFORMANCE

AgenticOS runs on resource-constrained hardware.

The holographic interface must therefore remain lightweight.

Requirements:

* avoid permanent high-frequency rendering while idle
* avoid unnecessary WebGL/3D frameworks
* prefer efficient CSS/SVG/Canvas techniques when suitable
* reduce/pause animation when window is inactive where practical
* avoid large dependencies solely for decorative effects
* graceful behavior on lower-powered systems

Do not sacrifice AgenticOS responsiveness for visual effects.

---

# 14. PROJECT CONTEXT BOUNDARIES

Project context must provide isolation.

If active project is:

Recruiting

Jarvis should primarily receive Recruiting project context.

If the user switches to:

AgenticOS

Jarvis should receive AgenticOS project context.

This prevents unrelated projects from contaminating each other's operational context.

Cross-project queries must remain possible intentionally.

Example:

"What are the highest priority tasks across all projects?"

That should intentionally query cross-project information rather than accidentally mixing context.

---

# 15. EXPECTED FUTURE WORKFLOW

The architecture should prepare AgenticOS for this workflow:

User:
"Jarvis, create a project for finding German companies that need IAM consultants."

Jarvis:

* creates/selects the project
* establishes objective/context
* creates appropriate work
* delegates execution when orchestration is available
* exposes execution through Live Work
* stores persistent results in Project/Knowledge
* exposes cross-project operational state in Mission Control

Another example:

"Jarvis, switch to AgenticOS and fix the provider selector."

Jarvis understands that AgenticOS is now the active project and operates within that context.

The user should ultimately manage Jarvis.

Jarvis should manage the worker agents.

---

# 16. PRESERVE CURRENT WORKING JARVIS

The following systems have already undergone significant repair and must not regress:

* direct conversation
* conversational history/context
* deictic follow-ups
* intent routing
* DeepSeek provider assignment/runtime truth
* empty-response fallback
* typed-vs-STT input ownership
* voice/TTS playback
* provider display truth
* center transcript scrolling
* independent History scrolling
* control/transcript/composer containment
* Electron/backend startup stability

Run regression verification where relevant.

---

# 17. DO NOT IMPLEMENT YET

Do NOT expand this phase into:

* OpenHuman integration
* complete autonomous orchestration rewrite
* complete long-term memory/retrieval
* full Obsidian clone
* graph database
* complete CRM
* recruiting-specific database
* lead-generation-specific database
* complex browser automation redesign
* arbitrary new agents
* unrelated provider refactoring

This is the architectural foundation.

Make it extensible rather than enormous.

---

# 18. IMPLEMENTATION APPROACH

Before editing:

Inspect the existing AgenticOS implementation.

Understand:

* existing persistence/database
* current workspace/project concepts
* Mission Control
* tasks/runs
* agent registry
* runtime event system
* Jarvis context assembly
* navigation
* existing Memory/Knowledge functionality
* current Jarvis visualization
* current state/status system

Then extend existing systems.

Do NOT create parallel implementations merely because they are easier.

Internally sequence implementation as necessary:

foundation
→ Projects/persistence
→ Knowledge
→ active-project context
→ Mission Control awareness
→ Live Work
→ holographic runtime visualization
→ integration/regression verification

Do not require the user to approve each internal implementation step.

Only stop for a genuine architectural decision that cannot safely be inferred from the repository or this specification.

---

# 19. ACCEPTANCE CRITERIA

PASS requires:

1. Projects exist as durable first-class entities.
2. Project can be created.
3. Project can be selected/switched.
4. Active project is visible.
5. Active-project metadata reaches Jarvis context.
6. Project switching does not corrupt conversation history.
7. Each project has a usable basic workspace.
8. Knowledge notes/items can be created and viewed inside projects.
9. Knowledge items belong to the correct project.
10. Mission Control can associate/display project context.
11. Jarvis has a functional Live Work foundation.
12. Live Work consumes real structured operational events where available.
13. Holographic Jarvis visualization responds to actual runtime state.
14. Semantic colors match this specification.
15. Idle animation is lightweight.
16. Existing Jarvis conversation continues working.
17. Voice continues working.
18. Provider/runtime display remains truthful.
19. Transcript and History scrolling remain functional.
20. Composer/control containment remains correct.
21. Server/frontend TypeScript checks pass.
22. Production builds pass.
23. Relevant existing tests remain green.
24. New architecture receives appropriate focused tests.

---

# 20. COMPLETION REPORT

When implementation and verification are complete, return:

AGENTICOS PROJECT + KNOWLEDGE FOUNDATION: PASS

Then report:

1. Architecture implemented
2. Exact files changed
3. Persistence/data model
4. Project lifecycle
5. Active-project context flow into Jarvis
6. Knowledge implementation
7. Mission Control integration
8. Live Work implementation
9. Holographic runtime-state implementation
10. Color/state mapping
11. Performance considerations
12. Live Electron verification
13. Tests/build results
14. Genuine remaining work

Do not return only an architecture proposal.

Implement, integrate, test and verify the defined foundation.
