#!/bin/bash

# 1) Start the Ollama daemon (if not already running)
ollama serve &

# 2) Pull the Ornith 9B local model
ollama pull ornith:9b

# 3) Optional: also pull the 35B MoE variant
# ollama pull ornith:35b-moe

# 4) Export environment variables for Agentic OS / Antigravity
export ORNITH_SERVER_URL="http://localhost:11434"
export ORNITH_MODEL_NAME="ornith:9b"

# 5) Quick health check to confirm Ornith is responding
curl -X POST "$ORNITH_SERVER_URL/api/chat" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "'"$ORNITH_MODEL_NAME"'",
    "messages": [
      {"role": "system", "content": "You are Ornith 1.0, a self-scaffolding agent controlling Agentic OS."},
      {"role": "user", "content": "Say hello and confirm you are online."}
    ]
  }'
