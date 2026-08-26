import { describe, it, expect } from 'vitest';
import { add } from './calculator.js';

describe('Autonomous Write Acceptance - Calculator', () => {
  it('adds two numbers correctly', () => {
    expect(add(2, 3)).toBe(5);
    expect(add(10, 20)).toBe(30);
    expect(add(-5, 5)).toBe(0);
  });
});
