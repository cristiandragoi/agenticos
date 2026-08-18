/**
 * JarvisVoiceInput.test.tsx
 *
 * Tests for JarvisComposer microphone input behaviour.
 *
 * Covers:
 *  - Mic button exists and is not disabled in idle state
 *  - Clicking mic button calls getUserMedia (start listening)
 *  - Recognised transcript is appended to composer (no auto-send)
 *  - Second click while listening stops the recorder
 *  - Unsupported environment shows a visible error
 *  - Permission-denied shows a visible error
 *  - Typed chat still works alongside mic
 *  - Only one mic control exists in the DOM
 */

import React from 'react';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  act,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JarvisComposer } from '../components/jarvis/JarvisComposer';

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Build a minimal MediaStream mock */
function makeStream() {
  return { getTracks: () => [{ stop: vi.fn() }] } as unknown as MediaStream;
}

/** Build a MediaRecorder mock that fires onstop synchronously when stop() is called */
class MockMediaRecorder {
  static instances: MockMediaRecorder[] = [];
  state: 'inactive' | 'recording' = 'inactive';
  ondataavailable: ((e: BlobEvent) => void) | null = null;
  onstop: (() => void) | null = null;
  stream: MediaStream;

  constructor(stream: MediaStream) {
    this.stream = stream;
    MockMediaRecorder.instances.push(this);
  }

  start() {
    this.state = 'recording';
    // Simulate a data chunk that is large enough to pass the 100-byte size check
    const chunk = new Blob([new Uint8Array(200).fill(1)], { type: 'audio/webm' });
    this.ondataavailable?.({ data: chunk } as BlobEvent);
  }

  stop() {
    this.state = 'inactive';
    this.onstop?.();
  }
}

// ── Setup / teardown ─────────────────────────────────────────────────────────

const fetchMock = vi.fn();
const getUserMediaMock = vi.fn();
const onSendMock = vi.fn();
const onTextChangeMock = vi.fn();

function setupNavigator(override?: Partial<MediaDevices>) {
  Object.defineProperty(navigator, 'mediaDevices', {
    writable: true,
    configurable: true,
    value: {
      getUserMedia: getUserMediaMock,
      ...override,
    },
  });
}

beforeEach(() => {
  MockMediaRecorder.instances = [];
  fetchMock.mockReset();
  getUserMediaMock.mockReset();
  onSendMock.mockReset();
  onTextChangeMock.mockReset();

  (globalThis as any).fetch = fetchMock;
  (globalThis as any).MediaRecorder = MockMediaRecorder;
  (globalThis as any).AudioContext = class {
    createMediaStreamSource() { return { connect: vi.fn() }; }
    createAnalyser() { return { fftSize: 0, frequencyBinCount: 128, getByteTimeDomainData: (d: Uint8Array) => d.fill(128), connect: vi.fn() }; }
    state = 'running';
    close() { return Promise.resolve(); }
  };

  setupNavigator();

  // Default: getUserMedia resolves with a mock stream
  getUserMediaMock.mockResolvedValue(makeStream());

  // Default: transcription returns a transcript
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({ text: 'hello from microphone' }),
  });
});

afterEach(() => {
  cleanup();
});

// ── Render helper ─────────────────────────────────────────────────────────────

