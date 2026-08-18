import { describe, it, expect } from 'vitest';
import { JarvisWorkspaceBar } from '../components/jarvis/JarvisWorkspaceBar';
import { JarvisTeamPreviewCard } from '../components/jarvis/JarvisTeamPreviewCard';
import { JarvisTeamExecutionCard } from '../components/jarvis/JarvisTeamExecutionCard';
import { CodexProvider } from '../store/codexStore';

describe('import probe', () => {
  it('imports team/workspace components without crashing', () => {
    expect(typeof JarvisWorkspaceBar).toBe('function');
    expect(typeof JarvisTeamPreviewCard).toBe('function');
    expect(typeof JarvisTeamExecutionCard).toBe('function');
    expect(typeof CodexProvider).toBe('function');
  });
});
