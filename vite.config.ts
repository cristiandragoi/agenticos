import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'

const isWebOnly = process.env.VITE_WEB_ONLY === 'true'

export default defineConfig({
  base: './',
  plugins: [
    react(),
    !isWebOnly && electron([
      {
        entry: 'electron/main.ts',
      },
      {
        entry: 'electron/preload.ts',
        onstart(options) {
          options.reload()
        },
        vite: {
          build: {
            rollupOptions: {
              output: {
                format: 'cjs',
                entryFileNames: '[name].cjs'
              }
            }
          }
        }
      },
    ]),
  ].filter(Boolean) as any,
  server: {
    port: 5173,
    proxy: {
      '/api': {
        // Env-overridable so a SOURCE backend can run on a different port
        // (e.g. VITE_BACKEND_PORT=4001) while the deployed app keeps 4600.
        target: `http://127.0.0.1:${process.env.VITE_BACKEND_PORT || process.env.AGENTICOS_BACKEND_PORT || '4600'}`,
      }
    }
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/setupTests.ts',
    // Frontend harness only: exclude the server test tree (it runs under its
    // own node-environment config in server/). Without this, the bare 'src/'
    // positional filter substring-matches server/src/__tests__ too, so
    // `npm test -- <anything>` sweeps server tests into the jsdom runner.
    exclude: ['**/node_modules/**', '**/.git/**', '**/dist/**', 'server/**']
  }
})
