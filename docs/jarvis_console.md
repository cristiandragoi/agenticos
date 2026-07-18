# Jarvis Console

The Jarvis Console (`/jarvis`) is the central command interface for communicating directly with the primary Agentic OS model (`qwythos:9b`). 

It has been completely redesigned to offer a clean, robust, and extensible UX.

## 1. Overview of the UI
The new Jarvis Console is divided into three primary sections:
- **Main Chat (Left/Center)**: A large, readable message feed. System messages, user inputs, and Jarvis replies are color-coded and styled distinctively. The input area uses a resizable textarea (shift+enter for newlines, enter to send) and a clean "Send" button.
- **Agent Fleet Status (Right Sidebar)**: A compact view showing the live status of all Agentic OS nodes (e.g., Qwythos 9B, Architect, Scout). This helps you monitor the fleet's health at a glance.
- **Pipeline Logs (Bottom)**: A collapsible drawer that displays raw execution logs from the Jarvis Pipeline. If Jarvis triggers a background task (like routing to the Qwable build pipeline), you can open this drawer to see real-time updates.

## 2. Using the Console
1. **Navigating to Jarvis**: Open `http://localhost:5173/jarvis` in your browser.
2. **Asking Questions**: Type your query into the input field at the bottom. E.g., *"What is the status of the deployment?"* or *"Analyze the dependency graph."*
3. **Checking Status**: The top bar displays "SYSTEMS NOMINAL" when the pipeline is idle. If a task is executing, it will show the active node count. The right sidebar shows if specific agent nodes are online.
4. **Error Handling**: If the connection to Ollama fails or times out, a clear red system message will appear in the chat explaining the error.

## 3. Extending the Component
The `JarvisDashboard.tsx` component is built using React, Tailwind CSS, and Lucide Icons.

### Modifying the Chat Bubble
To change how messages are displayed, edit the `ChatBubble` component within `src/pages/JarvisDashboard.tsx`. It accepts a `ChatMsg` object (`{ role, text, ts, isError }`).

### Adding New Sidebar Panels
The Agent Fleet Status is rendered in the right-hand column (`w-72 shrink-0 border-l...`). You can add new sections below it by adding new `<div>` blocks inside that container.

### Integrating New APIs
If you want to route commands to a different backend endpoint, modify the `handleCommand` function. Currently, standard commands are POSTed directly to `http://localhost:11434/api/generate` with the `qwythos:9b` model string. Qwable commands are automatically intercepted and sent to `runPipeline(cmd)`.
