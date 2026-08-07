import { describe, expect, it } from 'vitest';
import {
  isUtteranceComplete,
  decideContinuation,
  CONTINUATION_TAIL_WORDS,
} from '../utils/utteranceCompleteness';

describe('utterance completeness (conversation-mode end-of-turn)', () => {
  it('holds incomplete fragments that end on a continuation marker', () => {
    for (const fragment of ['It is', 'I want', 'Can you', 'The thing is', 'So basically', 'It is not', 'I was']) {
      expect(isUtteranceComplete(fragment), fragment).toBe(false);
    }
  });

  it('submits genuine short commands promptly', () => {
    for (const command of ['Open CodeX', 'Stop task', 'Yes', 'No', 'Show task', 'Pause']) {
      expect(isUtteranceComplete(command), command).toBe(true);
    }
  });

  it('treats terminal punctuation as complete', () => {
    for (const s of ['It is done.', 'Can you help?', 'Stop!', 'What is CodeX doing?']) {
      expect(isUtteranceComplete(s), s).toBe(true);
    }
  });

  it('treats complete sentences without punctuation as complete', () => {
    expect(isUtteranceComplete('Open the board')).toBe(true);
    expect(isUtteranceComplete('Find 5 real roofing businesses in Berlin')).toBe(true);
  });

  it('the marker set is a closed class — not the example phrase list', () => {
    // The prohibited approach would list full phrases ("It is", "I want"…).
    // This set only contains single function words / fillers.
    for (const w of CONTINUATION_TAIL_WORDS) {
      expect(w.split(/\s+/).length, w).toBe(1);
    }
    expect(CONTINUATION_TAIL_WORDS.has('it is')).toBe(false);
  });
});

describe('decideContinuation (bounded continuation window)', () => {
  it('no buffer + complete → submit immediately', () => {
    expect(decideContinuation(null, 'Open CodeX')).toEqual({ action: 'submit', text: 'Open CodeX' });
  });

  it('no buffer + incomplete → hold (start window)', () => {
    expect(decideContinuation(null, 'It is')).toEqual({ action: 'hold' });
  });

  it('buffer + complete combined → ONE submitted turn', () => {
    expect(decideContinuation('It is', 'not showing the correct model.')).toEqual({
      action: 'submit',
      text: 'It is not showing the correct model.',
    });
  });

  it('buffer + still-incomplete combined → keep buffering', () => {
    expect(decideContinuation('It is', 'not')).toEqual({ action: 'buffer', combined: 'It is not' });
  });

  it('buffer + complete short command → combined submit', () => {
    expect(decideContinuation('Please', 'open CodeX')).toEqual({ action: 'submit', text: 'Please open CodeX' });
  });
});