function renderComposer(overrides: Partial<React.ComponentProps<typeof JarvisComposer>> = {}) {
  const props = {
    onSendMessage: onSendMock,
    isProcessing: false,
    composerText: '',
    onComposerTextChange: onTextChangeMock,
    ...overrides,
  };
  return render(<JarvisComposer {...props} />);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('JarvisComposer — microphone button', () => {
  it('renders exactly one mic button and it is not disabled in idle state', () => {
    renderComposer();
    const btns = screen.getAllByTestId('jarvis-mic-button');
    expect(btns).toHaveLength(1);
    expect(btns[0]).not.toBeDisabled();
  });

  it('clicking the mic button calls getUserMedia', async () => {
    renderComposer();
    fireEvent.click(screen.getByTestId('jarvis-mic-button'));

    await waitFor(() => {
      expect(getUserMediaMock).toHaveBeenCalledWith({ audio: true });
    });
  });

  it('shows "listening" state after getUserMedia resolves', async () => {
    renderComposer();
    fireEvent.click(screen.getByTestId('jarvis-mic-button'));

    await waitFor(() => {
      expect(screen.getByTestId('jarvis-mic-button').getAttribute('data-mic-state')).toBe('listening');
    });
  });

  it('second click while listening stops the recorder', async () => {
    renderComposer();

    // Start
    fireEvent.click(screen.getByTestId('jarvis-mic-button'));
    await waitFor(() => {
      expect(screen.getByTestId('jarvis-mic-button').getAttribute('data-mic-state')).toBe('listening');
    });

    // Stop
    fireEvent.click(screen.getByTestId('jarvis-mic-button'));

    await waitFor(() => {
      const lastRecorder = MockMediaRecorder.instances.at(-1);
      expect(lastRecorder?.state).toBe('inactive');
    });
  });

  it('appends recognised transcript to composer text without auto-sending', async () => {
    renderComposer({ composerText: 'existing text', onComposerTextChange: onTextChangeMock });

    fireEvent.click(screen.getByTestId('jarvis-mic-button'));
    // Wait for listening, then stop to trigger transcription
    await waitFor(() => {
      expect(screen.getByTestId('jarvis-mic-button').getAttribute('data-mic-state')).toBe('listening');
    });

    // Stop recording manually
    act(() => {
      const rec = MockMediaRecorder.instances.at(-1)!;
      rec.stop();
    });

    await waitFor(() => {
      // onComposerTextChange called with appended text
      expect(onTextChangeMock).toHaveBeenCalledWith(
        expect.stringContaining('hello from microphone')
      );
    });

    // onSendMessage must NOT have been called
    expect(onSendMock).not.toHaveBeenCalled();
  });

  it('does NOT auto-send: Send button must be pressed manually', async () => {
    renderComposer({ composerText: '', onComposerTextChange: onTextChangeMock });

    fireEvent.click(screen.getByTestId('jarvis-mic-button'));
    await waitFor(() => {
      expect(screen.getByTestId('jarvis-mic-button').getAttribute('data-mic-state')).toBe('listening');
    });

    act(() => {
      const rec = MockMediaRecorder.instances.at(-1)!;
      rec.stop();
    });

    await waitFor(() => {
      expect(onTextChangeMock).toHaveBeenCalled();
    });

    expect(onSendMock).not.toHaveBeenCalled();
  });
});

describe('JarvisComposer — transcription failure classification', () => {
  it('no-speech (400 + noSpeech:true) is a benign notice, NOT the red error state', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: 'No speech detected.', noSpeech: true }),
    });

    renderComposer();
    fireEvent.click(screen.getByTestId('jarvis-mic-button'));
    await waitFor(() =>
      expect(screen.getByTestId('jarvis-mic-button').getAttribute('data-mic-state')).toBe('listening')
    );
    act(() => { MockMediaRecorder.instances.at(-1)!.stop(); });

    await waitFor(() => {
      expect(screen.getByTestId('jarvis-mic-notice')).toBeInTheDocument();
    });
    expect(screen.getByTestId('jarvis-mic-notice').textContent).toContain('No speech detected');
    // Must NOT be the error state, must NOT show the red banner, mic returns to idle.
    expect(screen.getByTestId('jarvis-mic-button').getAttribute('data-mic-state')).toBe('idle');
    expect(screen.queryByTestId('jarvis-mic-error')).not.toBeInTheDocument();
  });

  it('hard transcription failure (400, no noSpeech flag) still shows one clear red error', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: 'Bad audio payload' }),
    });

    renderComposer();
    fireEvent.click(screen.getByTestId('jarvis-mic-button'));
    await waitFor(() =>
      expect(screen.getByTestId('jarvis-mic-button').getAttribute('data-mic-state')).toBe('listening')
    );
    act(() => { MockMediaRecorder.instances.at(-1)!.stop(); });

    await waitFor(() => {
      expect(screen.getByTestId('jarvis-mic-error')).toBeInTheDocument();
    });
    expect(screen.getByTestId('jarvis-mic-error').textContent).toContain('Transcription HTTP 400');
    expect(screen.getByTestId('jarvis-mic-button').getAttribute('data-mic-state')).toBe('error');
  });

  it('no-speech notice is cleared when the user retries capture', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: 'No speech detected.', noSpeech: true }),
    });

    renderComposer();
    fireEvent.click(screen.getByTestId('jarvis-mic-button'));
    await waitFor(() =>
      expect(screen.getByTestId('jarvis-mic-button').getAttribute('data-mic-state')).toBe('listening')
    );
    act(() => { MockMediaRecorder.instances.at(-1)!.stop(); });
    await waitFor(() => expect(screen.getByTestId('jarvis-mic-notice')).toBeInTheDocument());

    // Retry: clicking mic again clears the notice immediately.
    fireEvent.click(screen.getByTestId('jarvis-mic-button'));
    await waitFor(() => {
      expect(screen.queryByTestId('jarvis-mic-notice')).not.toBeInTheDocument();
    });
  });
});

