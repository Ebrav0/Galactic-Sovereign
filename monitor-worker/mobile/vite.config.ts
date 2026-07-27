import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: new URL('.', import.meta.url).pathname,
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    target: 'safari16',
  },
  server: {
    host: '0.0.0.0',
    allowedHosts: ['terminal.local', 'localhost', '127.0.0.1'],
  },
});
