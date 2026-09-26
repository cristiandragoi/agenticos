import buildIdentity from './build-identity.json';

const fallbackTimestamp = new Date().toISOString();

export const RENDERER_BUILD_TIMESTAMP =
  import.meta.env.VITE_AGENTICOS_BUILD_TIMESTAMP || buildIdentity?.buildTimestamp || fallbackTimestamp;

export const RENDERER_BUILD_ID =
  import.meta.env.VITE_AGENTICOS_BUILD_ID || buildIdentity?.buildId || `dev-${RENDERER_BUILD_TIMESTAMP}`;

export const JARVIS_BUILD_ID = RENDERER_BUILD_ID;

if (typeof window !== 'undefined') {
  (window as any).__AGENTICOS_RENDERER_BUILD_ID = RENDERER_BUILD_ID;
  (window as any).__AGENTICOS_RENDERER_BUILD_TIMESTAMP = RENDERER_BUILD_TIMESTAMP;
  (window as any).__JARVIS_BUILD_ID = JARVIS_BUILD_ID;
}
