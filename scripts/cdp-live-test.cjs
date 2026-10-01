const WebSocket = require('ws');
const http = require('http');

async function getPageTarget() {
  return new Promise((resolve, reject) => {
    http.get('http://127.0.0.1:9222/json', (res) => {
      let data = '';
      res.on('data', (d) => data += d);
      res.on('end', () => {
        try {
          const list = JSON.parse(data);
          const page = list.find((t) => t.type === 'page');
          if (page) resolve(page);
          else reject(new Error('No page target found'));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

function sendCDP(ws, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = Math.floor(Math.random() * 1000000);
    const handler = (msg) => {
      try {
        const res = JSON.parse(msg);
        if (res.id === id) {
          ws.off('message', handler);
          if (res.error) reject(new Error(JSON.stringify(res.error)));
          else resolve(res.result);
        }
      } catch {}
    };
    ws.on('message', handler);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evalInPage(ws, expr, awaitPromise = true) {
  const res = await sendCDP(ws, 'Runtime.evaluate', {
    expression: expr,
    awaitPromise,
    returnByValue: true,
  });
  if (res.exceptionDetails) {
    throw new Error('Eval exception: ' + JSON.stringify(res.exceptionDetails));
  }
  return res.result?.value;
}

async function main() {
  console.log('Connecting to AgenticOS via CDP on port 9222...');
  const page = await getPageTarget();
  console.log('Target found:', page.title, page.url);

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve) => ws.once('open', resolve));
  console.log('WebSocket CDP connected.');

  await sendCDP(ws, 'Runtime.enable');
  await sendCDP(ws, 'Page.enable');

  const consoleLogs = [];
  ws.on('message', (msg) => {
    try {
      const data = JSON.parse(msg);
      if (data.method === 'Runtime.consoleAPICalled') {
        const text = data.params.args.map((a) => a.value || JSON.stringify(a)).join(' ');
        consoleLogs.push({ type: data.params.type, text, time: Date.now() });
        if (text.includes('[Voice') || text.includes('[VTimeline') || text.includes('speak') || text.includes('Audio')) {
          console.log('[BROWSER CONSOLE]', text);
        }
      }
    } catch {}
  });

  // Step 1: Navigate to #/jarvis
  console.log('\n==================================================');
  console.log('STEP 1: Navigate to #/jarvis and Inspect Window/DOM');
  console.log('==================================================');
  await evalInPage(ws, `window.location.hash = '/jarvis';`);
  await new Promise((r) => setTimeout(r, 2000));

  const pageInfo = await evalInPage(ws, `(() => {
    return {
      url: window.location.href,
      protocol: window.location.protocol,
      hasStudio: Boolean(document.querySelector('[data-testid="jarvis-studio"]')),
      hasDevHandle: Boolean(window.__JARVIS_DEV__),
      voiceRuntime: localStorage.getItem('jarvis_voice_runtime'),
      buttons: Array.from(document.querySelectorAll('button')).map(b => b.textContent?.trim()).filter(Boolean).slice(0, 8),
    };
  })()`);
  console.log('Page Info:', pageInfo);

  // Step 2: Test AudioContext & Autoplay policy
  console.log('\n==================================================');
  console.log('STEP 2: Inspect AudioContext & Autoplay Policy');
  console.log('==================================================');
  const audioContextInfo = await evalInPage(ws, `(async () => {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctor();
    const initialState = ctx.state;
    let resumeResolved = false;
    let resumeError = null;
    try {
      await ctx.resume();
      resumeResolved = true;
    } catch (e) {
      resumeError = e.message;
    }
    return {
      audioContextSupported: Boolean(Ctor),
      initialState,
      stateAfterResume: ctx.state,
      resumeResolved,
      resumeError,
      sampleRate: ctx.sampleRate,
    };
  })()`);
  console.log('AudioContext Info:', audioContextInfo);

  // Step 3: Layer 2 Test - Direct Renderer Audio Playback Test
  console.log('\n==================================================');
  console.log('STEP 3: Layer 2 Test — Direct Audio Playback in Renderer');
  console.log('==================================================');
  const layer2Result = await evalInPage(ws, `(async () => {
    const text = 'Hello from AgenticOS renderer audio test.';
    const res = await fetch('http://127.0.0.1:4600/api/voice/speak', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });
    const status = res.status;
    const contentType = res.headers.get('Content-Type');
    const blob = await res.blob();
    const byteLength = blob.size;
    const audioUrl = URL.createObjectURL(blob);

    const audio = new Audio(audioUrl);
    let playCalled = false;
    let playResolved = false;
    let playRejected = null;
    let playbackStartEvent = false;
    let playbackEndEvent = false;
    let playbackError = null;

    audio.onplay = () => { playbackStartEvent = true; };
    audio.onended = () => { playbackEndEvent = true; };
    audio.onerror = (e) => { playbackError = e?.message || 'Error event on audio element'; };

    playCalled = true;
    try {
      await audio.play();
      playResolved = true;
    } catch (err) {
      playRejected = err.message;
    }

    // Wait 3 seconds for playback
    await new Promise(r => setTimeout(r, 3000));

    return {
      responseText: text,
      httpStatus: status,
      contentType,
      byteLength,
      audioUrlCreated: Boolean(audioUrl),
      audioElementCreated: Boolean(audio),
      playCalled,
      playResolved,
      playRejected,
      playbackStartEvent,
      playbackEndEvent,
      playbackError,
      audioPaused: audio.paused,
      audioCurrentTime: audio.currentTime,
      audioDuration: audio.duration,
    };
  })()`);
  console.log('Layer 2 Direct Audio Result:');
  console.log(JSON.stringify(layer2Result, null, 2));

  // Step 4: Layer 3 Test - Real Jarvis Voice Response End-to-End
  console.log('\n==================================================');
  console.log('STEP 4: Layer 3 Test — Real Jarvis Response End-to-End');
  console.log('==================================================');

  // Trigger audio unlock / start conversation
  await evalInPage(ws, `(() => {
    // Unlock voice runtime
    if (window.__JARVIS_DEV__?.voiceRef?.current?.unlockAudio) {
      window.__JARVIS_DEV__.voiceRef.current.unlockAudio();
    }
    const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('START CONVERSATION'));
    if (btn) btn.click();
  })()`);

  await new Promise((r) => setTimeout(r, 1000));

  // Programmatically trigger real Jarvis turn: "Say hello."
  console.log('Sending message "Say hello." via chatRef on "voice" channel...');
  const turnResult = await evalInPage(ws, `(async () => {
    if (!window.__JARVIS_DEV__ || !window.__JARVIS_DEV__.chatRef?.current) {
      return { error: 'window.__JARVIS_DEV__.chatRef not found' };
    }
    const turnId = ++window.__JARVIS_DEV__.turnSeqRef.current;
    window.__JARVIS_DEV__.voiceRef?.current?.armSpeech?.(turnId);
    window.__JARVIS_DEV__.chatRef.current.sendMessage('Say hello.', 'voice', turnId);
    return { turnInitiated: true, turnId };
  })()`);
  console.log('Turn result:', turnResult);

  // Monitor the turn for 8 seconds
  console.log('Waiting 8 seconds for streaming response and TTS playback...');
  await new Promise((r) => setTimeout(r, 8000));

  const endState = await evalInPage(ws, `(() => {
    const messages = Array.from(document.querySelectorAll('[data-testid="jarvis-chat-message"], [class*="message"]')).map(m => m.textContent?.trim()).slice(-4);
    const micBtn = document.querySelector('[data-testid="jarvis-mic-button"]');
    const voiceState = window.__JARVIS_DEV__?.voiceRef?.current?.voiceState;
    const isSpeaking = window.__JARVIS_DEV__?.voiceRef?.current?.isSpeaking;
    return {
      voiceState,
      isSpeaking,
      micBtnText: micBtn?.textContent?.trim(),
      recentMessages: messages,
    };
  })()`);
  console.log('End State:', endState);

  console.log('\n==================================================');
  console.log('ALL RELEVANT CONSOLE LOGS DURING RUN:');
  console.log('==================================================');
  for (const log of consoleLogs) {
    console.log(`[${new Date(log.time).toISOString()}] [${log.type}] ${log.text}`);
  }

  ws.close();
}

main().catch(console.error);
