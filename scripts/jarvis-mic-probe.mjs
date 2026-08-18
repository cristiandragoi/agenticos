// Probe the LIVE #/jarvis page: mic/composer state, voice indicators,
// AudioContext presence, and whether getUserMedia still grants audio.
import puppeteer from 'puppeteer-core';
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
const pages = await browser.pages();
const page = pages.find((p) => p.url().startsWith('file:')) || pages[0];
const info = await page.evaluate(async () => {
  const out = { url: location.href };
  const body = document.body.innerText;
  // Mic / listening indicators in the UI text
  const micLines = body.split('\n').filter((l) => /listen|mic|voice|speak|STT|TTS|conversation/i.test(l)).slice(0, 20);
  out.micLines = micLines;
  // AudioContexts on the page
  out.audioContexts = window.__vtLive ? 'capture-hook-present' : 'no-hook';
  // Try a real getUserMedia probe (system-level mic access)
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const tracks = stream.getTracks().map((t) => ({ kind: t.kind, enabled: t.enabled, readyState: t.readyState }));
    tracks.forEach((t) => t.stop && t.stop());
    out.gum = { ok: true, tracks };
  } catch (e) {
    out.gum = { ok: false, err: String(e && e.message ? e.message : e) };
  }
  return out;
});
console.log('URL:', info.url);
console.log('MIC_LINES:', JSON.stringify(info.micLines, null, 1));
console.log('GETUSERMEDIA:', JSON.stringify(info.gum));
await browser.disconnect();
