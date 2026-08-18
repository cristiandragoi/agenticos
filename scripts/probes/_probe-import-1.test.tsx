import { describe, it, expect } from 'vitest';
import { JarvisChat } from '../components/jarvis/JarvisChat';

describe('import probe', () => {
  it('imports JarvisChat without crashing', () => {
    expect(typeof JarvisChat).toBe('function');
  });
});
