const fallbackTimestamp = new Date().toISOString();

export const RENDERER_BUILD_TIMESTAMP =
  import.meta.env.VITE_AGENTICOS_BUILD_TIMESTAMP || fallbackTimestamp;

export const RENDERER_BUILD_ID =
  import.meta.env.VITE_AGENTICOS_BUILD_ID || `dev-${RENDERER_BUILD_TIMESTAMP}`;

if (typeof window !== 'undefined') {
  (window as any).__AGENTICOS_RENDERER_BUILD_ID = RENDERER_BUILD_ID;
  (window as any).__AGENTICOS_RENDERER_BUILD_TIMESTAMP = RENDERER_BUILD_TIMESTAMP;
}
