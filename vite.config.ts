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
    //
    // Also exclude the vendored LiveKit Agents reference checkout. It is a
    // 42MB third-party copy whose own suite is co-located in `agents/src/**`,
    // so the substring filter 'src/' collected it: 235 phantom test files whose
    // imports (@livekit/rtc-node, @livekit/agents, pino-pretty) are not
    // installed here, producing ~156 Vite transform errors and 221 of the 245
    // "failing" files. Those files are not this project's tests.
    exclude: [
      '**/node_modules/**',
      '**/.git/**',
      '**/dist/**',
      'server/**',
      'external/**'
    ]
  }
})
