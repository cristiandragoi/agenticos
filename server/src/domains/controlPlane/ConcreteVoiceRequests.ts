/** Narrow repairs for observed voice requests; no execution or planning authority. */
function withoutBrowserLaunchPrefix(text: string): string {
  // A browser named in a compound launch request is not a YouTube channel.
  return text.replace(/^(?:(?:jarvis|please)[,\s]+)*(?:open|launch|start)\s+(?:google\s+chrome|chrome|microsoft\s+edge|edge|firefox|brave|comet)(?:\s+browser)?\s+(?:and|then)\s+(?=(?:open|go\s+to|navigate\s+to)\s+youtube\b)/i, '');
}
export function isYouTubeHomeRequest(text: string): boolean {
  return /^(?:(?:jarvis|please)[,\s]+)*(?:(?:go\s+to|navigate\s+to|open)\s+)+(?:youtube)[.!?]*$/i.test(withoutBrowserLaunchPrefix(text.trim()));
}
export function parseYouTubeChannelRequest(text: string, youtubeContext = false): { channel: string; openVideo: boolean } | null {
  if (/\b(?:delegate\s+to|(?:ask|tell|have)\s+(?:hermes|codex|antigravity))\b/i.test(text) || /^(?:why|how|what)\b/i.test(text.trim())) return null;
  if ((!/\byoutube\b/i.test(text) && !youtubeContext) || /\b(?:don't|do\s+not|never|cannot|can't)\s+(?:open|go|navigate|find|locate|search)/i.test(text)) return null;
  text = withoutBrowserLaunchPrefix(text.trim());
  const verbs = '(?:navigate\\s+to|go\\s+to|locate|find|search(?:\\s+for)?|open|play|watch)';
  const requests = [...text.matchAll(new RegExp(`\\b${verbs}\\s+(.+?)(?=\\s+(?:and|then)\\s+${verbs}\\b|[.!?]|$)`, 'gi'))];
  const candidates = requests.map(match => match[1].trim()
    .replace(/^(?:go\s+to\s+)+/i, '').replace(/\s+(?:on|in)\s+youtube$/i, '')
    .replace(/^(?:the\s+)?channel\s+(?:for\s+)?/i, '').replace(/\s+channel$/i, '').replace(/^the\s+/i, '')
    .replace(/,/g, ' ').replace(/\s+/g, ' ').replace(/\bJulian\s+Goldy\b/i, 'Julian Goldie'))
    .filter(candidate => candidate && !/^(?:youtube|it|there|that|the|a|(?:the|a)?\s*channel)$/i.test(candidate) && !/^(?:one|a|any|the\s+first)\s+video\b/i.test(candidate));
  if (candidates.length !== 1) return null;
  const channel = candidates[0];
  if (channel.length > 120 || /\byoutube\b|\b(?:and|then)\b/i.test(channel)) return null;
  return { channel, openVideo: /\b(?:open|play|watch)\s+(?:one|a|any|the\s+first)\s+video\b/i.test(text) };
}

export function parseConcreteAppRequest(text: string, previousUserText = '', failedApplication = ''): string | null {
  // Observed ASR spellings of the app name explicitly confirmed by the user.
  text=text.replace(/\b(?:hammas|hamas)\s*(?:one|1)\b/gi,'Hermes One');
  if (/^(?:jarvis[, ]+)?open\s+(?:microsoft\s+)?words?\s+document[.!?]*$/i.test(text.trim())) return 'Word';
  const messagingApp = text.trim().match(/^(?:(?:jarvis|please)[,\s]+)*(?:go\s+to|navigate\s+to)\s+(WhatsApp|Telegram)[.!?]*$/i);
  if (messagingApp) return /^whatsapp$/i.test(messagingApp[1]) ? 'WhatsApp' : 'Telegram';
  if (/\b(?:delegate\s+to|(?:ask|tell|have)\s+(?:hermes|codex|antigravity))\b/i.test(text)) return null;
  // Confusable names are normalized only after an explicit application command.
  const command = [...text.matchAll(/\b(?:open|launch|start|bring\s+up)\s+(?:the\s+)?(whats\s*app|what['’]?s\s+up|hermes|hammers|hammars|hms(?=\s*(?:one|1)\b)|hermos)(?:\s*(one|1))?\b/gi)]
    .filter(match => !/\b(?:not|never|cannot|can't|don't|do\s+not)\s*$/i.test(text.slice(0, match.index))).at(-1);
  const remainder = command ? text.slice((command.index || 0) + command[0].length).trim().replace(/[.!?]+$/, '').trim() : '';
  if (command && !remainder && !/\b(?:send|message|text)\b/i.test(text)) {
    return /^(?:hermes|hammers|hammars|hms|hermos)$/i.test(command[1]) ? 'Hermes One' : 'WhatsApp';
  }
  // A bare correction is actionable only when the earlier user asked to open it.
  if (/^(?:whats\s*app|what['’]?s\s+up)[?.!\s]*$/i.test(text) &&
      /\bopen\s+(?:whats\s*app|what['’]?s\s+up)\b/i.test(previousUserText)) return 'WhatsApp';
  if (/\b(?:bottom|taskbar|desktop|pinned)\b/i.test(text) &&
      /\b(?:find|locate|it['’]?s|it\s+is)\b/i.test(text) &&
      /^(?:hermes|hammers|hammars)(?:\s+(?:one|1))?$/i.test(failedApplication)) return 'Hermes One';
  return null;
}
