import sys

sys.setrecursionlimit(200)

print("=" * 70)
print("ARCHITECTURE INSPECTION REPORT — CODING AGENT MVP")
print("=" * 70)
print()

# Reuse existing service layer patterns  
existing_services = [
    "voice/piperTts.ts",
    "voice/localTts.ts", 
    "voice/edgeTts.ts"
]

print(f"Existing services ({len(existing_services)}):")
for svc in existing_services:
    print(f"  - {svc}")
print()

# Route handlers  
existing_routes = [
    "routers/voice.ts"
]

print(f"Route handlers that can handle requests:")
for route in existing_routes:
    print(f"  - {route}")
print()


## STATE MACHINE DEFINITION

# Define coding run states
states_map = {
    "DRAFT": "Initial task creation",
    "PLANNING": "Agent generating implementation plan",  
    "WAITING_FOR_PLAN_APPROVAL": "Human review pending",
    "PREPARING_WORKSPACE": "Setting up isolated worktree/run branch",
    "EXECUTING": "Running approved implementation steps",
    "TESTING": "Executing npm test / lint checks",
    "BUILDING": "Running npm run build",  
    "REVIEW_READY": "Build artifact ready for preview",
    "WAITING_FOR_HUMAN_REVIEW": "User must review changes/diff",
    "APPROVED": "Human approved, proceed to next phase",
    "REJECTED": "Human rejected, agent re-plans or stops",  
    "FAILED": "Execution failed (test/build error)"
}

states_order = [
    "DRAFT", "PLANNING", "WAITING_FOR_PLAN_APPROVAL", 
    "PREPARING_WORKSPACE", "EXECUTING", "TESTING", 
    "BUILDING", "REVIEW_READY", "WAITING_FOR_HUMAN_REVIEW", 
    "APPROVED", "REJECTED", "FAILED"
]

print(f"Coding Run State Machine ({len(states_order)} states):")
for idx, state in enumerate(states_order):
    desc = states_map.get(state, "")
    print(f"  [{idx}] {state}")
    if desc:
        print(f'      → {desc}')
print()


## PERMISSION SCOPES

permissions = {
    "READ_WORKSPACE": [
        "ls", "cat", "head", 
        "git status", "git log -n 5",
        "*.json", "*.js", "*.ts", "*.css"
    ],
    "WRITE_WORKSPACE": [
        "write_file", "patch", 
        "terminal (npm test, npm run build only)"
    ],  
    "READ_FILE": ["read_file(path)"],
    "SEARCH_FILES": ["search_files(pattern)"],
    "EXECUTE_COMMAND": ["terminal(command)", restricted: ['npm', 'node']],
    "NETWORK_ACCESS": False,  # OFF by default
    "GIT_PUSH": False,        # NEVER enable
    "DEPLOYMENT": False       # NEVER enable
}

print(f"Scoped tool permissions:")
for perm, config in permissions.items():
    if isinstance(config, list):
        print(f"  • {perm}: {' '.join(config)}")
    else:
        print(f"  • {perm}: {config}")
print()
