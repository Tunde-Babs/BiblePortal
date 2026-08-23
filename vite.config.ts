import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

const BUILD_STAMP = new Date().toISOString().replace('T', ' ').slice(0, 16);

export default defineConfig({
  // Surfaced in the status bar. Without it, "is the fix in the build you are
  // running?" can only be guessed at, which wastes a whole test cycle.
  define: { __BUILD_STAMP__: JSON.stringify(BUILD_STAMP) },
  root: '.',
  base: './',
  plugins: [react()],
  server: { port: 5273, strictPort: true },
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@renderer': resolve(__dirname, 'src/renderer'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'chrome128',
    rollupOptions: {
      input: {
        console: resolve(__dirname, 'index.html'),
        output: resolve(__dirname, 'output.html'),
        stage: resolve(__dirname, 'stage.html'),
      },
    },
  },
});