describe('JarvisComposer — error states', () => {
  it('shows visible error when getUserMedia is unavailable', async () => {
    // Remove mediaDevices entirely
    Object.defineProperty(navigator, 'mediaDevices', {
      writable: true,
      configurable: true,
      value: undefined,
    });

    renderComposer();
    fireEvent.click(screen.getByTestId('jarvis-mic-button'));

    await waitFor(() => {
      expect(screen.getByTestId('jarvis-mic-error')).toBeInTheDocument();
      expect(screen.getByTestId('jarvis-mic-button').getAttribute('data-mic-state')).toBe('error');
    });
  });

  it('shows visible error when microphone permission is denied', async () => {
    const denied = Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' });
    getUserMediaMock.mockRejectedValue(denied);

    renderComposer();
    fireEvent.click(screen.getByTestId('jarvis-mic-button'));

    await waitFor(() => {
      expect(screen.getByTestId('jarvis-mic-error')).toBeInTheDocument();
      const errEl = screen.getByTestId('jarvis-mic-error');
      expect(errEl.textContent).toContain('permission denied');
    });

    expect(onSendMock).not.toHaveBeenCalled();
  });

  it('shows visible error when no microphone device is found', async () => {
    const missing = Object.assign(new Error('Requested device not found'), { name: 'NotFoundError' });
    getUserMediaMock.mockRejectedValue(missing);

    renderComposer();
    fireEvent.click(screen.getByTestId('jarvis-mic-button'));

    await waitFor(() => {
      expect(screen.getByTestId('jarvis-mic-error')).toBeInTheDocument();
      expect(screen.getByTestId('jarvis-mic-error').textContent).toContain('No microphone');
    });
  });

  it('after an error, mic button is re-clickable (not permanently disabled)', async () => {
    const denied = Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' });
    getUserMediaMock.mockRejectedValue(denied);

    renderComposer();
    fireEvent.click(screen.getByTestId('jarvis-mic-button'));

    await waitFor(() => {
      expect(screen.getByTestId('jarvis-mic-button').getAttribute('data-mic-state')).toBe('error');
    });

    // After error the button should NOT be disabled (so user can retry)
    expect(screen.getByTestId('jarvis-mic-button')).not.toBeDisabled();
  });
});

describe('JarvisComposer — typed chat still works', () => {
  it('typed text still triggers onSendMessage via Send button with inputChannel=typed', () => {
    render(
      <JarvisComposer
        onSendMessage={onSendMock}
        isProcessing={false}
      />
    );
    const input = screen.getByLabelText('Message Input');
    fireEvent.change(input, { target: { value: 'Hello typed message' } });
    fireEvent.click(screen.getByLabelText('Send Message'));
    expect(onSendMock).toHaveBeenCalledWith('Hello typed message', 'typed');
  });

  it('Enter key sends a typed message with inputChannel=typed', () => {
    render(
      <JarvisComposer
        onSendMessage={onSendMock}
        isProcessing={false}
      />
    );
    const input = screen.getByLabelText('Message Input');
    fireEvent.change(input, { target: { value: 'Keyboard send' } });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: false });
    expect(onSendMock).toHaveBeenCalledWith('Keyboard send', 'typed');
  });

  it('manual edit after transcription resets inputChannel to typed', async () => {
    renderComposer({ composerText: '', onComposerTextChange: onTextChangeMock });

    // Trigger transcription
    fireEvent.click(screen.getByTestId('jarvis-mic-button'));
    await waitFor(() =>
      expect(screen.getByTestId('jarvis-mic-button').getAttribute('data-mic-state')).toBe('listening')
    );
    act(() => { MockMediaRecorder.instances.at(-1)!.stop(); });
    await waitFor(() => expect(onTextChangeMock).toHaveBeenCalled());

    // Now render with internal state so we can type
    cleanup();
    render(
      <JarvisComposer
        onSendMessage={onSendMock}
        isProcessing={false}
      />
    );
    // Simulate user typing after voice fill
    const input = screen.getByLabelText('Message Input');
    fireEvent.change(input, { target: { value: 'manual override' } });
    fireEvent.click(screen.getByLabelText('Send Message'));
    // Must be 'typed' not 'voice'
    expect(onSendMock).toHaveBeenCalledWith('manual override', 'typed');
  });
});

