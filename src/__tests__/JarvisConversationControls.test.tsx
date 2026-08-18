/**
 * JarvisConversationControls.test.tsx — drawer-level conversation UI tests.
 *
 * Verifies the JarvisDrawer conversation-mode controls (the surface actually
 * mounted on /mission-control) without re-testing the hook engine:
 *  - mode control renders Manual + Conversation
 *  - Conversation button activates conversation mode via the hook
 *  - End button deactivates conversation mode
 *  - disabling the microphone ends conversation mode
 *  - state indicator reflects the REAL voiceState (never faked)
 *  - Stop-speaking control appears only during real playback
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import JarvisDrawer from '../components/drawers/JarvisDrawer';
import { AppProvider, useAppDispatch } from '../store/appStore';
import { DataProvider } from '../store/dataStore';

const mockStartConversation = vi.fn().mockResolvedValue(true);
const mockEndConversation = vi.fn();
const mockSetVoiceEnabled = vi.fn();
const mockStopSpeaking = vi.fn();
const mockStopListening = vi.fn();
const mockStartListening = vi.fn();

let mockVoiceState = 'idle';
let mockIsSpeaking = false;

vi.mock('../hooks/useVoiceIO', () => ({
  useVoiceIO: (opts: any) => ({
    voiceState: mockVoiceState,
    lastTranscript: '',
    lastResponse: '',
    startListening: mockStartListening,
    stopListening: mockStopListening,
    toggleListening: vi.fn(),
    stopAudio: vi.fn(),
    stopSpeaking: mockStopSpeaking,
    speak: vi.fn().mockResolvedValue(undefined),
    setVoiceEnabled: mockSetVoiceEnabled,
    conversationActive: false,
    startConversation: mockStartConversation,
    endConversation: mockEndConversation,
    isListening: mockVoiceState === 'listening',
    isSpeaking: mockIsSpeaking,
    isProcessing: false,
    playbackError: null,
    onAutoSubmit: opts?.onAutoSubmit,
  }),
}));

vi.mock('../store/dataStore', async () => {
  const actual = await vi.importActual('../store/dataStore');
  return {
    ...(actual as any),
    useData: () => ({
      isLoading: false,
      agents: [{ id: 'agent-jarvis', name: 'Jarvis' }],
      refresh: vi.fn(),
    }),
  };
});

vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
  const url = String(input);
  if (url.includes('/api/agents')) {
    return { ok: true, json: async () => [{ id: 'agent-jarvis', name: 'Jarvis', status: 'active' }] };
  }
  if (url.includes('/api/runs')) {
    return { ok: true, json: async () => [] };
  }
  return { ok: true, json: async () => ({}) };
}));

function renderDrawer() {
  const TestComponent = () => {
    const dispatch = useAppDispatch();
    React.useEffect(() => {
      dispatch({ type: 'OPEN_DRAWER', entityType: 'jarvis', entityId: 'agent-jarvis' });
    }, [dispatch]);
    return <JarvisDrawer />;
  };
  return render(
    <DataProvider>
      <AppProvider>
        <MemoryRouter initialEntries={['/mission-control']}>
          <TestComponent />
        </MemoryRouter>
      </AppProvider>
    </DataProvider>,
  );
}

describe('JarvisDrawer conversation controls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVoiceState = 'idle';
    mockIsSpeaking = false;
    // jsdom lacks matchMedia — ThinkingOrb (rendered in the Chat view) uses it.
    (window as any).matchMedia = vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
  });

  it('renders Manual and Conversation mode controls', () => {
    renderDrawer();
    expect(screen.getByTestId('jarvis-mode-manual')).toBeTruthy();
    expect(screen.getByTestId('jarvis-mode-conversation')).toBeTruthy();
    expect(screen.getByTestId('jarvis-conv-mic-toggle')).toBeTruthy();
    expect(screen.getByTestId('jarvis-conv-voiceout-toggle')).toBeTruthy();
  });

  it('Conversation button activates conversation mode', async () => {
    renderDrawer();
    await act(async () => {
      screen.getByTestId('jarvis-mode-conversation').click();
    });
    expect(mockStartConversation).toHaveBeenCalledTimes(1);
    // End button appears only while conversation mode is active
    expect(screen.getByTestId('jarvis-conv-end')).toBeTruthy();
  });

  it('End button deactivates conversation mode', async () => {
    renderDrawer();
    await act(async () => {
      screen.getByTestId('jarvis-mode-conversation').click();
    });
    await act(async () => {
      screen.getByTestId('jarvis-conv-end').click();
    });
    expect(mockEndConversation).toHaveBeenCalledTimes(1);
  });

  it('disabling the microphone ends conversation mode', async () => {
    renderDrawer();
    await act(async () => {
      screen.getByTestId('jarvis-mode-conversation').click();
    });
    await act(async () => {
      screen.getByTestId('jarvis-conv-mic-toggle').click(); // disable mic
    });
    expect(mockEndConversation).toHaveBeenCalledTimes(1);
  });

  it('state indicator shows the real voiceState, never faked', async () => {
    mockVoiceState = 'transcribing';
    renderDrawer();
    await act(async () => {
      screen.getByTestId('jarvis-mode-conversation').click();
    });
    expect(screen.getByTestId('jarvis-conv-state').textContent?.toLowerCase()).toBe('transcribing');
  });

  it('Stop-speaking control appears only during real playback', async () => {
    mockIsSpeaking = false;
    const { rerender } = renderDrawer();
    expect(screen.queryByTestId('jarvis-conv-stop-speaking')).toBeNull();

    mockIsSpeaking = true;
    mockVoiceState = 'speaking';
    await act(async () => {
      screen.getByTestId('jarvis-mode-conversation').click();
    });
    rerender(
      <DataProvider>
        <AppProvider>
          <MemoryRouter initialEntries={['/mission-control']}>
            <JarvisDrawer />
          </MemoryRouter>
        </AppProvider>
      </DataProvider>,
    );
    const stopBtn = screen.queryByTestId('jarvis-conv-stop-speaking');
    expect(stopBtn).toBeTruthy();
    await act(async () => { stopBtn?.click(); });
    expect(mockStopSpeaking).toHaveBeenCalledTimes(1);
  });

  it('voice output toggle forwards to the hook', async () => {
    renderDrawer();
    await act(async () => {
      screen.getByTestId('jarvis-conv-voiceout-toggle').click();
    });
    expect(mockSetVoiceEnabled).toHaveBeenCalledWith(false);
  });
});
