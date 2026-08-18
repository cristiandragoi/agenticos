# 1) Start the Ollama daemon (if not already running)
Start-Process ollama -ArgumentList serve -WindowStyle Hidden

# Give it a second to start
Start-Sleep -Seconds 2

# 2) Pull the Ornith 9B local model
# Note: In our current local mock environment, pulling "ornith:9b" might throw a 404 if not found in public registry, 
# but this is the exact command as requested.
ollama pull ornith:9b

# 3) Optional: also pull the 35B MoE variant
# ollama pull ornith:35b-moe

# 4) Export environment variables for Agentic OS / Antigravity
$env:ORNITH_SERVER_URL="http://localhost:11434"
$env:ORNITH_MODEL_NAME="ornith:9b"

# 5) Quick health check to confirm Ornith is responding
Invoke-RestMethod -Uri "$env:ORNITH_SERVER_URL/api/chat" `
  -Method Post `
  -Headers @{ "Content-Type" = "application/json" } `
  -Body (ConvertTo-Json @{
    model = $env:ORNITH_MODEL_NAME
    messages = @(
      @{ role = "system"; content = "You are Ornith 1.0, a self-scaffolding agent controlling Agentic OS." },
      @{ role = "user"; content = "Say hello and confirm you are online." }
    )
    stream = $false
  } -Depth 10)
