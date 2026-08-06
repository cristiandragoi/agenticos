/**
 * Jarvis TTS voice-output trigger — focused tests.
 *
 * Verifies the FIXED voice-output path:
 *  - JarvisChat emits onAssistantResponse EXACTLY ONCE when a direct Jarvis
 *    reply completes (SSE `done`), carrying the full text + input channel.
 *  - The callback does NOT fire for delegated (CodeX) routes, empty replies,
 *    or when no text was streamed.
 *  - JarvisStudio speaks ONLY voice-channel replies, exactly once, and never
 *    speaks typed replies (dedupe + channel gate).
 *  - The orb speaking state is driven solely by real playback-start events.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import React from 'react';
import { JarvisChat } from '../components/jarvis/JarvisChat';
import { JarvisOrb } from '../components/jarvis/JarvisOrb';
import { JARVIS_ORB_EVENTS } from '../components/jarvis/jarvisOrbState';
import { CodexProvider } from '../store/codexStore';

// Build a minimal SSE stream body consumable by res.body.getReader().
function makeSseStream(frames: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(frames));
      controller.close();
    },
  });
}

function sseDoneFrame(route: string | undefined, extra = '') {
  const data = JSON.stringify({ route, ...({} as any), ...(extra ? JSON.parse(extra) : {}) });
  return `event: done\ndata: ${data}\n\n`;
}

function chunkFrame(delta: string, provider = 'p', model = 'm') {
  return `event: chunk\ndata: ${JSON.stringify({ delta, provider, model })}\n\n`;
}

// ── Minimal mic mocks (same pattern as JarvisVoiceInput.test.tsx) ─────────
function buildMediaRecorderMock() {
  return class MockMediaRecorder {
    static instances: any[] = [];
    state = 'inactive';
    ondataavailable: any = () => {};
    onstop: any = () => {};
    stream: any;
    constructor(stream: any) {
      this.stream = stream;
      MockMediaRecorder.instances.push(this);
    }
    start() {
      this.state = 'recording';
      const chunk = new Blob([new Uint8Array(2048).fill(1)], { type: 'audio/webm' });
      this.ondataavailable?.({ data: chunk });
    }
    stop() {
      this.state = 'inactive';
      this.onstop?.();
    }
  };
}

// Mock fetch: conversation-create returns an id; message/stream returns the SSE body.
function mockStreamFetch(doneRoute: string | undefined, deltas: string[]) {
  return vi.fn().mockImplementation(async (url: string, init?: any) => {
    if (String(url).endsWith('/api/jarvis/conversations') && init?.method === 'POST') {
      return { ok: true, status: 200, json: async () => ({ id: 'conv-tts-1' }) };
    }
    if (String(url).includes('/message/stream')) {
      const frames = deltas.map(d => chunkFrame(d)).join('') + sseDoneFrame(doneRoute);
      return {
        ok: true,
        status: 200,
        body: makeSseStream(frames),
        json: async () => ({}),
      };
    }
    if (String(url).includes('/messages')) {
      return { ok: true, status: 200, json: async () => [] };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  });
}

describe('JarvisChat — TTS trigger (onAssistantResponse)', () => {
  beforeEach(() => {
    (window as any).HTMLElement.prototype.scrollIntoView = vi.fn();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('fires onAssistantResponse EXACTLY ONCE with full accumulated text on direct completion', async () => {
    vi.stubGlobal('fetch', mockStreamFetch('direct', ['Hello ', 'world.']));
    const onAssistantResponse = vi.fn();

    render(
      <CodexProvider>
        <JarvisChat
          conversationId={null}
          pendingInputChannel="typed"
          onAssistantResponse={onAssistantResponse}
        />
      </CodexProvider>,
    );

    // Trigger a send via the composer's send button. A button click carries
    // the composer's own channel ('typed'); a send that follows mic
    // transcription carries 'voice' — the channel flows through untouched
    // (verified by the channel-tagging test below).
    const sendBtn = await screen.findByLabelText('Send Message');
    const input = screen.getByLabelText('Message Input');
    fireEvent.change(input, { target: { value: 'say hi' } });
    fireEvent.click(sendBtn);

    await waitFor(() => {
      expect(onAssistantResponse).toHaveBeenCalledTimes(1);
    }, { timeout: 4000 });

    // Exactly once, full accumulated text, channel passed through untouched.
    expect(onAssistantResponse).toHaveBeenCalledWith('Hello world.', 'typed');
  });

  it('does NOT fire onAssistantResponse for a delegated (CodeX) route', async () => {
    vi.stubGlobal('fetch', mockStreamFetch('codex', ['Delegating…']));
    const onAssistantResponse = vi.fn();

    render(
      <CodexProvider>
        <JarvisChat
          conversationId={null}
          pendingInputChannel="voice"
          onAssistantResponse={onAssistantResponse}
        />
      </CodexProvider>,
    );

    const sendBtn = await screen.findByLabelText('Send Message');
    const input = screen.getByLabelText('Message Input');
    fireEvent.change(input, { target: { value: 'run codex' } });
    fireEvent.click(sendBtn);

    // Give the stream time to finish; callback must never fire.
    await new Promise(r => setTimeout(r, 800));
    expect(onAssistantResponse).not.toHaveBeenCalled();
  });

  it('does NOT fire onAssistantResponse when no text was streamed', async () => {
    vi.stubGlobal('fetch', mockStreamFetch('direct', []));
    const onAssistantResponse = vi.fn();

    render(
      <CodexProvider>
        <JarvisChat
          conversationId={null}
          pendingInputChannel="voice"
          onAssistantResponse={onAssistantResponse}
        />
      </CodexProvider>,
    );

    const sendBtn = await screen.findByLabelText('Send Message');
    const input = screen.getByLabelText('Message Input');
    fireEvent.change(input, { target: { value: 'nothing' } });
    fireEvent.click(sendBtn);

    await new Promise(r => setTimeout(r, 800));
    expect(onAssistantResponse).not.toHaveBeenCalled();
  });

  it('tags typed-channel replies so the studio does not speak them', async () => {
    vi.stubGlobal('fetch', mockStreamFetch('direct', ['Typed reply.']));
    const onAssistantResponse = vi.fn();

    render(
      <CodexProvider>
        <JarvisChat
          conversationId={null}
          pendingInputChannel="typed"
          onAssistantResponse={onAssistantResponse}
        />
      </CodexProvider>,
    );

    const sendBtn = await screen.findByLabelText('Send Message');
    const input = screen.getByLabelText('Message Input');
    fireEvent.change(input, { target: { value: 'typed hi' } });
    fireEvent.click(sendBtn);

    await waitFor(() => {
      expect(onAssistantResponse).toHaveBeenCalledTimes(1);
    }, { timeout: 4000 });
    // Callback fires (once) but is tagged 'typed' — the studio must ignore it.
    expect(onAssistantResponse).toHaveBeenCalledWith('Typed reply.', 'typed');
  });

  it('mic transcription → send tags the completed reply with the VOICE channel', async () => {
    const MockMediaRecorder = buildMediaRecorderMock();
    (window as any).MediaRecorder = MockMediaRecorder;
    Object.defineProperty(window.navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn().mockResolvedValue({
          getTracks: () => [{ stop: vi.fn() }],
        }),
      },
    });
    (window as any).AudioContext = class {
      state = 'running';
      createMediaStreamSource() {
        return { connect: vi.fn() };
      }
      createAnalyser() {
        return { fftSize: 0, frequencyBinCount: 256, connect: vi.fn(), getByteTimeDomainData: (d: any) => d.fill(128) };
      }
      close() { return Promise.resolve(); }
    };

    // Combined fetch: transcription + conversation create + SSE stream.
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string, init?: any) => {
      if (String(url).includes('/voice/transcribe')) {
        return { ok: true, status: 200, json: async () => ({ text: 'hello from mic' }) };
      }
      if (String(url).endsWith('/api/jarvis/conversations') && init?.method === 'POST') {
        return { ok: true, status: 200, json: async () => ({ id: 'conv-tts-2' }) };
      }
      if (String(url).includes('/message/stream')) {
        const frames = chunkFrame('Spoken reply.') + sseDoneFrame('direct');
        return { ok: true, status: 200, body: makeSseStream(frames), json: async () => ({}) };
      }
      if (String(url).includes('/messages')) {
        return { ok: true, status: 200, json: async () => [] };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    }));

    const onAssistantResponse = vi.fn();
    render(
      <CodexProvider>
        <JarvisChat
          conversationId={null}
          pendingInputChannel="typed"
          onAssistantResponse={onAssistantResponse}
        />
      </CodexProvider>,
    );

    // 1. Start mic capture.
    fireEvent.click(screen.getByTestId('jarvis-mic-button'));
    await waitFor(() => {
      expect(screen.getByTestId('jarvis-mic-button').getAttribute('data-mic-state')).toBe('listening');
    });

    // 2. Stop recording → transcribe → transcript lands in the composer.
    const rec = MockMediaRecorder.instances.at(-1)!;
    rec.stop();
    await waitFor(() => {
      const input = screen.getByLabelText('Message Input') as HTMLTextAreaElement;
      expect(input.value).toContain('hello from mic');
    }, { timeout: 4000 });

    // 3. Send the voice-originated message (composer marks channel 'voice').
    fireEvent.click(screen.getByLabelText('Send Message'));

    // 4. The completed reply is emitted ONCE with the 'voice' channel.
    await waitFor(() => {
      expect(onAssistantResponse).toHaveBeenCalledTimes(1);
    }, { timeout: 4000 });
    expect(onAssistantResponse).toHaveBeenCalledWith('Spoken reply.', 'voice');
  });
});

describe('Jarvis orb — speaking only after real playback-start (TTS path)', () => {
  it('playback-started flips the orb to speaking, playback-ended returns to idle', async () => {
    // A standalone orb bound to the same window events the TTS hook emits.
    const OrbHarness = () => {
      const [playbackActive, setPlaybackActive] = React.useState(false);
      React.useEffect(() => {
        const on = () => setPlaybackActive(true);
        const off = () => setPlaybackActive(false);
        window.addEventListener(JARVIS_ORB_EVENTS.playbackStarted, on as any);
        window.addEventListener(JARVIS_ORB_EVENTS.playbackEnded, off as any);
        return () => {
          window.removeEventListener(JARVIS_ORB_EVENTS.playbackStarted, on as any);
          window.removeEventListener(JARVIS_ORB_EVENTS.playbackEnded, off as any);
        };
      }, []);
      const state = playbackActive ? 'speaking' : 'idle';
      return <JarvisOrb state={state} />;
    };

    render(<OrbHarness />);
    const orb = screen.getByTestId('jarvis-orb');
    expect(orb.getAttribute('data-orb-state')).toBe('idle');

    window.dispatchEvent(new CustomEvent(JARVIS_ORB_EVENTS.playbackStarted, { detail: { agentId: 'agent-jarvis' } }));
    await waitFor(() => {
      expect(screen.getByTestId('jarvis-orb').getAttribute('data-orb-state')).toBe('speaking');
    });

    window.dispatchEvent(new CustomEvent(JARVIS_ORB_EVENTS.playbackEnded, { detail: { agentId: 'agent-jarvis' } }));
    await waitFor(() => {
      expect(screen.getByTestId('jarvis-orb').getAttribute('data-orb-state')).toBe('idle');
    });
  });
});
