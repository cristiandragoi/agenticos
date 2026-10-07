import { describe, expect, it } from 'vitest';
import {
  isPunctuationOnly,
  normalizeWhitespace,
  scanSentencesFallback,
  splitIntoSentences,
} from '../domains/jarvisNext/sentenceTokenizer';

describe('Sentence Tokenizer Robust Segmentation Suite', () => {
  const failingTelegramText =
    "I have opened Telegram. The last 4 messages in Agentic OS are: You said: 'What is the status of the AgenticOS GitHub repository update task that I delegated to Hermes? Do not create a new task. Tell me the existing task ID, worker, status, last real event, blocker, and verification state.'. AgenticOS said: 'No prior worker results exist in this conversation.'. You said: 'jarvis you there?'. AgenticOS said: 'I\\'m here.'";

  it('Requirement 3 & 5: segments the exact failing Telegram text without dropping any content', () => {
    const res = splitIntoSentences(failingTelegramText);

    expect(res.invariantPassed).toBe(true);
    expect(normalizeWhitespace(res.sentences.join(' '))).toBe(
      normalizeWhitespace(failingTelegramText)
    );

    // Verify all required semantic chunks are present
    const expectedSubstrings = [
      'I have opened Telegram.',
      "The last 4 messages in Agentic OS are: You said: 'What is the status of the AgenticOS GitHub repository update task that I delegated to Hermes?",
      'Do not create a new task.',
      "Tell me the existing task ID, worker, status, last real event, blocker, and verification state.'.",
      "AgenticOS said: 'No prior worker results exist in this conversation.'.",
      "You said: 'jarvis you there?'.",
      "AgenticOS said: 'I\\'m here.'",
    ];

    for (const expected of expectedSubstrings) {
      const found = res.sentences.some((chunk) => chunk.includes(expected));
      expect(
        found,
        `Expected chunk or parent containing: "${expected}"`
      ).toBe(true);
    }

    // Verify no punctuation-only chunks exist
    for (const chunk of res.sentences) {
      expect(isPunctuationOnly(chunk)).toBe(false);
    }
  });

  it('Requirement 1: handles terminal punctuation followed by closing characters', () => {
    const cases = [
      "Hello.'",
      'Hello."',
      'Hello.’',
      'Hello.”',
      'Hello.)',
      'Hello.]',
      'Hello.}',
    ];

    for (const tc of cases) {
      const res = splitIntoSentences(tc);
      expect(res.invariantPassed).toBe(true);
      expect(res.sentences.length).toBe(1);
      expect(res.sentences[0]).toBe(tc);
      expect(normalizeWhitespace(res.sentences.join(' '))).toBe(
        normalizeWhitespace(tc)
      );
    }
  });

  it('Requirement 2: handles nested punctuation preserving both punctuation and intervening text', () => {
    const text = "state.'. AgenticOS said: 'No prior worker results exist.'";
    const res = splitIntoSentences(text);

    expect(res.invariantPassed).toBe(true);
    expect(res.sentences.length).toBe(2);
    expect(res.sentences[0]).toBe("state.'.");
    expect(res.sentences[1]).toBe("AgenticOS said: 'No prior worker results exist.'");
    expect(normalizeWhitespace(res.sentences.join(' '))).toBe(
      normalizeWhitespace(text)
    );
  });

  it('Requirement 4: rejects and merges punctuation-only chunks into adjacent content', () => {
    const text = "First sentence. '. Second sentence.";
    const res = splitIntoSentences(text);

    expect(res.invariantPassed).toBe(true);
    // The punctuation-only chunk " '." must be merged with "First sentence."
    expect(res.sentences.some((s) => s.trim() === "'.")).toBe(false);
    for (const s of res.sentences) {
      expect(isPunctuationOnly(s)).toBe(false);
    }
  });

  it('Requirement 6: passes all additional regression cases', () => {
    const cases = [
      {
        input: "He said: 'Hello.' Then he left.",
        expectedCount: 2,
        expectedChunks: ["He said: 'Hello.'", "Then he left."],
      },
      {
        input: 'She asked: "Are you there?" I replied.',
        expectedCount: 2,
        expectedChunks: ['She asked: "Are you there?"', "I replied."],
      },
      {
        input: "Done!' Next sentence.",
        expectedCount: 2,
        expectedChunks: ["Done!'", "Next sentence."],
      },
      {
        input: 'Done?” Next sentence.',
        expectedCount: 2,
        expectedChunks: ['Done?”', "Next sentence."],
      },
      {
        input: "Done.) Next sentence.",
        expectedCount: 2,
        expectedChunks: ["Done.)", "Next sentence."],
      },
      {
        input: "No punctuation at end",
        expectedCount: 1,
        expectedChunks: ["No punctuation at end"],
      },
      {
        input: "First sentence. Second sentence! Third sentence?",
        expectedCount: 3,
        expectedChunks: ["First sentence.", "Second sentence!", "Third sentence?"],
      },
      {
        input: "Xiaomi MiMo 2.6 Flash is very fast. Another sentence.",
        expectedCount: 2,
        expectedChunks: ["Xiaomi MiMo 2.6 Flash is very fast.", "Another sentence."],
      },
    ];

    for (const tc of cases) {
      const res = splitIntoSentences(tc.input);
      expect(res.invariantPassed).toBe(true);
      expect(res.sentences.length).toBe(tc.expectedCount);
      expect(res.sentences).toEqual(tc.expectedChunks);
      expect(normalizeWhitespace(res.sentences.join(' '))).toBe(
        normalizeWhitespace(tc.input)
      );
    }
  });

  it('Requirement 7: deterministic fallback scanner handles nested punctuation and decimals', () => {
    const rawSegments = scanSentencesFallback(failingTelegramText);
    expect(rawSegments.length).toBeGreaterThan(1);

    const joined = rawSegments.join(' ');
    expect(normalizeWhitespace(joined)).toBe(
      normalizeWhitespace(failingTelegramText)
    );

    const decimalText = "Xiaomi MiMo 2.6 Flash is very fast. Another sentence.";
    const decSegments = scanSentencesFallback(decimalText);
    expect(decSegments.length).toBe(2);
    expect(decSegments[0].trim()).toBe("Xiaomi MiMo 2.6 Flash is very fast.");
    expect(decSegments[1].trim()).toBe("Another sentence.");
  });
});
