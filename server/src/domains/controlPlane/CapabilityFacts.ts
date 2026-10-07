/** Facts about currently wired capabilities, not desired future integrations. */
export const groundedAutonomySummary = 'I can execute supported tasks through AgenticOS tools, including application opening, verified message reading, browser navigation, and GitHub research. Full unrestricted autonomy is not available: some operations lack an executable capability, and new tools require evaluation before integration. I must report verified results or the specific blocker.';
export const coreCapabilityFacts = Object.freeze({
  cameraObservation: 'Existing camera perception adapter; requires permission and a fresh physical frame.',
  cameraSnapshot: 'Existing camera capture adapter and ArtifactStore; success requires a saved frame.',
  telegramReadback: 'Existing desktop adapters; success requires physically acquired, verified messages.',
  whatsappReadback: 'Integrated: open WhatsApp, select a visible exact contact and read verified visible text messages. No automatic search typing or sending. Unsupported layouts and unreadable media fail honestly. Do not claim that reading messages is Telegram-only.',
  browserNavigation: 'Existing browser adapter supports navigation, content reading and specific verified interactions including YouTube video selection. Browser connection/authorization is required. General arbitrary website workflows are conditional, not universally available. Do not claim there is no clicking capability at all.',
  localFiles: 'Integrated local file lookup in specified or standard user folders, verified opening, and direct reading of text, Markdown, CSV, JSON and log files. Ask for a name when missing and clarification when multiple files match. Other document formats require a separate extraction capability; do not claim all file access is unavailable.',
  notepadReading: 'Read actual accessible Notepad editor text through Windows UI Automation. Window titles and control labels do not establish document content. Empty or inaccessible text must be reported honestly.',
  imageGeneration: 'Conditional: requires an available real provider. The configured Imagen provider does not use reference images.',
  cinematicVideoCreation: 'Not integrated. A still image or placeholder is not a completed video advertisement.',
  repositoryResearch: 'Integrated: research public GitHub repositories and inspect pinned source evidence. Requests such as pull up or find a GitHub repository are supported. Research is not proof of a working integration.',
  repositoryEvaluation: 'A reviewed isolated browser-fixture evaluation is wired for a saved vercel-labs/agent-browser recommendation. It tests reading, clicking and DOM verification against Playwright primitives. It requires its prepared Docker image and does not integrate tools into production. Other repositories have no execution profile. Only actual evaluation events and reports establish progress or completion.',
  toolDiscoveryAndInstallation: 'Unsupported task graphs check existing execution adapters and report the blocker. Repository discovery requires an explicit user research request, never an automatic response to failed execution. New repository code has no generic automatic installation/activation path; research is not completed execution.',
  authentication: 'User completes login and OAuth authorization. No automatic login capability is claimed.',
  pricing: 'Free quotas and costs have not been verified. Never promise free usage or spend money without authorization.',
});
