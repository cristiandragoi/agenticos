const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function discoverAntigravitySession() {
  const userProfile = process.env.USERPROFILE || 'C:\\Users\\cd-pr';
  const agentapiBat = path.join(userProfile, '.gemini', 'antigravity', 'bin', 'agentapi.bat');
  const desktopExe = path.join(userProfile, 'AppData', 'Local', 'Programs', 'antigravity', 'Antigravity.exe');
  
  if (!fs.existsSync(agentapiBat)) {
    return { ok: false, error: `agentapi CLI not found at ${agentapiBat}` };
  }

  const convDir = path.join(userProfile, '.gemini', 'antigravity', 'conversations');
  if (!fs.existsSync(convDir)) {
    return { ok: false, error: `Antigravity conversations dir not found at ${convDir}` };
  }

  const files = fs.readdirSync(convDir)
    .filter(f => f.endsWith('.db'))
    .map(f => ({ name: f, mtime: fs.statSync(path.join(convDir, f)).mtime.getTime() }))
    .sort((a, b) => b.mtime - a.mtime);

  if (files.length === 0) {
    return { ok: false, error: 'No Antigravity conversations found' };
  }

  const activeConvId = files[0].name.replace(/\.db$/, '');
  try {
    const raw = execFileSync(agentapiBat, ['get-conversation-metadata', activeConvId], {
      encoding: 'utf8',
      timeout: 8000,
      shell: true,
    });
    const parsed = JSON.parse(raw);
    const rootId = parsed.response?.conversationMetadata?.metadata?.rootConversationId || activeConvId;
    return {
      ok: true,
      activeConversationId: rootId,
      agentapiPath: agentapiBat,
      desktopExePath: desktopExe,
      metadata: parsed.response?.conversationMetadata?.metadata,
    };
  } catch (err) {
    return {
      ok: false,
      error: `Failed to query Antigravity session ${activeConvId}: ${err.message}`,
      activeConversationId: activeConvId,
      agentapiPath: agentapiBat,
      desktopExePath: desktopExe,
    };
  }
}

const res = discoverAntigravitySession();
console.log('Antigravity Session Discovery:', JSON.stringify(res, null, 2));
