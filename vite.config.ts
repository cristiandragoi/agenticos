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
        target: 'http://127.0.0.1:4001',
      }
    }
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/setupTests.ts'
  }
})