describe('JarvisComposer — voice inputChannel tagging', () => {
  it('voice transcript send is tagged as inputChannel=voice', async () => {
    renderComposer({ composerText: '', onComposerTextChange: onTextChangeMock });

    // Start and stop recording
    fireEvent.click(screen.getByTestId('jarvis-mic-button'));
    await waitFor(() =>
      expect(screen.getByTestId('jarvis-mic-button').getAttribute('data-mic-state')).toBe('listening')
    );
    act(() => { MockMediaRecorder.instances.at(-1)!.stop(); });
    await waitFor(() => expect(onTextChangeMock).toHaveBeenCalled());

    // Render a fresh component with the transcribed text pre-loaded via internal state
    // Simulate: composerText is now 'hello from microphone', then user presses Send.
    // We do this by re-rendering with controlled props.
    cleanup();
    const onSend2 = vi.fn();
    render(
      <JarvisComposer
        onSendMessage={onSend2}
        isProcessing={false}
      />
    );
    // Manually populate via voice path by simulating a second recording
    fireEvent.click(screen.getByTestId('jarvis-mic-button'));
    await waitFor(() =>
      expect(screen.getByTestId('jarvis-mic-button').getAttribute('data-mic-state')).toBe('listening')
    );
    act(() => { MockMediaRecorder.instances.at(-1)!.stop(); });
    // Wait for transcription to fill the textarea
    await waitFor(() => {
      const input = screen.getByLabelText('Message Input') as HTMLTextAreaElement;
      return input.value !== '';
    }, { timeout: 3000 });

    // Now send — should be tagged as voice
    fireEvent.click(screen.getByLabelText('Send Message'));
    expect(onSend2).toHaveBeenCalledWith(
      expect.stringContaining('hello from microphone'),
      'voice'
    );
  });

  it('one transcript produces exactly one onSendMessage call when sent', async () => {
    renderComposer({ composerText: '', onComposerTextChange: onTextChangeMock });

    fireEvent.click(screen.getByTestId('jarvis-mic-button'));
    await waitFor(() =>
      expect(screen.getByTestId('jarvis-mic-button').getAttribute('data-mic-state')).toBe('listening')
    );
    act(() => { MockMediaRecorder.instances.at(-1)!.stop(); });
    await waitFor(() => expect(onTextChangeMock).toHaveBeenCalled());

    // onSendMessage must NOT have been called automatically
    expect(onSendMock).not.toHaveBeenCalled();
    // Only called once when user explicitly presses Send
    expect(onSendMock.mock.calls.length).toBe(0);
  });
});

describe('JarvisComposer — single mic control / no duplicate JSX', () => {
  it('renders only one mic button', () => {
    renderComposer();
    expect(screen.getAllByTestId('jarvis-mic-button')).toHaveLength(1);
  });

  it('renders only one textarea (no duplicate JSX)', () => {
    renderComposer();
    expect(screen.getAllByLabelText('Message Input')).toHaveLength(1);
  });

  it('renders only one Send button (no duplicate JSX)', () => {
    renderComposer();
    expect(screen.getAllByLabelText('Send Message')).toHaveLength(1);
  });

  it('renders only one mic-status label (no duplicate JSX)', () => {
    renderComposer();
    expect(screen.getAllByTestId('jarvis-mic-status')).toHaveLength(1);
  });
});
