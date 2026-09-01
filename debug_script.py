import os
import sys
import json
from datetime import datetime

# Set up debugging environment
debug_dir = "D:\\AgenticOS\\debug_logs"
os.makedirs(debug_dir, exist_ok=True)

def log_debug_info():
    print("Debugging Jarvis behavior...")
    
    # Log current working directory
    print(f"Current working directory: {os.getcwd()}")
    
    # Log environment variables
    print("Environment variables relevant to AgenticOS:")
    for key in ['AGENTIC_OS_PATH', 'MODEL_PROVIDER', 'TTS_VOICE']:
        value = os.environ.get(key, "Not set")
        print(f"  {key}: {value}")
        
    # Check if D:\AgenticOS exists
    if os.path.exists("D:\\AgenticOS"):
        print("D:\\AgenticOS directory exists.")
        try:
            git_status = os.popen('cd D:\\AgenticOS && git status').read()
            print("Git status of AgenticOS:")
            print(git_status)
        except Exception as e:
            print(f"Failed to get git status: {e}")
    else:
        print("D:\\AgenticOS directory does NOT exist.")
        
    # Log Python version
    print(f"Python version: {sys.version}")
    
    # Log current date and time
    print(f"Current time: {datetime.now()}")

if __name__ == "__main__":
    log_debug_info()