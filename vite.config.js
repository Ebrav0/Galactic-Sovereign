import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src',
  // Relative base so the built renderer loads from file:// inside Electron.
  base: './',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
