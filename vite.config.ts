import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';

// Tauri expects a fixed port and ignores the browser-open behaviour.
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  optimizeDeps: {
    exclude: ['sql.js'],
  },
  resolve: {
    alias: {
      '@domain': fileURLToPath(new URL('./src/domain', import.meta.url)),
      '@application': fileURLToPath(new URL('./src/application', import.meta.url)),
      '@infrastructure': fileURLToPath(new URL('./src/infrastructure', import.meta.url)),
      '@presentation': fileURLToPath(new URL('./src/presentation', import.meta.url)),
      '@composition': fileURLToPath(new URL('./src/composition', import.meta.url)),
      '@test': fileURLToPath(new URL('./src/test', import.meta.url)),
    },
  },
  // Tauri dev-server settings (harmless for plain web dev).
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
    // Sidestep Harvest/ADO CORS in web dev: the transport rewrites these hosts to
    // the prefixes below (see infrastructure/http/http-transport.ts), and Vite
    // forwards them server-side. Desktop (Tauri) calls the real hosts directly.
    proxy: {
      '/__harvest': {
        target: 'https://api.harvestapp.com',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/__harvest/, ''),
      },
      '/__ado': {
        target: 'https://dev.azure.com',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/__ado/, ''),
      },
      '/__graph': {
        target: 'https://graph.microsoft.com',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/__graph/, ''),
      },
    },
    watch: {
      ignored: [
        '**/src-tauri/**',
        '**/.claude/**',
        '**/audit/**',
        '**/*.tsbuildinfo',
        '**/dist/**',
      ],
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    server: {
      deps: {
        inline: ['sql.js'],
      },
    },
  },
});
