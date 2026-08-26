import { describe, it, expect } from 'vitest';
import { add } from '../services/maintfixture/calc.js';

describe('maintfixture calc', () => {
  it('adds two numbers', () => {
    expect(add(2, 3)).toBe(5); // FAILS while calc.ts has the subtraction bug
  });
});
