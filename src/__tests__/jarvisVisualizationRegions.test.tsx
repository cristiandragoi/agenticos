/**
 * v2 region-response contract: different humanoid regions respond
 * independently to different real states (deterministic, jsdom rAF pump).
 */
import { describe, it, expect, afterEach } from 'vitest';
import React from 'react';
import { render, cleanup } from '@testing-library/react';
import JarvisVisualization from '../components/jarvis-visualization/JarvisVisualization';

const pump = async (n = 12) => {
  for (let i = 0; i < n; i++) {
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
  }
};

const read = (container: HTMLElement) => {
  const q = (sel: string) => container.querySelector(sel) as HTMLElement | null;
  const opacity = (el: HTMLElement | null) => (el ? parseFloat(el.style.opacity || getComputedStyle(el).opacity) : NaN);
  const mouth = [...container.querySelectorAll('.jhv-face path')].find((p) => (p.getAttribute('d') || '').startsWith('M 472 420'));
  return {
    eyes: opacity(q('.jhv-eyes')),
    brain: opacity(q('.jhv-brain')),
    chest: opacity(q('.jhv-chest')),
    mouthD: mouth ? mouth.getAttribute('d') : null,
  };
};

describe('JarvisVisualization v2 — independent region response', () => {
  afterEach(() => { cleanup(); });

  it('brain region surges when THINKING; eyes stay near base', async () => {
    const { container } = render(<JarvisVisualization state="thinking" thinkingIntensity={0.8} />);
    await pump();
    const r = read(container);
    expect(r.brain).toBeGreaterThan(0.9);   // 0.65 + 0.72 + pulse*0.35 -> clamps ~1
    expect(r.eyes).toBeLessThan(0.9);       // eyes NOT driven by thinking
  });

  it('eyes brighten to full when LISTENING; brain stays low', async () => {
    const { container } = render(<JarvisVisualization state="listening" />);
    await pump();
    const r = read(container);
    expect(r.eyes).toBeGreaterThan(0.95);   // listening -> eyes = 1
    expect(r.brain).toBeLessThan(0.7);      // brain NOT driven by listening
  });

  it('mouth opens when SPEAKING (face region) and closes at rest', async () => {
    const speaking = render(<JarvisVisualization state="speaking" speakingLevel={0.8} />);
    await pump();
    const sr = read(speaking.container);
    const idle = render(<JarvisVisualization state="idle" />);
    await pump();
    const ir = read(idle.container);
    // mouth open = 3 + speakingLevel*7 => Q 500 428.6 at speaking vs 422 at idle
    expect(sr.mouthD).toContain('428');
    expect(ir.mouthD).toContain('422');
    expect(sr.mouthD).not.toBe(ir.mouthD);
  });
});
