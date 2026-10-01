const { app, BrowserWindow } = require('electron');
const path = require('path');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 600,
    height: 400,
    show: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    }
  });

  win.webContents.setAudioMuted(false);

  // Load a simple page
  await win.loadURL('data:text/html,<html><body><h1>Testing Audio Playback</h1><div id="log"></div></body></html>');

  const result = await win.webContents.executeJavaScript(`
    (async () => {
      const logs = [];
      const log = (msg, obj) => logs.push({ msg, obj, time: Date.now() });

      try {
        log('Fetching TTS from backend...');
        const res = await fetch('http://127.0.0.1:4600/api/voice/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: 'Hello, this is Jarvis testing audio output.' })
        });
        log('TTS HTTP Status: ' + res.status);
        const data = await res.json();
        log('TTS Provider: ' + data.provider);
        log('TTS Voice: ' + data.voice);
        log('TTS Format: ' + data.format);
        log('AudioData length: ' + (data.audioData ? data.audioData.length : 0));

        if (!data.audioData) {
          return { error: 'No audioData returned', logs };
        }

        const mime = data.format || 'audio/mpeg';
        const src = 'data:' + mime + ';base64,' + data.audioData;
        const audio = new Audio(src);
        audio.volume = 1.0;

        const events = [];
        audio.onplay = () => events.push('play');
        audio.onplaying = () => events.push('playing');
        audio.onended = () => events.push('ended');
        audio.onerror = (e) => events.push('error: ' + (audio.error ? audio.error.message : 'unknown'));

        log('Calling audio.play()...');
        const playPromise = audio.play();
        let playResolved = false;
        let playRejected = null;
        try {
          await playPromise;
          playResolved = true;
          log('audio.play() resolved successfully');
        } catch (e) {
          playRejected = e.message || String(e);
          log('audio.play() REJECTED: ' + playRejected);
        }

        // Wait up to 3 seconds for playback to start or complete
        await new Promise(r => setTimeout(r, 3000));

        return {
          logs,
          events,
          playResolved,
          playRejected,
          currentTime: audio.currentTime,
          duration: audio.duration,
          paused: audio.paused,
          muted: audio.muted,
          volume: audio.volume
        };
      } catch (err) {
        log('Fatal error: ' + (err.message || String(err)));
        return { fatalError: err.message, logs };
      }
    })()
  `);

  console.log('--- TEST RENDERER AUDIO RESULT ---');
  console.log(JSON.stringify(result, null, 2));
  app.exit(0);
});
