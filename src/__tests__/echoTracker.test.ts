import { describe, it, expect, beforeEach } from 'vitest';
import {
  recordSpokenSegment,
  classifyTranscript,
  clearSpokenSegments,
  _resetEchoTracker,
} from '../lib/echoTracker';

describe('echoTracker — transcript-level echo rejection', () => {
  beforeEach(() => { _resetEchoTracker(); });

  it('P3: incoming transcript closely matching the current spoken segment is echo', () => {
    recordSpokenSegment('Hermes is the engineering inspection agent that runs repository inspections across the codebase', 'turn-1');
    const d = classifyTranscript('engineering inspection agent', Date.now() + 1000);
    expect(d.kind).toBe('echo');
    expect(d.text).toBe('');
  });

  it('P3: substring echo (short tail of what Jarvis is saying) is rejected', () => {
    recordSpokenSegment('It runs repository inspections and reports findings to the operator', 'turn-1');
    const d = classifyTranscript('runs repository inspections', Date.now() + 1000);
    expect(d.kind).toBe('echo');
  });

  it('P4: genuinely different speech is fresh', () => {
    recordSpokenSegment('Hermes is the engineering inspection agent', 'turn-1');
    const d = classifyTranscript('Jarvis stop', Date.now() + 1000);
    expect(d.kind).toBe('fresh');
  });

  it('P5: mixed echo prefix + stop is salvaged (suffix preserved)', () => {
    recordSpokenSegment('engineering inspection agent runs repository inspections', 'turn-1');
    const d = classifyTranscript('engineering inspection agent Jarvis stop', Date.now() + 1000);
    expect(d.kind).toBe('mixed');
    expect(d.text.toLowerCase()).toContain('jarvis stop');
    expect(d.removedPrefix).toContain('engineering');
  });

  it('P6: mixed echo prefix + new request is salvaged', () => {
    recordSpokenSegment('engineering inspection agent runs repository inspections', 'turn-1');
    const d = classifyTranscript('engineering inspection agent tell me about memory', Date.now() + 1000);
    expect(d.kind).toBe('mixed');
    expect(d.text.toLowerCase()).toBe('tell me about memory');
  });

  it('P7: expired segments are not matched (no stale echo)', () => {
    recordSpokenSegment('engineering inspection agent', 'turn-1', Date.now() - 30000);
    const d = classifyTranscript('engineering inspection agent', Date.now());
    expect(d.kind).toBe('fresh');
  });

  it('P7: very short transcripts are never echo-rejected', () => {
    recordSpokenSegment('stop now', 'turn-1');
    const d = classifyTranscript('stop', Date.now() + 1000);
    expect(d.kind).toBe('fresh');
  });

  it('P8: echo with low confidence is retained, not silently deleted', () => {
    recordSpokenSegment('the quick brown fox', 'turn-1');
    const d = classifyTranscript('something completely different', Date.now() + 1000);
    expect(d.kind).toBe('fresh');
  });
});

describe('echoTracker — lifecycle', () => {
  beforeEach(() => { _resetEchoTracker(); });

  it('clearSpokenSegments removes all tracked segments', () => {
    recordSpokenSegment('hello world', 'turn-1');
    clearSpokenSegments();
    const d = classifyTranscript('hello world', Date.now() + 1000);
    expect(d.kind).toBe('fresh');
  });
});
