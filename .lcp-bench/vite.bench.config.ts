import { defineConfig, mergeConfig } from 'vite';
import base from '../vite.config';

// Benchmark-only build: renderer only (VITE_WEB_ONLY=true), isolated outDir,
// public dir NOT copied so public/index.html cannot clobber the built index.html.
export default mergeConfig(
  base as any,
  defineConfig({
    build: {
      outDir: process.env.BENCH_OUT || '.lcp-bench/dist-after',
      emptyOutDir: true,
      copyPublicDir: false,
    },
  }) as any,
);
